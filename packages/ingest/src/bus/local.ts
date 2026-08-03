/**
 * The in-process bus. This is the default transport and it is complete: the
 * whole demo runs on it with no network and no LaserData account.
 *
 *   EventEmitter        fan-out
 *   per-topic ring      history() / F5 replay
 *   Map-backed kv       clock state
 *   substring recall    incident memory
 */
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';

import { TOPICS, id as mkId, nowIso, percentile } from '@hopper/contracts';
import type {
  AdvisoryEvent,
  AgentBusEvent,
  DecisionEvent,
  EventBusPort,
  EventEnvelope,
  FunnelStats,
  HopperEvent,
  Topic,
  Unsubscribe,
} from '@hopper/contracts';

import { validateEvent } from '../validate.js';

export const HISTORY_CAP = 5_000;
const MEMORY_CAP = 2_000;
const LATENCY_CAP = 10_000;

/**
 * Extensions our own bus implementations share. Not part of the frozen
 * EventBusPort; callers probe for them and degrade gracefully.
 */
export interface BusInternals {
  /** suspend advisory dedupe so a fixture can be re-emitted verbatim */
  beginReplay(): void;
  endReplay(): void;
  /** push a text into the recall index for a namespace */
  remember(namespace: string, text: string): void;
  /** record an externally measured publish latency (ms) */
  pushLatency(ms: number): void;
  /** number of payloads that failed contract validation on publish */
  invalidCount(): number;
}

export function busInternals(bus: unknown): BusInternals | null {
  const b = bus as Partial<BusInternals> | null;
  return b && typeof b.beginReplay === 'function' && typeof b.endReplay === 'function'
    ? (b as BusInternals)
    : null;
}

interface MemoryRow {
  text: string;
  ts: string;
}

export class LocalBus implements EventBusPort, BusInternals {
  private readonly emitter = new EventEmitter();
  private readonly buffers = new Map<Topic, EventEnvelope<HopperEvent>[]>();
  private readonly store = new Map<string, Map<string, unknown>>();
  private readonly memory = new Map<string, MemoryRow[]>();
  private readonly latencies: number[] = [];
  private readonly seenAdvisories = new Set<string>();

  private readonly traversed = new Set<string>();
  private readonly suppressed = new Set<string>();
  private readonly escalated = new Set<string>();

  private seq = 0;
  private ingested = 0;
  private deduped = 0;
  private actions = 0;
  private invalid = 0;
  private replayMode = false;
  private windowStartedAt = nowIso();
  private readonly trackLatency: boolean;

  constructor(opts?: { trackLatency?: boolean }) {
    this.trackLatency = opts?.trackLatency ?? true;
    this.emitter.setMaxListeners(0);
    for (const t of TOPICS) this.buffers.set(t, []);
    // The orchestrator owns suppressed/escalated/actions, but the contract is
    // frozen — so it reports them the only way it can: by publishing. We derive
    // the funnel from the decisions topic and the arbiter's agent-bus verdicts.
    this.emitter.on('decisions', (e: EventEnvelope<DecisionEvent>) => this.foldDecision(e.payload));
    this.emitter.on('agent-bus', (e: EventEnvelope<AgentBusEvent>) => this.foldAgent(e.payload));
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.windowStartedAt = nowIso();
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }

  transport(): 'laserdata' | 'local' {
    return 'local';
  }

  // ── pub / sub ────────────────────────────────────────────────────────────

  async publish<T extends HopperEvent>(topic: Topic, payload: T): Promise<EventEnvelope<T>> {
    const t0 = performance.now();

    if (topic === 'advisories' && !this.replayMode) {
      const ghsa = (payload as unknown as AdvisoryEvent).advisory?.ghsa_id;
      if (typeof ghsa === 'string') {
        if (this.seenAdvisories.has(ghsa)) {
          this.deduped += 1;
          const prior = this.buffers
            .get('advisories')!
            .find((e) => (e.payload as unknown as AdvisoryEvent).advisory?.ghsa_id === ghsa);
          if (prior) return prior as EventEnvelope<T>;
        } else {
          this.seenAdvisories.add(ghsa);
        }
      }
    }

    const env: EventEnvelope<T> = {
      id: mkId('evt'),
      topic,
      ts: nowIso(),
      seq: this.seq,
      payload,
    };
    this.seq += 1;

    if (!validateEvent(payload).ok) this.invalid += 1;

    const buf = this.buffers.get(topic);
    if (buf) {
      buf.push(env as EventEnvelope<HopperEvent>);
      if (buf.length > HISTORY_CAP) buf.splice(0, buf.length - HISTORY_CAP);
    }

    if (topic === 'advisories') this.ingested += 1;
    this.index(payload);

    // synchronous fan-out: subscribers observe strict publish order
    this.emitter.emit(topic, env);

    if (this.trackLatency) this.pushLatency(performance.now() - t0);
    return env;
  }

  subscribe<T extends HopperEvent>(
    topic: Topic,
    handler: (e: EventEnvelope<T>) => void | Promise<void>,
  ): Unsubscribe {
    const wrapped = (e: EventEnvelope<T>): void => {
      try {
        const r = handler(e);
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch((err: unknown) => {
            console.warn(`[ingest] subscriber on ${topic} rejected:`, err);
          });
        }
      } catch (err) {
        console.warn(`[ingest] subscriber on ${topic} threw:`, err);
      }
    };
    this.emitter.on(topic, wrapped as (...args: unknown[]) => void);
    return () => {
      this.emitter.off(topic, wrapped as (...args: unknown[]) => void);
    };
  }

  history<T extends HopperEvent>(topic: Topic, limit?: number): EventEnvelope<T>[] {
    const buf = (this.buffers.get(topic) ?? []) as EventEnvelope<T>[];
    if (limit === undefined || limit >= buf.length) return [...buf];
    return buf.slice(buf.length - limit);
  }

  // ── kv ───────────────────────────────────────────────────────────────────

  async kvSet(namespace: string, key: string, value: unknown): Promise<void> {
    let ns = this.store.get(namespace);
    if (!ns) {
      ns = new Map<string, unknown>();
      this.store.set(namespace, ns);
    }
    ns.set(key, clone(value));
    this.remember(namespace, `${key} ${safeText(value)}`);
  }

  async kvGet<T = unknown>(namespace: string, key: string): Promise<T | null> {
    const ns = this.store.get(namespace);
    if (!ns || !ns.has(key)) return null;
    return clone(ns.get(key)) as T;
  }

  async kvList<T = unknown>(namespace: string): Promise<Array<{ key: string; value: T }>> {
    const ns = this.store.get(namespace);
    if (!ns) return [];
    return [...ns.entries()].map(([key, value]) => ({ key, value: clone(value) as T }));
  }

  // ── memory / recall ──────────────────────────────────────────────────────

  remember(namespace: string, text: string): void {
    if (!text) return;
    let rows = this.memory.get(namespace);
    if (!rows) {
      rows = [];
      this.memory.set(namespace, rows);
    }
    rows.push({ text, ts: nowIso() });
    if (rows.length > MEMORY_CAP) rows.splice(0, rows.length - MEMORY_CAP);
  }

  async recall(namespace: string, q: string): Promise<Array<{ text: string; score: number }>> {
    const rows = this.memory.get(namespace) ?? [];
    const scored = rows
      .map((r) => ({ text: r.text, score: scoreText(r.text, q) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
    // collapse identical texts, keep the best score
    const out: Array<{ text: string; score: number }> = [];
    const seen = new Set<string>();
    for (const r of scored) {
      if (seen.has(r.text)) continue;
      seen.add(r.text);
      out.push(r);
      if (out.length >= 20) break;
    }
    return out;
  }

  // ── metrics ──────────────────────────────────────────────────────────────

  stats(): FunnelStats {
    return {
      ingested: this.ingested,
      deduped: this.deduped,
      traversed: this.traversed.size,
      suppressed: this.suppressed.size,
      escalated: this.escalated.size,
      actions: this.actions,
      p99_ms: this.p99(),
      window_started_at: this.windowStartedAt,
    };
  }

  p99(): number {
    return percentile(this.latencies, 99);
  }

  pushLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > LATENCY_CAP) this.latencies.splice(0, this.latencies.length - LATENCY_CAP);
  }

  invalidCount(): number {
    return this.invalid;
  }

  // ── replay mode ──────────────────────────────────────────────────────────

  beginReplay(): void {
    this.replayMode = true;
  }

  endReplay(): void {
    this.replayMode = false;
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** feed the recall index from the event stream itself */
  private index(payload: HopperEvent): void {
    switch (payload.kind) {
      case 'advisory': {
        const a = payload.advisory;
        this.remember(
          'incidents',
          `${a.ghsa_id} ${a.cve_id ?? ''} ${a.package_name} ${a.severity} cvss ${a.cvss}${
            a.in_kev ? ' KEV' : ''
          } — ${a.summary}`,
        );
        break;
      }
      case 'agent-bus':
        this.remember('agents', `${payload.ghsa_id} ${payload.agent} ${payload.phase} — ${payload.message}`);
        break;
      case 'decision':
        this.remember('decisions', `${payload.ghsa_id} ${payload.action} ${payload.status} auto=${payload.auto}`);
        break;
      case 'kev-delta':
        this.remember('incidents', `${payload.cve_id} added to CISA KEV ${payload.added_at} action=${payload.action}`);
        break;
      default:
        break;
    }
  }

  private foldDecision(d: DecisionEvent): void {
    if (!d || typeof d.ghsa_id !== 'string') return;
    this.traversed.add(d.ghsa_id);
    if (d.status === 'executed') {
      this.actions += 1;
      this.escalated.add(d.ghsa_id);
      this.suppressed.delete(d.ghsa_id);
    } else if (d.status === 'proposed' || d.status === 'pending_approval') {
      this.escalated.add(d.ghsa_id);
      this.suppressed.delete(d.ghsa_id);
    } else if (d.status === 'rejected' && !this.escalated.has(d.ghsa_id)) {
      this.suppressed.add(d.ghsa_id);
    }
  }

  private foldAgent(a: AgentBusEvent): void {
    if (!a || typeof a.ghsa_id !== 'string') return;
    this.traversed.add(a.ghsa_id);
    const decision = readDecision(a.payload);
    if (decision === 'suppress' || (a.phase === 'resolved' && /suppress/i.test(a.message ?? ''))) {
      if (!this.escalated.has(a.ghsa_id)) this.suppressed.add(a.ghsa_id);
    } else if (decision === 'auto' || decision === 'human') {
      this.escalated.add(a.ghsa_id);
      this.suppressed.delete(a.ghsa_id);
    }
  }
}

function readDecision(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const d = (payload as { decision?: unknown }).decision;
  return typeof d === 'string' ? d : null;
}

function clone<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v)) as T;
  }
}

function safeText(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return String(v);
  }
}

/** substring + token overlap, 0..1. Deterministic, no embeddings, no network. */
export function scoreText(text: string, q: string): number {
  const t = text.toLowerCase();
  const query = q.toLowerCase().trim();
  if (!query) return 0;
  let s = 0;
  if (t.includes(query)) s += 0.6 + Math.min(0.2, query.length / Math.max(t.length, 1));
  const tokens = query.split(/[^a-z0-9@._/+-]+/).filter((x) => x.length > 1);
  if (tokens.length > 0) {
    const hits = tokens.filter((tok) => t.includes(tok)).length;
    s += 0.4 * (hits / tokens.length);
  }
  return Math.min(1, Number(s.toFixed(4)));
}
