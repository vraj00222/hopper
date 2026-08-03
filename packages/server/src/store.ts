/**
 * HOPPER — read model. Folds bus events and pipeline runs into the AppState
 * the UI renders. Purely derived; holds no truth of its own.
 */
import {
  API_PORT,
  type Advisory,
  type AdvisoryEvent,
  type AgentBusEvent,
  type AppState,
  type ClockTick,
  type DecisionEvent,
  type FeedItem,
  type FocusView,
  type PipelineRun,
  type ServerMessage,
  HERO_GHSA,
} from '@hopper/contracts';
import type { Hopper } from './wire.js';

export class Store {
  private feed = new Map<string, FeedItem>();
  private transcripts = new Map<string, AgentBusEvent[]>();
  private clocks = new Map<string, ClockTick>();
  private focusId: string | null = null;
  private listeners = new Set<(m: ServerMessage) => void>();

  constructor(private hopper: Hopper) {
    this.attach();
  }

  onMessage(fn: (m: ServerMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(m: ServerMessage): void {
    for (const l of this.listeners) {
      try {
        l(m);
      } catch {
        /* a dead socket must not stop the arc */
      }
    }
  }

  private attach(): void {
    const { bus } = this.hopper;

    bus.subscribe<AdvisoryEvent>('advisories', (e) => {
      const a = e.payload.advisory;
      if (!a) return;
      const existing = this.feed.get(a.ghsa_id);
      const item: FeedItem = {
        ghsa_id: a.ghsa_id,
        cve_id: a.cve_id,
        package: a.package_name,
        severity: a.severity,
        published_at: a.published_at,
        received_at: e.payload.received_at ?? e.ts,
        hops: existing?.hops ?? 0,
        state: existing?.state ?? 'ingested',
        customers: existing?.customers ?? 0,
        in_kev: a.in_kev,
        summary: a.summary,
      };
      this.feed.set(a.ghsa_id, item);
      this.emit({ type: 'feed', item });
    });

    bus.subscribe<ClockTick>('clock', (e) => {
      const t = e.payload;
      if (!t?.customer) return;
      this.clocks.set(`${t.ghsa_id}:${t.customer}`, t);
      this.emit({ type: 'clock', tick: t });
    });

    bus.subscribe<AgentBusEvent>('agent-bus', (e) => {
      const ev = e.payload;
      if (!ev?.ghsa_id) return;
      const list = this.transcripts.get(ev.ghsa_id) ?? [];
      list.push(ev);
      this.transcripts.set(ev.ghsa_id, list);
      this.emit({ type: 'agent', event: ev });
    });

    bus.subscribe<DecisionEvent>('decisions', (e) => {
      const d = e.payload;
      if (!d?.ghsa_id) return;
      const item = this.feed.get(d.ghsa_id);
      if (item) {
        item.state =
          d.status === 'pending_approval'
            ? 'awaiting_approval'
            : d.status === 'executed'
              ? 'escalated'
              : item.state;
        this.emit({ type: 'feed', item });
      }
      if (d.receipt) this.emit({ type: 'receipt', receipt: d.receipt });
    });
  }

  /** called by the orchestrator wrapper once a run completes */
  applyRun(run: PipelineRun): void {
    const item = this.feed.get(run.ghsa_id);
    const hops = run.hop_paths.length ? Math.max(...run.hop_paths.map((p) => p.hops)) : 0;
    if (item) {
      item.hops = hops;
      item.customers = new Set(run.hop_paths.map((p) => p.customer)).size;
      item.state =
        run.outcome === 'suppressed'
          ? 'suppressed'
          : run.receipts.some((r) => !r.ok)
            ? 'awaiting_approval'
            : 'escalated';
      this.emit({ type: 'feed', item });
    }
    this.emit({ type: 'run', run });
    this.emit({ type: 'funnel', funnel: this.hopper.orchestrator.funnel() });
    this.focusId = run.ghsa_id;
  }

  /** the signature animation: one ring per 300ms, driven server-side so the
   *  replay and the live run look identical. */
  async propagate(run: PipelineRun, intervalMs: number): Promise<void> {
    const best = [...run.hop_paths].sort((a, b) => a.notice_window - b.notice_window)[0];
    const suppressed = run.outcome === 'suppressed';
    const chain = suppressed ? [run.ghsa_id.slice(0, 12), 'no dependent repo'] : (best?.chain ?? []);
    for (let i = 0; i < chain.length; i++) {
      this.emit({
        type: 'hop',
        ghsa_id: run.ghsa_id,
        hop: i,
        total: chain.length,
        node: chain[i],
        terminal: i === chain.length - 1,
        suppressed,
      });
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  async focus(ghsaId: string): Promise<FocusView | null> {
    const { graph, agents, orchestrator, meta } = this.hopper;
    const run = orchestrator.runs().find((r) => r.ghsa_id === ghsaId) ?? null;

    const rows = await graph
      .query<{ a: Record<string, unknown> }>(
        'MATCH (a:Advisory {ghsa_id:$id}) RETURN a LIMIT 1',
        { id: ghsaId },
      )
      .catch(() => []);
    const advisory = (rows[0]?.a ?? null) as Advisory | null;
    if (!advisory && !run) return null;

    const [hop_paths, absence, precedents, oncall, audit] = await Promise.all([
      graph.hopPaths(ghsaId).catch(() => []),
      graph.proveAbsence(ghsaId).catch(() => null),
      run?.agent_result
        ? graph.precedent(run.agent_result.patch.target ?? '').catch(() => [])
        : Promise.resolve([]),
      graph.whoToWake(ghsaId).catch(() => []),
      graph.auditTrail(ghsaId).catch(() => []),
    ]);

    const ar = run?.agent_result;
    const focus: FocusView = {
      advisory: advisory as never,
      advisory_class: (run
        ? meta.classify({
            advisory: advisory as never,
            maxHops: hop_paths.length ? Math.max(...hop_paths.map((p) => p.hops)) : 0,
            pathCount: hop_paths.length,
            isChokepoint: false,
          })
        : { id: 'unknown', ecosystem: 'npm', severity_band: 'low', depth_band: 'none' }) as never,
      hop_paths,
      absence,
      precedents,
      oncall,
      transcript: this.transcripts.get(ghsaId) ?? agents.transcript(ghsaId),
      verdicts: {
        reachability: ar && {
          verdict: ar.reachability.reachable ? 'REACHABLE' : 'NOT REACHABLE',
          confidence: ar.reachability.confidence,
          detail: ar.reachability.rationale,
        },
        patch: ar && {
          verdict: ar.patch.safe_bump ? `BUMP ${ar.patch.target}` : 'CONFLICT',
          confidence: ar.patch.confidence,
          detail: ar.patch.rationale,
          conflict: !ar.patch.safe_bump,
        },
        obligation: ar && {
          verdict: ar.obligation.obligated
            ? `${ar.obligation.clauses[0]?.clause_ref ?? ''} · ${ar.obligation.clauses[0]?.hours ?? 0}h`
            : 'NO OBLIGATION',
          confidence: ar.obligation.confidence,
          detail: ar.obligation.rationale,
        },
        arbiter: ar && {
          verdict: ar.arbiter.decision.toUpperCase(),
          confidence: ar.arbiter.confidence,
          detail: ar.arbiter.rationale,
        },
      } as never,
      clocks: [...this.clocks.values()].filter((c) => c.ghsa_id === ghsaId),
      approvals: agents.pendingApprovals().filter((a) => a.ghsa_id === ghsaId),
      receipts: run?.receipts ?? [],
      run,
      audit,
    };
    this.focusId = ghsaId;
    return focus;
  }

  async state(): Promise<AppState> {
    const { bus, graph, agents, orchestrator, meta, tools } = this.hopper;
    const [graph_stats, chokepoints, pipelines] = await Promise.all([
      graph.stats().catch(() => ({
        nodes: 0,
        edges: 0,
        advisories: 0,
        packages: 0,
        customers: 0,
        chokepoints: 0,
      })),
      graph.chokePoints(8).catch(() => []),
      meta.leaderboard().catch(() => []),
    ]);

    const feed = [...this.feed.values()].sort((a, b) =>
      b.received_at.localeCompare(a.received_at),
    );

    return {
      status: {
        live: bus.transport() === 'laserdata',
        mock: this.hopper.mock,
        transport: bus.transport(),
        graph_connected: this.hopper.graphConnected,
        advisories_24h: feed.filter(
          (f) => Date.now() - new Date(f.received_at).getTime() < 86_400_000,
        ).length,
        kev_count: feed.filter((f) => f.in_kev).length,
        falkor_ui: 'http://localhost:3000',
        rocketride_trace: `http://localhost:${API_PORT}/api/runs`,
        started_at: this.hopper.startedAt,
      },
      feed,
      funnel: orchestrator.funnel(),
      clocks: [...this.clocks.values()],
      approvals: agents.pendingApprovals(),
      receipts: tools.receipts(),
      runs: orchestrator.runs(),
      pipelines,
      graph_stats,
      chokepoints,
      focus: this.focusId ? await this.focus(this.focusId) : null,
    };
  }

  currentFocus(): string | null {
    return this.focusId ?? HERO_GHSA;
  }
}
