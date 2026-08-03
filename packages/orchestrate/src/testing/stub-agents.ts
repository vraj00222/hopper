/**
 * In-memory AgentsPort for the gate ONLY. The real one is Guild, behind
 * @hopper/agents — including the real HITL approval primitive. This stub stages
 * the same disagreement (G5) and issues an approval so the escalation arc can be
 * driven end to end without a human in the room.
 */
import {
  isoPlusHours,
  nowIso,
  sleep,
  type AgentBusEvent,
  type AgentInput,
  type AgentRunResult,
  type AgentsPort,
  type ApprovalRequest,
} from '@hopper/contracts';

export interface StubAgents extends AgentsPort {
  calls: { run: number; credential: number };
  /** when false the approval stays pending and the customer notice is held */
  autoApprove: boolean;
}

export function createStubAgents(
  opts: { autoApprove?: boolean; latencyMs?: number } = {},
): StubAgents {
  const latency = opts.latencyMs ?? 110;
  const transcripts = new Map<string, AgentBusEvent[]>();
  const approvals = new Map<string, ApprovalRequest>();
  const calls = { run: 0, credential: 0 };

  const stub: StubAgents = {
    calls,
    autoApprove: opts.autoApprove ?? true,

    async run(input: AgentInput): Promise<AgentRunResult> {
      calls.run += 1;
      await sleep(latency);

      const ghsa = input.advisory.ghsa_id;
      const sessionId = `guild_${ghsa}_${Date.now().toString(36)}`;
      const hops = input.hopPaths.length ? Math.max(...input.hopPaths.map((p) => p.hops)) : 0;
      const telemetryHits = input.telemetry.reduce((a, t) => a + t.calls, 0);
      const broke = input.precedents.filter(
        (p) => p.outcome === 'broke_staging' || p.outcome === 'rolled_back',
      );
      const clauses = input.hopPaths.map((p) => ({
        customer: p.customer,
        clause_ref: p.clause_ref,
        hours: p.notice_window,
        deadline_utc: isoPlusHours(p.notice_window, new Date(input.advisory.published_at)),
      }));
      clauses.sort((a, b) => a.hours - b.hours);

      const transcript: AgentBusEvent[] = [
        {
          kind: 'agent-bus',
          agent: 'reachability',
          ghsa_id: ghsa,
          phase: 'verdict',
          message: `reachable via ${hops} hops`,
          confidence: 0.82,
          session_id: sessionId,
        },
        {
          kind: 'agent-bus',
          agent: 'patch-engineer',
          ghsa_id: ghsa,
          phase: broke.length ? 'conflict' : 'verdict',
          message: broke.length
            ? `CONFLICT — bumped ${broke[0].package} ${Math.round(broke[0].age_seconds)}s ago, staging broke`
            : 'safe bump available',
          confidence: 0.71,
          session_id: sessionId,
        },
        {
          kind: 'agent-bus',
          agent: 'arbiter',
          ghsa_id: ghsa,
          phase: 'resolved',
          message: 'escalate with human gate on the customer notice',
          confidence: 0.88,
          session_id: sessionId,
        },
      ];
      transcripts.set(ghsa, transcript);

      const approval: ApprovalRequest = {
        id: `apr_${ghsa}_${Date.now().toString(36)}`,
        action: 'notify_customer',
        ghsa_id: ghsa,
        title: `Notify ${clauses[0]?.customer ?? 'customer'} under ${clauses[0]?.clause_ref ?? 'contract'}`,
        body: 'Breach notification draft awaiting human approval.',
        requested_at: nowIso(),
        status: stub.autoApprove ? 'approved' : 'pending',
        approved_by: stub.autoApprove ? 'gate@hopper.dev' : undefined,
        decided_at: stub.autoApprove ? nowIso() : undefined,
        token: stub.autoApprove ? `tok_${Math.random().toString(36).slice(2, 12)}` : undefined,
      };
      approvals.set(approval.id, approval);

      return {
        ghsa_id: ghsa,
        session_id: sessionId,
        reachability: {
          agent: 'reachability',
          reachable: hops > 0,
          confidence: 0.82,
          call_path: input.hopPaths[0]?.chain ?? [],
          telemetry_hits: telemetryHits,
          rationale: `${input.hopPaths.length} dependency path(s), deepest ${hops} hops`,
        },
        patch: {
          agent: 'patch-engineer',
          safe_bump: broke.length === 0,
          target: input.advisory.fixed_in,
          breaking_risk: broke.length ? 'medium' : 'low',
          confidence: 0.71,
          precedent_ids: broke.map((p) => `${p.package}@${p.to_v}`),
          rationale: broke.length
            ? `a bump of ${broke[0].package} broke staging ${Math.round(broke[0].age_seconds)}s ago`
            : 'no adverse precedent on this package',
        },
        obligation: {
          agent: 'obligation-officer',
          obligated: clauses.length > 0,
          clauses,
          deadline_utc: clauses[0]?.deadline_utc ?? null,
          notice_draft: `Notice under ${clauses[0]?.clause_ref ?? 'contract'} regarding ${ghsa}.`,
          confidence: 0.9,
          rationale: `${clauses.length} breach-notification clause(s) on the paths`,
        },
        arbiter: {
          agent: 'arbiter',
          decision: 'human',
          conflict: broke.length > 0,
          conflict_between: broke.length ? ['reachability', 'patch-engineer'] : [],
          actions: ['open_pr', 'page_oncall', 'notify_customer', 'open_ticket'],
          confidence: 0.88,
          rationale: 'reachable and contractually material; customer notice is human-gated',
        },
        conflict: broke.length > 0,
        transcript,
        approvals: [approval],
      };
    },

    transcript: (ghsaId) => transcripts.get(ghsaId) ?? [],
    pendingApprovals: () => [...approvals.values()].filter((a) => a.status === 'pending'),
    async approve(id, approver) {
      const a = approvals.get(id);
      if (!a) throw new Error(`no approval ${id}`);
      const next: ApprovalRequest = {
        ...a,
        status: 'approved',
        approved_by: approver,
        decided_at: nowIso(),
        token: `tok_${Math.random().toString(36).slice(2, 12)}`,
      };
      approvals.set(id, next);
      return next;
    },
    async reject(id, approver) {
      const a = approvals.get(id);
      if (!a) throw new Error(`no approval ${id}`);
      const next: ApprovalRequest = {
        ...a,
        status: 'rejected',
        approved_by: approver,
        decided_at: nowIso(),
      };
      approvals.set(id, next);
      return next;
    },
    approval: (id) => approvals.get(id) ?? null,
    async sessionTrace(sessionId) {
      for (const t of transcripts.values()) {
        if (t.some((e) => e.session_id === sessionId)) return t;
      }
      return [];
    },
    async credential(name) {
      calls.credential += 1;
      return name === 'GITHUB_TOKEN' || name === 'SLACK_WEBHOOK' ? null : null;
    },
  };

  return stub;
}
