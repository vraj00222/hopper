/**
 * HOPPER — the Guild control plane.
 *
 * `@guild-ai/sdk` is not published (npm returns 404 for the package), so this is a
 * Guild-COMPATIBLE control plane implemented locally: Workspace, Session, scoped
 * Credentials, native human-in-the-loop Approvals, and session traces that can be
 * read back out programmatically.
 *
 * The shapes here are deliberately the ones a hosted control plane would expose, and
 * every call site in this package goes through them. When the real SDK ships, swap
 * `LocalTransport` for an SDK-backed transport and nothing above this file changes.
 * Setting GUILD_API_URL with MOCK=false additionally mirrors sessions and approval
 * decisions to a remote control plane, best-effort: the in-memory workspace stays the
 * source of truth, so a remote that is absent, slow or broken degrades to local
 * without failing a run.
 */
import {
  id,
  nowIso,
  type ActionKind,
  type AgentBusEvent,
  type ApprovalRequest,
} from '@hopper/contracts';

import type { Redactor } from './redact.js';

// ─── sessions ───────────────────────────────────────────────────────────────

export interface GuildSession {
  id: string;
  workspace: string;
  ghsa_id: string;
  started_at: string;
  ended_at: string | null;
  steps: AgentBusEvent[];
}

// ─── credentials (G7) ───────────────────────────────────────────────────────

/** names we will look up in the process environment when not seeded explicitly */
export const KNOWN_CREDENTIALS = [
  'GITHUB_TOKEN',
  'SLACK_WEBHOOK',
  'JIRA_TOKEN',
  'GUILD_API_KEY',
] as const;

/**
 * A scoped credential store. Values are held in a private field, never handed to an
 * agent, never placed on a context object, and resolved only at execution time by the
 * component that is about to make the call. Agents may ask whether a credential exists;
 * they cannot ask what it is.
 */
export class Credentials {
  readonly scope: string;
  #values = new Map<string, string>();

  constructor(scope: string, seed: Record<string, string> = {}) {
    this.scope = scope;
    for (const [k, v] of Object.entries(seed)) {
      if (typeof v === 'string' && v.length > 0) this.#values.set(k, v);
    }
  }

  /** presence only — this is all an agent is ever told */
  has(name: string): boolean {
    if (this.#values.has(name)) return true;
    const env = process.env[name];
    return typeof env === 'string' && env.length > 0;
  }

  names(): string[] {
    const fromEnv = KNOWN_CREDENTIALS.filter((n) => {
      const v = process.env[n];
      return typeof v === 'string' && v.length > 0;
    });
    return [...new Set([...this.#values.keys(), ...fromEnv])].sort();
  }

  /** zero-trust resolution: happens at the moment of use, not at agent construction */
  async resolve(name: string): Promise<string | null> {
    const local = this.#values.get(name);
    if (typeof local === 'string' && local.length > 0) return local;
    const env = process.env[name];
    return typeof env === 'string' && env.length > 0 ? env : null;
  }

  /** every value we know about, for the redactor only. Not exported upward. */
  secrets(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.#values) out[k] = v;
    for (const n of KNOWN_CREDENTIALS) {
      const v = process.env[n];
      if (typeof v === 'string' && v.length > 0 && !(n in out)) out[n] = v;
    }
    return out;
  }

  /** serialising the store yields names, never values */
  toJSON(): { scope: string; names: string[] } {
    return { scope: this.scope, names: this.names() };
  }
}

// ─── approvals (G6) ─────────────────────────────────────────────────────────

export interface ApprovalInput {
  action: ActionKind;
  ghsa_id: string;
  title: string;
  body: string;
}

export class ApprovalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalStateError';
  }
}

/**
 * The native HITL primitive. requestApproval() issues NO credential of any kind; the
 * executor's bearer string is minted inside approve() and nowhere else in this package
 * (the gate proves that statically as well as at runtime). Callers always receive
 * copies, so writing a forged field onto a returned object cannot poison the store.
 */
export class Approvals {
  private readonly store = new Map<string, ApprovalRequest>();
  private onDecision: ((a: ApprovalRequest) => void) | null = null;

  observe(fn: (a: ApprovalRequest) => void): void {
    this.onDecision = fn;
  }

  requestApproval(input: ApprovalInput): ApprovalRequest {
    const rec: ApprovalRequest = {
      id: id('apv'),
      action: input.action,
      ghsa_id: input.ghsa_id,
      title: input.title,
      body: input.body,
      requested_at: nowIso(),
      status: 'pending',
    };
    this.store.set(rec.id, rec);
    return { ...rec };
  }

  approve(approvalId: string, approver: string): ApprovalRequest {
    const rec = this.require(approvalId);
    if (rec.status !== 'pending') {
      throw new ApprovalStateError(
        `approval ${approvalId} is already ${rec.status}; a decided request cannot be re-decided`,
      );
    }
    if (!approver || approver.trim().length === 0) {
      throw new ApprovalStateError('an approver identity is required');
    }
    rec.status = 'approved';
    rec.approved_by = approver;
    rec.decided_at = nowIso();
    // ── TOKEN MINT REGION · BEGIN ──────────────────────────────────────────
    // The single place in @hopper/agents where an executor bearer string comes
    // into existence. It is reachable only from a human decision above.
    rec.token = `gld_${id('tok')}_${approvalId.slice(-6)}`;
    // ── TOKEN MINT REGION · END ────────────────────────────────────────────
    this.onDecision?.({ ...rec });
    return { ...rec };
  }

  reject(approvalId: string, approver: string): ApprovalRequest {
    const rec = this.require(approvalId);
    if (rec.status !== 'pending') {
      throw new ApprovalStateError(
        `approval ${approvalId} is already ${rec.status}; a decided request cannot be re-decided`,
      );
    }
    rec.status = 'rejected';
    rec.approved_by = approver;
    rec.decided_at = nowIso();
    this.onDecision?.({ ...rec });
    return { ...rec };
  }

  get(approvalId: string): ApprovalRequest | null {
    const rec = this.store.get(approvalId);
    return rec ? { ...rec } : null;
  }

  pending(): ApprovalRequest[] {
    return [...this.store.values()].filter((a) => a.status === 'pending').map((a) => ({ ...a }));
  }

  all(): ApprovalRequest[] {
    return [...this.store.values()].map((a) => ({ ...a }));
  }

  forAdvisory(ghsaId: string): ApprovalRequest[] {
    return this.all().filter((a) => a.ghsa_id === ghsaId);
  }

  private require(approvalId: string): ApprovalRequest {
    const rec = this.store.get(approvalId);
    if (!rec) throw new ApprovalStateError(`no approval request ${approvalId}`);
    return rec;
  }
}

// ─── transport ──────────────────────────────────────────────────────────────

export interface GuildTransport {
  readonly kind: 'local' | 'guild-http';
  openSession(session: GuildSession): Promise<void>;
  appendStep(sessionId: string, step: AgentBusEvent): Promise<void>;
  closeSession(session: GuildSession): Promise<void>;
  recordDecision(approval: ApprovalRequest): Promise<void>;
  degraded(): boolean;
}

const noop = async (): Promise<void> => undefined;

export function localTransport(): GuildTransport {
  return {
    kind: 'local',
    openSession: noop,
    appendStep: noop,
    closeSession: noop,
    recordDecision: noop,
    degraded: () => false,
  };
}

/**
 * Best-effort mirror to a hosted control plane. The first failure marks the transport
 * degraded and stops further attempts, so a missing or slow remote costs one timeout
 * per process rather than one per step.
 */
export function httpTransport(baseUrl: string, timeoutMs = 1500): GuildTransport {
  let down = false;
  const post = async (route: string, body: unknown): Promise<void> => {
    if (down) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) down = true;
    } catch {
      down = true;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    kind: 'guild-http',
    openSession: (s) => post('/v1/sessions', { id: s.id, workspace: s.workspace, ghsa_id: s.ghsa_id }),
    appendStep: (sid, step) => post(`/v1/sessions/${sid}/steps`, step),
    closeSession: (s) => post(`/v1/sessions/${s.id}/close`, { ended_at: s.ended_at }),
    // the bearer string is deliberately not mirrored
    recordDecision: (a) =>
      post('/v1/approvals/decision', {
        id: a.id,
        status: a.status,
        approved_by: a.approved_by,
        decided_at: a.decided_at,
      }),
    degraded: () => down,
  };
}

// ─── workspace ──────────────────────────────────────────────────────────────

export interface WorkspaceOptions {
  name: string;
  mock: boolean;
  credentials?: Record<string, string>;
  apiUrl?: string | null;
  redactor: Redactor;
}

export class Workspace {
  readonly name: string;
  readonly mock: boolean;
  readonly credentials: Credentials;
  readonly approvals = new Approvals();
  private readonly sessions = new Map<string, GuildSession>();
  private readonly byAdvisory = new Map<string, string[]>();
  private readonly transportImpl: GuildTransport;
  private readonly redactor: Redactor;

  constructor(opts: WorkspaceOptions) {
    this.name = opts.name;
    this.mock = opts.mock;
    this.redactor = opts.redactor;
    this.credentials = new Credentials(opts.name, opts.credentials ?? {});
    const remote = !opts.mock && opts.apiUrl ? opts.apiUrl : null;
    this.transportImpl = remote ? httpTransport(remote) : localTransport();
    this.approvals.observe((a) => {
      void this.transportImpl.recordDecision(a);
    });
  }

  transport(): GuildTransport['kind'] {
    return this.transportImpl.degraded() ? 'local' : this.transportImpl.kind;
  }

  async openSession(ghsaId: string): Promise<GuildSession> {
    const session: GuildSession = {
      id: id('gses'),
      workspace: this.name,
      ghsa_id: ghsaId,
      started_at: nowIso(),
      ended_at: null,
      steps: [],
    };
    this.sessions.set(session.id, session);
    const list = this.byAdvisory.get(ghsaId) ?? [];
    list.push(session.id);
    this.byAdvisory.set(ghsaId, list);
    await this.transportImpl.openSession(session);
    return session;
  }

  /** every step is redacted on the way in, so nothing sensitive is ever stored */
  async appendStep(sessionId: string, step: AgentBusEvent): Promise<AgentBusEvent> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`no guild session ${sessionId}`);
    const safe = this.redactor.deep({ ...step, session_id: sessionId });
    session.steps.push(safe);
    await this.transportImpl.appendStep(sessionId, safe);
    return safe;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.ended_at = nowIso();
    await this.transportImpl.closeSession(session);
  }

  session(sessionId: string): GuildSession | null {
    const s = this.sessions.get(sessionId);
    return s ? { ...s, steps: [...s.steps] } : null;
  }

  /** G8 — the audit panel reads this back out */
  sessionTrace(sessionId: string): AgentBusEvent[] {
    return this.sessions.get(sessionId)?.steps.map((s) => ({ ...s })) ?? [];
  }

  /** every step across every session for one advisory, in order */
  advisoryTrace(ghsaId: string): AgentBusEvent[] {
    return (this.byAdvisory.get(ghsaId) ?? []).flatMap((sid) => this.sessionTrace(sid));
  }

  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }
}
