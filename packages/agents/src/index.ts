/**
 * HOPPER — @hopper/agents. The Guild slice.
 *
 * Four graph-grounded agents behind one AgentsPort, run inside a Guild-compatible
 * control plane: a workspace, a session per run, a scoped credential store, native
 * human-in-the-loop approvals, and a session trace that reads back out.
 *
 * Depends on @hopper/contracts and nothing else in this repo. A graph and a bus are
 * optional injections; with neither, the package runs fully standalone.
 */
import {
  id,
  nowIso,
  type ActionKind,
  type AgentBusEvent,
  type AgentInput,
  type AgentName,
  type AgentRunResult,
  type AgentsPort,
  type ApprovalRequest,
  type ArbiterVerdict,
  type EventBusPort,
  type GraphPort,
  type ObligationVerdict,
  type PatchVerdict,
  type ReachabilityVerdict,
  type Verdict,
} from '@hopper/contracts';

import { Workspace } from './guild.js';
import { createLlm, type Llm } from './llm.js';
import { createRedactor } from './redact.js';
import { assertVerdict } from './validate.js';
import { runReachability } from './agents/reachability.js';
import { runPatchEngineer } from './agents/patch-engineer.js';
import { runObligationOfficer } from './agents/obligation-officer.js';
import { deriveArbiter, REQUIRES_APPROVAL, runArbiter } from './agents/arbiter.js';
import type { AgentContext, GroundedInput } from './agents/context.js';

export interface CreateAgentsOptions {
  /** default: MOCK env (true unless MOCK=false). MOCK means deterministic and offline. */
  mock?: boolean;
  /** optional: dual-write every verdict as an AgentVerdict node (G8) */
  graph?: GraphPort;
  /** optional: publish the transcript to the agent-bus topic (L5) */
  bus?: EventBusPort;
  /** seeded credentials; the process environment is consulted at execution time too */
  credentials?: Record<string, string>;
  workspace?: string;
  /** hosted Guild control plane to mirror to; defaults to GUILD_API_URL */
  apiUrl?: string | null;
  apiKey?: string | null;
}

export function createAgents(opts: CreateAgentsOptions = {}): AgentsPort {
  const mock = opts.mock ?? isMockEnv();
  const redactor = createRedactor(() => workspace.credentials.secrets());
  const workspace = new Workspace({
    name: opts.workspace ?? 'hopper',
    mock,
    credentials: opts.credentials,
    apiUrl: opts.apiUrl ?? process.env.GUILD_API_URL ?? null,
    redactor,
  });
  const llm: Llm | null = createLlm({ mock, redactor, apiKey: opts.apiKey });

  async function run(input: AgentInput): Promise<AgentRunResult> {
    const advisory = input.advisory;
    const ghsa_id = advisory.ghsa_id;
    const bus = input.bus ?? opts.bus ?? null;
    const graph = input.graph ?? opts.graph ?? null;

    const grounded: GroundedInput = {
      advisory,
      hopPaths: input.hopPaths ?? [],
      telemetry: input.telemetry ?? [],
      precedents: input.precedents ?? [],
      isChokepoint: input.isChokepoint ?? false,
    };

    const session = await workspace.openSession(ghsa_id);
    const notes: string[] = [];
    const ctx: AgentContext = {
      grounded,
      llm,
      hasCredential: (name) => workspace.credentials.has(name),
      note: (m) => notes.push(m),
    };

    const emit = async (
      agent: AgentName,
      phase: AgentBusEvent['phase'],
      message: string,
      confidence?: number,
      payload?: unknown,
    ): Promise<void> => {
      const event: AgentBusEvent = {
        kind: 'agent-bus',
        agent,
        ghsa_id,
        phase,
        message,
        session_id: session.id,
        ...(confidence === undefined ? {} : { confidence }),
        ...(payload === undefined ? {} : { payload }),
      };
      const stored = await workspace.appendStep(session.id, event);
      if (bus) {
        try {
          await bus.publish('agent-bus', stored);
        } catch {
          // the bus is an optional collaborator; a run never fails because of it
        }
      }
    };

    const flushNotes = async (agent: AgentName): Promise<void> => {
      while (notes.length > 0) {
        const message = notes.shift();
        if (message) await emit(agent, 'error', message);
      }
    };

    const dualWrite = async (v: Verdict): Promise<void> => {
      if (!graph) return;
      try {
        await graph.recordVerdict(
          redactor.deep({
            id: id('av'),
            agent: v.agent,
            verdict: summarise(v),
            confidence: v.confidence,
            rationale: v.rationale,
            ts: nowIso(),
            ghsa_id,
            payload_json: JSON.stringify(v),
          }),
        );
      } catch (err) {
        await emit(v.agent, 'error', `graph dual-write failed: ${errText(err)}`);
      }
    };

    // ── G1 ────────────────────────────────────────────────────────────────
    await emit(
      'reachability',
      'started',
      `Reachability Analyst opened on ${ghsa_id}: ${grounded.hopPaths.length} hop path(s), ` +
        `${grounded.telemetry.length} telemetry window(s).`,
    );
    // redact on the way out as well as on the way in: agents quote graph data, and
    // graph data is not guaranteed clean
    const reachability = assertVerdict<ReachabilityVerdict>(
      'reachability',
      redactor.deep(await runReachability(ctx)),
    );
    await flushNotes('reachability');
    await emit(
      'reachability',
      'verdict',
      reachability.reachable
        ? `Reachable — ${reachability.telemetry_hits} calls on ${reachability.call_path.join(' → ')}`
        : `Not reachable — ${reachability.telemetry_hits} on-path calls observed`,
      reachability.confidence,
      reachability,
    );
    await dualWrite(reachability);

    // ── G2 ────────────────────────────────────────────────────────────────
    const credNames = workspace.credentials.names();
    await emit(
      'patch-engineer',
      'started',
      `Patch Engineer opened on ${advisory.package_name} ${advisory.vulnerable_range} → ${advisory.fixed_in ?? 'no fix'}; ` +
        `${grounded.precedents.length} precedent(s) in the graph. Executor credentials in scope: ` +
        `${credNames.length ? credNames.join(', ') : 'none'} (presence only — values resolve at execution time and never ` +
        `enter an agent context).`,
    );
    const patch = assertVerdict<PatchVerdict>('patch-engineer', redactor.deep(await runPatchEngineer(ctx)));
    await flushNotes('patch-engineer');
    await emit(
      'patch-engineer',
      'verdict',
      patch.safe_bump
        ? `Safe bump to ${patch.target} — ${patch.breaking_risk} breaking risk`
        : `Bump withheld — ${patch.breaking_risk} breaking risk${patch.precedent_ids.length ? `, precedent ${patch.precedent_ids.join(', ')}` : ''}`,
      patch.confidence,
      patch,
    );
    await dualWrite(patch);

    // ── G3 ────────────────────────────────────────────────────────────────
    await emit(
      'obligation-officer',
      'started',
      `Obligation Officer opened: walking ${grounded.hopPaths.length} customer path(s) for notice clauses.`,
    );
    const obligation = assertVerdict<ObligationVerdict>(
      'obligation-officer',
      redactor.deep(await runObligationOfficer(ctx)),
    );
    await flushNotes('obligation-officer');
    await emit(
      'obligation-officer',
      'verdict',
      obligation.obligated
        ? `Obligated — ${obligation.clauses.length} clause(s), tightest deadline ${obligation.deadline_utc}`
        : 'No contractual notice window opens',
      obligation.confidence,
      obligation,
    );
    await dualWrite(obligation);

    // ── G4 / G5 ───────────────────────────────────────────────────────────
    await emit('arbiter', 'started', 'Arbiter opened: reconciling three verdicts.');
    const arbiter = assertVerdict<ArbiterVerdict>(
      'arbiter',
      redactor.deep(await runArbiter(ctx, { grounded, reachability, patch, obligation })),
    );
    await flushNotes('arbiter');
    if (arbiter.conflict) {
      await emit(
        'arbiter',
        'conflict',
        `Conflict between ${arbiter.conflict_between.join(' and ')}: ${arbiter.rationale}`,
        arbiter.confidence,
        { conflict_between: arbiter.conflict_between },
      );
    }
    await emit(
      'arbiter',
      'verdict',
      `${arbiter.decision.toUpperCase()} — ${arbiter.actions.length ? arbiter.actions.join(', ') : 'no action'}`,
      arbiter.confidence,
      arbiter,
    );
    await dualWrite(arbiter);

    // ── G6 — approvals for anything a machine may not do alone ────────────
    const approvals: ApprovalRequest[] = [];
    for (const action of arbiter.actions) {
      if (!REQUIRES_APPROVAL.has(action)) continue;
      approvals.push(
        workspace.approvals.requestApproval(redactor.deep(approvalFor(action, ghsa_id, obligation))),
      );
    }

    await emit(
      'arbiter',
      'resolved',
      `${arbiter.decision.toUpperCase()} · ${arbiter.actions.length ? arbiter.actions.join(', ') : 'no action'}` +
        (approvals.length
          ? ` · ${approvals.length} action(s) held for human approval: ${approvals.map((a) => a.action).join(', ')}`
          : '') +
        (arbiter.conflict ? ' · conflict escalated' : ''),
      arbiter.confidence,
      { decision: arbiter.decision, actions: arbiter.actions, approvals: approvals.map((a) => a.id) },
    );
    await workspace.closeSession(session.id);

    return {
      ghsa_id,
      session_id: session.id,
      reachability,
      patch,
      obligation,
      arbiter,
      conflict: arbiter.conflict,
      transcript: workspace.sessionTrace(session.id),
      approvals,
    };
  }

  return {
    run,
    transcript: (ghsaId) => workspace.advisoryTrace(ghsaId),
    pendingApprovals: () => workspace.approvals.pending(),
    approve: async (approvalId, approver) => workspace.approvals.approve(approvalId, approver),
    reject: async (approvalId, approver) => workspace.approvals.reject(approvalId, approver),
    approval: (approvalId) => workspace.approvals.get(approvalId),
    sessionTrace: async (sessionId) => workspace.sessionTrace(sessionId),
    credential: (name) => workspace.credentials.resolve(name),
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function approvalFor(
  action: ActionKind,
  ghsa_id: string,
  obligation: ObligationVerdict,
): { action: ActionKind; ghsa_id: string; title: string; body: string } {
  const clause = obligation.clauses[0];
  if (action === 'notify_customer' && clause) {
    return {
      action,
      ghsa_id,
      title: `Notify ${clause.customer} under ${clause.clause_ref} — deadline ${clause.deadline_utc}`,
      body: obligation.notice_draft,
    };
  }
  return {
    action,
    ghsa_id,
    title: `${action} for ${ghsa_id}`,
    body: obligation.notice_draft || `Approval required before ${action} can execute for ${ghsa_id}.`,
  };
}

function summarise(v: Verdict): string {
  switch (v.agent) {
    case 'reachability':
      return v.reachable ? 'reachable' : 'not_reachable';
    case 'patch-engineer':
      return v.safe_bump ? `safe_bump:${v.target ?? 'unknown'}` : `withheld:${v.breaking_risk}`;
    case 'obligation-officer':
      return v.obligated ? `obligated:${v.clauses.length}` : 'not_obligated';
    case 'arbiter':
      return v.conflict ? `${v.decision}:conflict` : v.decision;
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isMockEnv(): boolean {
  const v = process.env.MOCK;
  return v === undefined ? true : v !== 'false' && v !== '0';
}

// ─── public surface ─────────────────────────────────────────────────────────

export { Approvals, Credentials, Workspace, type GuildSession } from './guild.js';
export { MODEL_ID } from './llm.js';
export { REQUIRES_APPROVAL, deriveArbiter };
export {
  validateArbiter,
  validateObligation,
  validatePatch,
  validateReachability,
  VerdictShapeError,
} from './validate.js';
export type { AgentContext, GroundedInput } from './agents/context.js';
