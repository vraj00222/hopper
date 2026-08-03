/**
 * R2 — the five-stage traversal chain, plus the suppression branch, the Guild
 * dispatch node, the four tool nodes and the write-back node.
 *
 * Every handler is `(params, state, ctx)`. Each one leaves its findings in
 * `state` so the next stage can read them, and returns the one line a human
 * reads in the trace. Cypher stages spend zero tokens; only the agent node
 * spends any at all — that asymmetry is the whole argument for the graph.
 */
import {
  isoPlusHours,
  nowIso,
  type ActionKind,
  type AgentVerdict,
  type Decision,
  type HopPath,
  type PatchAttempt,
  type RunContext,
  type TelemetryEvent,
} from '@hopper/contracts';

import type { DeploymentFacts, ObligationFacts, OpHandler, RunState } from './types.js';

const MAX_DEPTH = 5;

function uniq(xs: string[]): string[] {
  return [...new Set(xs.filter((x) => typeof x === 'string' && x.length > 0))];
}

/** cheap, honest token estimate: ~4 characters per token over what we actually sent */
export function estimateTokens(...payloads: unknown[]): number {
  let chars = 0;
  for (const p of payloads) {
    if (p === undefined || p === null) continue;
    chars += typeof p === 'string' ? p.length : JSON.stringify(p).length;
  }
  return Math.ceil(chars / 4);
}

function param<T>(params: Record<string, unknown>, key: string, fallback: T): T {
  const v = params[key];
  return v === undefined || v === null ? fallback : (v as T);
}

// ─── source ─────────────────────────────────────────────────────────────────

const source: OpHandler = (_params, state) => {
  const a = state.advisory;
  state.vars.ecosystem = a.ecosystem;
  state.vars.severity = a.severity;
  state.vars.cvss = a.cvss;
  state.vars.in_kev = a.in_kev;
  state.vars.package = a.package_name;
  return {
    summary: `${a.ghsa_id} · ${a.package_name} · ${a.severity} ${a.cvss.toFixed(1)}${a.in_kev ? ' · KEV' : ''}`,
    tokens: 0,
    output: { ghsa_id: a.ghsa_id, package: a.package_name },
  };
};

// ─── stage 1 — reachability (Q1 + Q2 + Q4) ─────────────────────────────────

const reachability: OpHandler = async (params, state, ctx) => {
  const depth = param(params, 'max_depth', MAX_DEPTH);
  const ghsa = state.advisory.ghsa_id;

  const [paths, absence] = await Promise.all([
    ctx.graph.hopPaths(ghsa, depth),
    ctx.graph.proveAbsence(ghsa, depth),
  ]);

  state.hop_paths = paths;
  state.absence = absence;

  const hops = paths.length ? Math.max(...paths.map((p) => p.hops)) : 0;
  const minHops = paths.length ? Math.min(...paths.map((p) => p.hops)) : 0;

  let isChokepoint = false;
  try {
    const cps = await ctx.graph.chokePoints(param(params, 'chokepoint_limit', 50));
    isChokepoint = cps.some(
      (c) => c.package === state.advisory.package_name && c.is_chokepoint,
    );
  } catch {
    isChokepoint = false;
  }

  state.vars.paths = paths.length;
  state.vars.hops = hops;
  state.vars.min_hops = minHops;
  state.vars.reachable = paths.length > 0;
  state.vars.customers = uniq(paths.map((p) => p.customer)).length;
  state.vars.is_chokepoint = isChokepoint;
  state.vars.repos_checked = absence.repos_checked;
  state.statement = absence.statement;

  // telemetry is the signal that turns 95% into 9.5% — read it off the bus
  try {
    const hist = ctx.bus.history<TelemetryEvent>('telemetry', 500);
    state.telemetry = hist
      .map((e) => e.payload)
      .filter((t) => t && t.kind === 'telemetry' && t.package === state.advisory.package_name);
  } catch {
    state.telemetry = [];
  }
  state.vars.telemetry_hits = state.telemetry.reduce((a, t) => a + (t.calls ?? 0), 0);

  const summary = paths.length
    ? `${paths.length} path(s) to ${state.vars.customers} customer(s), deepest ${hops} hops` +
      `${isChokepoint ? ' · chokepoint package' : ''}`
    : `${absence.statement} (${absence.repos_checked} repos, depth ${absence.max_depth})`;

  return { summary, tokens: 0, output: { paths: paths.length, hops, absence } };
};

// ─── the short circuit — Beat 2 ─────────────────────────────────────────────

const suppress: OpHandler = (params, state, ctx) => {
  const paths = Number(state.vars.paths ?? 0);
  if (paths > 0) {
    return {
      summary: `reachable · ${paths} path(s) · continuing to deployment`,
      tokens: 0,
      output: { suppressed: false },
    };
  }

  const statement =
    state.absence?.statement ??
    `SUPPRESSED · zero hops from any repo to ${state.advisory.package_name}`;
  state.outcome = 'suppressed';
  state.statement = statement;
  state.vars.suppressed = true;
  state.notes.push(statement);
  ctx.log(`SUPPRESSED ${state.advisory.ghsa_id} · ${statement}`);

  return {
    summary: statement,
    tokens: 0,
    short_circuit: true,
    goto: param(params, 'to', 'writeback'),
    output: { suppressed: true, absence: state.absence },
  };
};

// ─── stage 2 — deployment ───────────────────────────────────────────────────

const deployment: OpHandler = (_params, state) => {
  const paths = state.hop_paths;
  const repos = uniq(paths.map((p) => p.repo));
  const services = uniq(paths.map((p) => p.service));
  const facts: DeploymentFacts = {
    repos,
    services,
    primary_repo: repos[0] ?? null,
    primary_service: services[0] ?? null,
    tier0: paths.some((p) => p.chain.includes('tier-0')),
  };
  state.deployment = facts;
  state.vars.repos = repos.length;
  state.vars.services = services.length;
  state.vars.primary_repo = facts.primary_repo;
  state.vars.primary_service = facts.primary_service;

  return {
    summary: `${repos.length} repo(s) → ${services.length} service(s): ${services.slice(0, 3).join(', ') || 'none'}`,
    tokens: 0,
    output: facts,
  };
};

// ─── stage 3 — obligation ───────────────────────────────────────────────────

function deadlineFor(p: HopPath, publishedAt: string): string {
  const from = new Date(publishedAt);
  const base = Number.isNaN(from.getTime()) ? new Date() : from;
  return isoPlusHours(p.notice_window, base);
}

const obligation: OpHandler = (_params, state) => {
  const clauses = state.hop_paths.map((p) => ({
    customer: p.customer,
    clause_ref: p.clause_ref,
    hours: p.notice_window,
    deadline_utc: deadlineFor(p, state.advisory.published_at),
    arr: p.arr,
    governing_law: p.governing_law,
  }));
  clauses.sort((a, b) => a.hours - b.hours);

  const facts: ObligationFacts = {
    customers: uniq(clauses.map((c) => c.customer)),
    clauses,
    earliest_deadline_utc: clauses[0]?.deadline_utc ?? null,
    min_window_hours: clauses[0]?.hours ?? 0,
    arr_at_risk: uniq(clauses.map((c) => c.customer)).reduce(
      (sum, name) => sum + (clauses.find((c) => c.customer === name)?.arr ?? 0),
      0,
    ),
  };
  state.obligation = facts;
  state.vars.obligated = clauses.length > 0;
  state.vars.notice_hours = facts.min_window_hours;
  state.vars.arr_at_risk = facts.arr_at_risk;

  const tightest = clauses[0];
  return {
    summary: tightest
      ? `${facts.customers.length} customer(s) · tightest ${tightest.clause_ref} ${tightest.hours}h → ${tightest.deadline_utc}`
      : 'no breach-notification clause on any path',
    tokens: 0,
    output: facts,
  };
};

// ─── stage 4 — precedent (Q3) ───────────────────────────────────────────────

const precedent: OpHandler = async (_params, state, ctx) => {
  const pkg = state.advisory.package_name;
  const rows = await ctx.graph.precedent(pkg);
  state.precedents = rows;
  state.vars.precedents = rows.length;
  const broke = rows.filter((r) => r.outcome === 'broke_staging' || r.outcome === 'rolled_back');
  state.vars.precedent_broke = broke.length;

  const freshest = rows[0];
  return {
    summary: rows.length
      ? `${rows.length} prior attempt(s) relevant to ${pkg}${
          freshest
            ? ` · latest ${freshest.package} ${freshest.from_v}→${freshest.to_v} ` +
              `${freshest.outcome} ${Math.round(freshest.age_seconds)}s ago`
            : ''
        }`
      : `no prior patch attempt on ${pkg}`,
    tokens: 0,
    output: rows,
  };
};

// ─── stage 5 — ownership (Q5) ───────────────────────────────────────────────

const ownership: OpHandler = async (_params, state, ctx) => {
  const rows = await ctx.graph.whoToWake(state.advisory.ghsa_id);
  state.oncall = rows;
  state.vars.oncall = rows.length;
  const first = rows[0];
  state.vars.oncall_person = first?.person ?? null;
  state.vars.oncall_channel = first?.slack_channel ?? null;

  return {
    summary: rows.length
      ? `wake ${first.person} (${first.slack_handle}) in ${first.slack_channel} for ${first.service}`
      : 'no on-call resolved for the affected services',
    tokens: 0,
    output: rows,
  };
};

// ─── R4 — Guild dispatch ────────────────────────────────────────────────────

const dispatch: OpHandler = async (_params, state, ctx) => {
  const input = {
    advisory: state.advisory,
    hopPaths: state.hop_paths,
    telemetry: state.telemetry,
    precedents: state.precedents,
    isChokepoint: Boolean(state.vars.is_chokepoint),
    bus: ctx.bus,
    graph: ctx.graph,
  };

  const result = await ctx.agents.run(input);
  state.agent = result;
  state.vars.conflict = result.conflict;
  state.vars.decision = result.arbiter.decision;
  state.vars.reachable_verdict = result.reachability.reachable;
  state.vars.safe_bump = result.patch.safe_bump;
  state.vars.actions = result.arbiter.actions.join(',');
  state.vars.confidence = result.arbiter.confidence;
  if (result.arbiter.decision === 'suppress') state.outcome = 'suppressed';

  return {
    summary:
      `arbiter: ${result.arbiter.decision}${result.conflict ? ' · CONFLICT' : ''} · ` +
      `actions [${result.arbiter.actions.join(', ') || 'none'}] · ` +
      `confidence ${result.arbiter.confidence.toFixed(2)}`,
    tokens: estimateTokens(input.advisory, input.hopPaths, input.telemetry, input.precedents, result),
    output: {
      session_id: result.session_id,
      conflict: result.conflict,
      decision: result.arbiter.decision,
      actions: result.arbiter.actions,
    },
  };
};

// ─── R5 — the four tool nodes ───────────────────────────────────────────────

function wanted(state: RunState, action: ActionKind): boolean {
  const actions = state.agent?.arbiter.actions;
  if (!actions) return false;
  return actions.includes(action);
}

function skipped(action: ActionKind, state: RunState): { summary: string; tokens: number } {
  const why = state.agent ? 'arbiter did not request it' : 'no agent verdict';
  return { summary: `skipped ${action} · ${why}`, tokens: 0 };
}

const openPr: OpHandler = async (params, state, ctx) => {
  if (!wanted(state, 'open_pr')) return skipped('open_pr', state);
  const repo = param(params, 'repo', state.deployment?.primary_repo ?? 'unknown/unknown');
  const toV = state.agent?.patch.target ?? state.advisory.fixed_in ?? 'latest';
  const receipt = await ctx.tools.openPr({
    ghsa_id: state.advisory.ghsa_id,
    package: state.advisory.package_name,
    from_v: state.advisory.vulnerable_range,
    to_v: toV,
    repo,
  });
  state.receipts.push(receipt);
  return {
    summary: `open_pr ${state.advisory.package_name}→${toV} in ${repo} · ${receipt.ok ? receipt.ref : `blocked: ${receipt.detail}`}`,
    tokens: 0,
    ok: receipt.ok,
    output: receipt,
  };
};

const pageOncall: OpHandler = async (params, state, ctx) => {
  if (!wanted(state, 'page_oncall')) return skipped('page_oncall', state);
  const person = state.oncall[0];
  const receipt = await ctx.tools.pageOncall({
    ghsa_id: state.advisory.ghsa_id,
    person: person?.person ?? param(params, 'person', 'platform-oncall'),
    slack_handle: person?.slack_handle ?? param(params, 'slack_handle', '@oncall'),
    channel: person?.slack_channel ?? param(params, 'channel', '#platform-oncall'),
    summary:
      `${state.advisory.package_name} reachable in ` +
      `${state.deployment?.primary_service ?? 'production'} · ${state.vars.hops} hops to ` +
      `${state.obligation?.customers[0] ?? 'a customer'}`,
  });
  state.receipts.push(receipt);
  return {
    summary: `page_oncall ${person?.person ?? 'oncall'} · ${receipt.ok ? receipt.ref : `blocked: ${receipt.detail}`}`,
    tokens: 0,
    ok: receipt.ok,
    output: receipt,
  };
};

const notifyCustomer: OpHandler = async (_params, state, ctx) => {
  if (!wanted(state, 'notify_customer')) return skipped('notify_customer', state);
  const clause = state.obligation?.clauses[0];
  // G6 — the token only exists if a human approved. We never mint one here.
  const approval = (state.agent?.approvals ?? []).find(
    (a) => a.action === 'notify_customer' && a.status === 'approved',
  );
  const receipt = await ctx.tools.notifyCustomer({
    ghsa_id: state.advisory.ghsa_id,
    customer: clause?.customer ?? 'unknown',
    clause_ref: clause?.clause_ref ?? 'n/a',
    deadline_utc: clause?.deadline_utc ?? '',
    body: state.agent?.obligation.notice_draft ?? '',
    approval_token: approval?.token ?? '',
  });
  state.receipts.push(receipt);
  return {
    summary: receipt.ok
      ? `notify_customer ${clause?.customer ?? ''} · ${receipt.ref}`
      : `notify_customer HELD · ${receipt.detail}`,
    tokens: 0,
    ok: receipt.ok,
    output: receipt,
  };
};

const openTicket: OpHandler = async (params, state, ctx) => {
  if (!wanted(state, 'open_ticket')) return skipped('open_ticket', state);
  const receipt = await ctx.tools.openTicket({
    ghsa_id: state.advisory.ghsa_id,
    title: `${state.advisory.package_name}: ${state.advisory.summary}`.slice(0, 120),
    body:
      `${state.vars.paths} path(s), deepest ${state.vars.hops} hops. ` +
      `Services: ${state.deployment?.services.join(', ') ?? 'none'}. ` +
      `Customers: ${state.obligation?.customers.join(', ') ?? 'none'}.`,
    assignee: param(params, 'assignee', state.oncall[0]?.team ?? 'platform'),
  });
  state.receipts.push(receipt);
  return {
    summary: `open_ticket · ${receipt.ok ? receipt.ref : `blocked: ${receipt.detail}`}`,
    tokens: 0,
    ok: receipt.ok,
    output: receipt,
  };
};

// ─── R6 — write-back ────────────────────────────────────────────────────────

async function safe(label: string, fn: () => Promise<unknown>, notes: string[]): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    notes.push(`${label} failed: ${(e as Error).message}`);
    return false;
  }
}

const writeback: OpHandler = async (params, state, ctx) => {
  const ts = nowIso();
  const ghsa = state.advisory.ghsa_id;
  const written: string[] = [];

  // 1. verdicts (G8 dual-write: Guild's trace and our graph)
  if (state.agent) {
    const verdicts: AgentVerdict[] = [
      {
        id: `${state.agent.session_id}:reachability`,
        agent: 'reachability',
        verdict: state.agent.reachability.reachable ? 'reachable' : 'not-reachable',
        confidence: state.agent.reachability.confidence,
        rationale: state.agent.reachability.rationale,
        ts,
        ghsa_id: ghsa,
        payload_json: JSON.stringify(state.agent.reachability),
      },
      {
        id: `${state.agent.session_id}:patch-engineer`,
        agent: 'patch-engineer',
        verdict: state.agent.patch.safe_bump ? 'safe-bump' : 'unsafe-bump',
        confidence: state.agent.patch.confidence,
        rationale: state.agent.patch.rationale,
        ts,
        ghsa_id: ghsa,
        payload_json: JSON.stringify(state.agent.patch),
      },
      {
        id: `${state.agent.session_id}:obligation-officer`,
        agent: 'obligation-officer',
        verdict: state.agent.obligation.obligated ? 'obligated' : 'not-obligated',
        confidence: state.agent.obligation.confidence,
        rationale: state.agent.obligation.rationale,
        ts,
        ghsa_id: ghsa,
        payload_json: JSON.stringify(state.agent.obligation),
      },
      {
        id: `${state.agent.session_id}:arbiter`,
        agent: 'arbiter',
        verdict: state.agent.arbiter.decision,
        confidence: state.agent.arbiter.confidence,
        rationale: state.agent.arbiter.rationale,
        ts,
        ghsa_id: ghsa,
        payload_json: JSON.stringify(state.agent.arbiter),
      },
    ];
    for (const v of verdicts) {
      if (await safe('recordVerdict', () => ctx.graph.recordVerdict(v), state.notes)) {
        written.push(`verdict:${v.agent}`);
      }
    }
  }

  // 2. the decision itself
  const suppressed = state.outcome === 'suppressed';
  const primary: ActionKind =
    (state.receipts.find((r) => r.ok)?.action as ActionKind | undefined) ??
    (state.agent?.arbiter.actions[0] as ActionKind | undefined) ??
    'open_ticket';
  const decision: Decision = {
    id: `dec_${ghsa}_${Date.now().toString(36)}`,
    action: primary,
    auto: !state.receipts.some((r) => !r.ok && r.action === 'notify_customer'),
    approved_by: null,
    ts,
    ghsa_id: ghsa,
    outcome: suppressed
      ? 'suppressed'
      : state.receipts.some((r) => !r.ok)
        ? 'pending_approval'
        : 'executed',
  };
  if (await safe('recordDecision', () => ctx.graph.recordDecision(decision), state.notes)) {
    written.push('decision');
  }

  // 3. the bump we attempted — this is the edge Beat 3 reads back out
  if (!suppressed && state.agent) {
    const attempt: PatchAttempt = {
      id: `pa_${ghsa}_${Date.now().toString(36)}`,
      package: state.advisory.package_name,
      from_v: state.advisory.vulnerable_range,
      to_v: state.agent.patch.target ?? state.advisory.fixed_in ?? 'unknown',
      outcome: state.receipts.some((r) => r.action === 'open_pr' && r.ok) ? 'pending' : 'rolled_back',
      ts,
      notes:
        `opened from ${ghsa} · ${state.vars.hops} hops to ` +
        `${state.obligation?.customers[0] ?? 'no customer'} · breaking risk ${state.agent.patch.breaking_risk}`,
    };
    if (await safe('recordPatchAttempt', () => ctx.graph.recordPatchAttempt(attempt), state.notes)) {
      written.push('patch_attempt');
    }
  }

  // 4. the observation — a suppression is a positive safety claim, not silence
  const note = suppressed
    ? (state.statement ?? 'SUPPRESSED · zero hops')
    : `escalated · ${state.vars.paths} path(s) · ${state.receipts.filter((r) => r.ok).length} action(s) executed`;
  if (await safe('recordObservation', () => ctx.graph.recordObservation(ghsa, note, ts), state.notes)) {
    written.push('observation');
  }

  // 5. close the meta loop — the graph learns which pipeline is winning
  const pipelineId = param(params, 'pipeline_id', String(state.vars.pipeline_id ?? ''));
  const elapsed = Math.max(0.001, performance.now() - state.started_ms);
  const runOk = state.outcome !== 'error';
  if (pipelineId) {
    if (await safe('recordOutcome', () => ctx.meta.recordOutcome(pipelineId, runOk, elapsed), state.notes)) {
      written.push('meta.recordOutcome');
    }
    await safe(
      'recordPipelineRun',
      () => ctx.graph.recordPipelineRun(pipelineId, runOk, elapsed),
      state.notes,
    );
  }

  return {
    summary: `wrote ${written.length} fact(s): ${written.join(', ') || 'none'} · outcome ${state.outcome}`,
    tokens: 0,
    output: { written, decision },
  };
};

// ─── sink ───────────────────────────────────────────────────────────────────

const sink: OpHandler = (_params, state) => ({
  summary:
    state.outcome === 'suppressed'
      ? `${state.statement ?? 'suppressed'} · zero agent tokens spent`
      : `escalated · ${state.receipts.filter((r) => r.ok).length}/${state.receipts.length} action(s) executed`,
  tokens: 0,
});

// ─── registry fragment ──────────────────────────────────────────────────────

export const TRAVERSE_OPS: Record<string, OpHandler> = {
  'source.advisory': source,
  'traverse.reachability': reachability,
  'traverse.deployment': deployment,
  'traverse.obligation': obligation,
  'traverse.precedent': precedent,
  'traverse.ownership': ownership,
  'branch.suppress': suppress,
  'agent.dispatch': dispatch,
  'tool.open_pr': openPr,
  'tool.page_oncall': pageOncall,
  'tool.notify_customer': notifyCustomer,
  'tool.open_ticket': openTicket,
  'writeback.graph': writeback,
  'sink.done': sink,
};

export type { RunContext };
