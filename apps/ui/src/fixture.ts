/**
 * HOPPER — the demo arc as static data.
 *
 * This file is the reason the Situation Room renders with zero backend. It is
 * a fully-populated AppState plus a scripted timeline of ServerMessages that
 * replays the three beats of §10 with the real timings. The websocket client
 * feeds the identical message shapes into the identical reducer, so nothing in
 * the component tree can tell the difference.
 *
 * Ring timings are not written by hand — they come out of scheduleHops(), the
 * same function the gate asserts on.
 */
import {
  HERO_ADVISORY,
  HERO_CLAUSE,
  HERO_CUSTOMER,
  HERO_GHSA,
  HERO_PACKAGE,
  HERO_SERVICE,
  HERO_WINDOW_HOURS,
  PRECEDENT_ADVISORY,
  PRECEDENT_GHSA,
  PRECEDENT_PACKAGE,
  SUPPRESSED_ADVISORY,
  SUPPRESSED_GHSA,
  SUPPRESSED_PACKAGE,
  classId,
  depthBand,
  severityBand,
} from '@hopper/contracts';
import type {
  AbsenceProof,
  ActionReceipt,
  AdvisoryClass,
  AgentBusEvent,
  AppState,
  ApprovalRequest,
  AuditEntry,
  ClockTick,
  FeedItem,
  FocusView,
  FunnelStats,
  HopPath,
  NodeTrace,
  OnCall,
  Precedent,
  ServerMessage,
  Severity,
} from '@hopper/contracts';
import { hopMessages } from './lib/hops.js';
import type { Selection } from './lib/types.js';

// ─── the three chains ───────────────────────────────────────────────────────

/** the money path — exactly the chain shape in contracts/src/graph.ts */
export const HERO_CHAIN = [
  HERO_PACKAGE,
  'minimatch',
  'glob',
  'jest',
  HERO_SERVICE,
  'Northwind',
  HERO_CLAUSE,
];

/** the probe goes out one ring and finds nothing. That is the whole beat. */
export const SUPPRESSED_CHAIN = [SUPPRESSED_PACKAGE, '∅'];

export const PRECEDENT_CHAIN = [
  PRECEDENT_PACKAGE,
  'glob',
  'jest',
  HERO_SERVICE,
  'Northwind',
  HERO_CLAUSE,
];

export const DEADLINE_UTC = '2026-08-04T16:35:32Z';

// ─── classes (derived, not typed by hand) ───────────────────────────────────

const HERO_CLASS: AdvisoryClass = {
  id: classId('npm', severityBand(HERO_ADVISORY.severity), depthBand(5, 1)),
  ecosystem: 'npm',
  severity_band: severityBand(HERO_ADVISORY.severity),
  depth_band: depthBand(5, 1),
};

const SUPPRESSED_CLASS: AdvisoryClass = {
  id: classId('npm', severityBand(SUPPRESSED_ADVISORY.severity), depthBand(0, 0)),
  ecosystem: 'npm',
  severity_band: severityBand(SUPPRESSED_ADVISORY.severity),
  depth_band: depthBand(0, 0),
};

const PRECEDENT_CLASS: AdvisoryClass = {
  id: classId('npm', severityBand(PRECEDENT_ADVISORY.severity), depthBand(4, 1)),
  ecosystem: 'npm',
  severity_band: severityBand(PRECEDENT_ADVISORY.severity),
  depth_band: depthBand(4, 1),
};

// ─── pipelines: the graph has a library, and it picks ───────────────────────

export const PIPELINES: AppState['pipelines'] = [
  { pipeline_id: 'pipeline#1', name: 'triage-shallow', success_rate: 0.88, avg_latency: 1240, runs: 412 },
  { pipeline_id: 'pipeline#2', name: 'traverse-deep-agentic', success_rate: 0.94, avg_latency: 1810, runs: 186 },
  { pipeline_id: 'pipeline#3', name: 'precedent-first', success_rate: 0.97, avg_latency: 1420, runs: 64 },
  { pipeline_id: 'pipeline#4', name: 'suppress-fast', success_rate: 0.99, avg_latency: 240, runs: 1204 },
];

const SEL_HERO: Selection = {
  pipeline_id: 'pipeline#2',
  name: 'traverse-deep-agentic',
  success_rate: 0.94,
  avg_latency: 1810,
  advisory_class: HERO_CLASS.id,
  reason: 'HANDLES this class · best success_rate over 186 runs',
};

const SEL_SUPPRESSED: Selection = {
  pipeline_id: 'pipeline#4',
  name: 'suppress-fast',
  success_rate: 0.99,
  avg_latency: 240,
  advisory_class: SUPPRESSED_CLASS.id,
  reason: 'HANDLES this class · short-circuits the moment paths = 0',
};

/** the meta reveal — a different pipeline, chosen by the graph, on stage */
const SEL_PRECEDENT: Selection = {
  pipeline_id: 'pipeline#3',
  name: 'precedent-first',
  success_rate: 0.97,
  avg_latency: 1420,
  advisory_class: PRECEDENT_CLASS.id,
  reason: 'OUTPERFORMED pipeline#2 by 0.03 on this class — the graph re-selected',
};

export const SELECTIONS = { hero: SEL_HERO, suppressed: SEL_SUPPRESSED, precedent: SEL_PRECEDENT };

// ─── graph query results ────────────────────────────────────────────────────

const HERO_PATH: HopPath = {
  customer: HERO_CUSTOMER,
  customer_tier: 'enterprise',
  arr: 1_840_000,
  service: HERO_SERVICE,
  repo: 'northwind/build-api',
  notice_window: HERO_WINDOW_HOURS,
  clause_ref: HERO_CLAUSE,
  clause_type: 'breach_notification',
  hops: 5,
  chain: HERO_CHAIN,
  contract_id: 'NW-MSA-2024-118',
  governing_law: 'Delaware, USA',
};

const PRECEDENT_PATH: HopPath = {
  ...HERO_PATH,
  hops: 4,
  chain: PRECEDENT_CHAIN,
};

const ABSENCE: AbsenceProof = {
  package: SUPPRESSED_PACKAGE,
  paths: 0,
  decision: 'SUPPRESSED',
  statement: 'SUPPRESSED · zero hops from any repo',
  repos_checked: 6,
  max_depth: 5,
};

/** written by this system during beat 1. Nothing about it is in a prompt. */
const PATCH_PRECEDENT: Precedent = {
  package: PRECEDENT_PACKAGE,
  from_v: '9.0.3',
  to_v: '9.0.5',
  outcome: 'broke_staging',
  ts: '2026-08-03T17:01:14Z',
  notes: 'PatchAttempt#3 — jest resolver failed on staging after bump, rolled back',
  age_seconds: 90,
};

const ONCALL: OnCall[] = [
  {
    person: 'Dana Vorak',
    email: 'dana.vorak@northwind-eng.example',
    slack_handle: '@dvorak',
    team: 'Platform',
    slack_channel: '#platform-oncall',
    service: HERO_SERVICE,
    oncall_until: '2026-08-04T08:00:00Z',
  },
];

export const CHOKEPOINTS: AppState['chokepoints'] = [
  { package: 'brace-expansion', betweenness: 0.412, dependents: 1841, is_chokepoint: true },
  { package: 'minimatch', betweenness: 0.388, dependents: 1620, is_chokepoint: true },
  { package: 'glob', betweenness: 0.301, dependents: 1204, is_chokepoint: true },
  { package: 'semver', betweenness: 0.277, dependents: 990, is_chokepoint: true },
  { package: 'tslib', betweenness: 0.194, dependents: 812, is_chokepoint: false },
];

// ─── clocks ─────────────────────────────────────────────────────────────────

function clock(remaining_seconds: number, ghsa_id = HERO_GHSA): ClockTick {
  return {
    kind: 'clock',
    customer: HERO_CUSTOMER,
    ghsa_id,
    deadline_utc: DEADLINE_UTC,
    remaining_seconds,
    window_hours: HERO_WINDOW_HOURS,
    clause_ref: HERO_CLAUSE,
    state: 'running',
  };
}

/** T-23:58:41 — the number the presenter says out loud */
export const CLOCK_START_SECONDS = 86_321;

// ─── receipts / approvals ───────────────────────────────────────────────────

const RECEIPT_PR: ActionReceipt = {
  action: 'open_pr',
  ok: true,
  mock: true,
  ref: 'https://github.com/northwind/build-api/pull/4471',
  detail: 'PR #4471 · bump brace-expansion 1.1.17 → 1.1.18',
  ts: '2026-08-03T16:35:35Z',
  latency_ms: 812,
};

const RECEIPT_PAGE: ActionReceipt = {
  action: 'page_oncall',
  ok: true,
  mock: true,
  ref: 'slack:C04TS9K/1754239012.4471',
  detail: 'Paged @dvorak · #platform-oncall',
  ts: '2026-08-03T16:35:36Z',
  latency_ms: 244,
};

const RECEIPT_TICKET: ActionReceipt = {
  action: 'open_ticket',
  ok: true,
  mock: true,
  ref: 'NW-2291',
  detail: 'Auto-PR held · patch-engineer dissent recorded for review',
  ts: '2026-08-03T17:02:48Z',
  latency_ms: 191,
};

export const APPROVAL_ID = 'apr_northwind_7_3';

const APPROVAL: ApprovalRequest = {
  id: APPROVAL_ID,
  action: 'notify_customer',
  ghsa_id: HERO_GHSA,
  title: `Notify ${HERO_CUSTOMER}`,
  body:
    `Contractual breach notice under ${HERO_CLAUSE} of NW-MSA-2024-118. ` +
    `${HERO_PACKAGE} ${HERO_ADVISORY.vulnerable_range} reaches ${HERO_SERVICE} at 5 hops. ` +
    `Notice window ${HERO_WINDOW_HOURS}h, expires ${DEADLINE_UTC}.`,
  requested_at: '2026-08-03T16:35:36Z',
  status: 'pending',
};

// ─── pipeline runs ──────────────────────────────────────────────────────────

type TraceSpec = [string, NodeTrace['kind'], string, number, number, string, boolean?];

function buildTraces(startIso: string, specs: TraceSpec[]): NodeTrace[] {
  let t = Date.parse(startIso);
  return specs.map(([node_id, kind, op, latency_ms, tokens, summary, short]) => {
    const started_at = new Date(t).toISOString();
    t += latency_ms;
    return {
      node_id,
      kind,
      op,
      started_at,
      ended_at: new Date(t).toISOString(),
      latency_ms,
      tokens,
      ok: true,
      short_circuit: short === true,
      summary,
    };
  });
}

const RUN_HERO = {
  run_id: 'run_01K9Q7',
  pipeline_id: SEL_HERO.pipeline_id,
  ghsa_id: HERO_GHSA,
  advisory_class: HERO_CLASS.id,
  started_at: '2026-08-03T16:35:33Z',
  ended_at: '2026-08-03T16:35:34.842Z',
  latency_ms: 1842,
  ok: true,
  outcome: 'escalated' as const,
  traces: buildTraces('2026-08-03T16:35:33Z', [
    ['src', 'source', 'laserdata.advisories', 18, 0, 'GHSA-rgw5-rvv9-x895 dequeued'],
    ['q1', 'cypher', 'graph.hopPaths', 214, 0, '1 path · 5 hops · Northwind §7.3'],
    ['br', 'branch', 'depth>0', 3, 0, 'paths>0 → traverse'],
    ['ag', 'agent', 'guild.dispatch', 1_106, 3_884, '4 verdicts · 1 gate'],
    ['t1', 'tool', 'github.openPR', 812, 0, 'PR #4471'],
    ['t2', 'tool', 'slack.page', 244, 0, '@dvorak'],
    ['wb', 'writeback', 'graph.recordDecision', 61, 0, 'Decision + PatchAttempt#3'],
    ['snk', 'sink', 'ws.broadcast', 9, 0, 'state pushed'],
  ]),
  hop_paths: [HERO_PATH],
  receipts: [RECEIPT_PR, RECEIPT_PAGE],
  selection_reason: SEL_HERO.reason,
};

const RUN_SUPPRESSED = {
  run_id: 'run_01K9Q8',
  pipeline_id: SEL_SUPPRESSED.pipeline_id,
  ghsa_id: SUPPRESSED_GHSA,
  advisory_class: SUPPRESSED_CLASS.id,
  started_at: '2026-08-03T16:23:12Z',
  ended_at: '2026-08-03T16:23:12.238Z',
  latency_ms: 238,
  ok: true,
  outcome: 'suppressed' as const,
  traces: buildTraces('2026-08-03T16:23:12Z', [
    ['src', 'source', 'laserdata.advisories', 16, 0, 'GHSA-0000-supp-0001 dequeued'],
    ['q2', 'cypher', 'graph.proveAbsence', 197, 0, '0 paths · 6 repos · depth 5'],
    ['br', 'branch', 'paths==0', 2, 0, 'short-circuit → suppress', true],
    ['wb', 'writeback', 'graph.recordDecision', 19, 0, 'Decision suppressed'],
    ['snk', 'sink', 'ws.broadcast', 4, 0, 'state pushed'],
  ]),
  hop_paths: [],
  receipts: [],
  selection_reason: SEL_SUPPRESSED.reason,
};

const RUN_PRECEDENT = {
  run_id: 'run_01K9Q9',
  pipeline_id: SEL_PRECEDENT.pipeline_id,
  ghsa_id: PRECEDENT_GHSA,
  advisory_class: PRECEDENT_CLASS.id,
  started_at: '2026-08-03T17:02:45Z',
  ended_at: '2026-08-03T17:02:46.431Z',
  latency_ms: 1431,
  ok: true,
  outcome: 'escalated' as const,
  traces: buildTraces('2026-08-03T17:02:45Z', [
    ['src', 'source', 'laserdata.advisories', 15, 0, 'GHSA-0000-prec-0001 dequeued'],
    ['q3', 'cypher', 'graph.precedent', 88, 0, 'PatchAttempt#3 · broke_staging · 90s old'],
    ['q1', 'cypher', 'graph.hopPaths', 179, 0, '1 path · 4 hops · Northwind §7.3'],
    ['ag', 'agent', 'guild.dispatch', 968, 3_402, '4 verdicts · 1 conflict'],
    ['t1', 'tool', 'jira.openTicket', 191, 0, 'NW-2291'],
    ['wb', 'writeback', 'graph.recordVerdict', 44, 0, 'conflict recorded'],
    ['snk', 'sink', 'ws.broadcast', 6, 0, 'state pushed'],
  ]),
  hop_paths: [PRECEDENT_PATH],
  receipts: [RECEIPT_TICKET],
  selection_reason: SEL_PRECEDENT.reason,
};

// ─── transcripts ────────────────────────────────────────────────────────────

function bus(
  agent: AgentBusEvent['agent'],
  ghsa_id: string,
  phase: AgentBusEvent['phase'],
  message: string,
  confidence?: number,
): AgentBusEvent {
  return { kind: 'agent-bus', agent, ghsa_id, phase, message, confidence, session_id: 'gld_sess_a91' };
}

const HERO_BUS: AgentBusEvent[] = [
  bus('reachability', HERO_GHSA, 'started', 'walking DEPENDS_ON*0..5 from brace-expansion'),
  bus('reachability', HERO_GHSA, 'verdict', 'expand() hot in build-api/prod — 2,314 calls / 15m', 0.91),
  bus('patch-engineer', HERO_GHSA, 'started', 'querying PatchAttempt history for brace-expansion'),
  bus('patch-engineer', HERO_GHSA, 'verdict', '1.1.17 → 1.1.18 is a semver patch, no prior failure', 0.86),
  bus('obligation-officer', HERO_GHSA, 'started', 'resolving SERVES → SIGNED → HAS_CLAUSE'),
  bus('obligation-officer', HERO_GHSA, 'verdict', 'Northwind §7.3 breach_notification · 24h window opens now', 1.0),
  bus('arbiter', HERO_GHSA, 'verdict', 'auto: open_pr, page_oncall · human: notify_customer', 0.88),
  bus('arbiter', HERO_GHSA, 'resolved', 'Decision#dcn_4471 recorded to graph'),
];

const SUPPRESSED_BUS: AgentBusEvent[] = [
  bus('reachability', SUPPRESSED_GHSA, 'started', 'proving absence across 6 repos at depth 5'),
  bus('reachability', SUPPRESSED_GHSA, 'verdict', 'no path from any Repo to @angular/compiler', 0.99),
  bus('arbiter', SUPPRESSED_GHSA, 'verdict', 'zero hops · no obligation · no action', 0.99),
  bus('arbiter', SUPPRESSED_GHSA, 'resolved', 'suppression recorded — this is a proof, not a guess'),
];

const PRECEDENT_BUS: AgentBusEvent[] = [
  bus('reachability', PRECEDENT_GHSA, 'started', 'walking DEPENDS_ON*0..5 from minimatch'),
  bus('reachability', PRECEDENT_GHSA, 'verdict', 'glob → jest → build-api · 4 hops', 0.79),
  bus('patch-engineer', PRECEDENT_GHSA, 'started', 'querying PatchAttempt history for minimatch'),
  bus('patch-engineer', PRECEDENT_GHSA, 'conflict', 'bumped this lib 90s ago and staging broke — PatchAttempt#3', 0.44),
  bus('patch-engineer', PRECEDENT_GHSA, 'verdict', 'HOLD 9.0.3 → 9.0.5 · precedent says rollback', 0.44),
  bus('obligation-officer', PRECEDENT_GHSA, 'verdict', 'folds into the open Northwind §7.3 notice window', 1.0),
  bus('arbiter', PRECEDENT_GHSA, 'conflict', 'reachability says patch, patch-engineer says hold', 0.71),
  bus('arbiter', PRECEDENT_GHSA, 'resolved', 'no auto-PR · ticket NW-2291 · notice still gated', 0.71),
];

// ─── audit ──────────────────────────────────────────────────────────────────

const HERO_AUDIT: AuditEntry[] = [
  { ts: '2026-08-03T16:35:33Z', kind: 'observation', actor: 'laserdata', detail: 'advisories topic → GHSA-rgw5-rvv9-x895', ghsa_id: HERO_GHSA },
  { ts: '2026-08-03T16:35:33Z', kind: 'observation', actor: 'falkordb', detail: 'AFFECTS edge written · brace-expansion', ghsa_id: HERO_GHSA },
  { ts: '2026-08-03T16:35:34Z', kind: 'verdict', actor: 'reachability', detail: 'REACHABLE · expand() 2,314 calls/15m in build-api/prod', ghsa_id: HERO_GHSA, confidence: 0.91 },
  { ts: '2026-08-03T16:35:34Z', kind: 'verdict', actor: 'patch-engineer', detail: 'SAFE BUMP · 1.1.17 → 1.1.18', ghsa_id: HERO_GHSA, confidence: 0.86 },
  { ts: '2026-08-03T16:35:35Z', kind: 'verdict', actor: 'obligation-officer', detail: '§7.3 · 24h · Northwind Systems · NW-MSA-2024-118', ghsa_id: HERO_GHSA, confidence: 1.0 },
  { ts: '2026-08-03T16:35:35Z', kind: 'verdict', actor: 'arbiter', detail: '→ HUMAN · notify_customer requires sign-off', ghsa_id: HERO_GHSA, confidence: 0.88 },
  { ts: '2026-08-03T16:35:35Z', kind: 'decision', actor: 'executor', detail: 'open_pr executed · PR #4471', ghsa_id: HERO_GHSA },
  { ts: '2026-08-03T16:35:36Z', kind: 'decision', actor: 'executor', detail: 'page_oncall executed · @dvorak', ghsa_id: HERO_GHSA },
  { ts: '2026-08-03T16:35:36Z', kind: 'approval', actor: 'guild', detail: 'notify_customer PENDING — no token issued', ghsa_id: HERO_GHSA },
  { ts: '2026-08-03T16:35:38Z', kind: 'observation', actor: 'falkordb', detail: 'PatchAttempt#3 written · minimatch 9.0.3 → 9.0.5 · broke_staging', ghsa_id: HERO_GHSA },
];

const SUPPRESSED_AUDIT: AuditEntry[] = [
  { ts: '2026-08-03T16:23:12Z', kind: 'observation', actor: 'laserdata', detail: 'advisories topic → GHSA-0000-supp-0001', ghsa_id: SUPPRESSED_GHSA },
  { ts: '2026-08-03T16:23:12Z', kind: 'observation', actor: 'falkordb', detail: 'Q2 proof of no path · 6 repos · depth 5 · 0 results', ghsa_id: SUPPRESSED_GHSA },
  { ts: '2026-08-03T16:23:12Z', kind: 'verdict', actor: 'reachability', detail: 'NOT REACHABLE · zero hops from any repo', ghsa_id: SUPPRESSED_GHSA, confidence: 0.99 },
  { ts: '2026-08-03T16:23:13Z', kind: 'suppression', actor: 'arbiter', detail: 'SUPPRESSED · no obligation · no action taken', ghsa_id: SUPPRESSED_GHSA, confidence: 0.99 },
];

const PRECEDENT_AUDIT: AuditEntry[] = [
  { ts: '2026-08-03T17:02:45Z', kind: 'observation', actor: 'laserdata', detail: 'advisories topic → GHSA-0000-prec-0001', ghsa_id: PRECEDENT_GHSA },
  { ts: '2026-08-03T17:02:45Z', kind: 'observation', actor: 'falkordb', detail: 'Q7 selected pipeline#3 over pipeline#2 for npm/moderate/deep', ghsa_id: PRECEDENT_GHSA },
  { ts: '2026-08-03T17:02:45Z', kind: 'observation', actor: 'falkordb', detail: 'Q3 precedent · PatchAttempt#3 · broke_staging · 90s old', ghsa_id: PRECEDENT_GHSA },
  { ts: '2026-08-03T17:02:46Z', kind: 'verdict', actor: 'reachability', detail: 'REACHABLE · 4 hops to Northwind §7.3', ghsa_id: PRECEDENT_GHSA, confidence: 0.79 },
  { ts: '2026-08-03T17:02:46Z', kind: 'verdict', actor: 'patch-engineer', detail: 'CONFLICT · precedent PatchAttempt#3 contradicts the bump', ghsa_id: PRECEDENT_GHSA, confidence: 0.44 },
  { ts: '2026-08-03T17:02:47Z', kind: 'verdict', actor: 'arbiter', detail: '→ HUMAN · auto-PR withheld, dissent preserved', ghsa_id: PRECEDENT_GHSA, confidence: 0.71 },
  { ts: '2026-08-03T17:02:48Z', kind: 'decision', actor: 'executor', detail: 'open_ticket executed · NW-2291', ghsa_id: PRECEDENT_GHSA },
];

// ─── verdict rows ───────────────────────────────────────────────────────────

type Verdicts = FocusView['verdicts'];

const V_HERO = {
  reachability: { verdict: 'REACHABLE', confidence: 0.91, detail: 'expand() observed 2,314× in build-api/prod · 15m window' },
  patch: { verdict: 'SAFE BUMP', confidence: 0.86, detail: '1.1.17 → 1.1.18 · semver patch · no precedent against', conflict: false },
  obligation: { verdict: '§7.3 · 24h', confidence: 1.0, detail: 'Northwind Systems · breach_notification · NW-MSA-2024-118' },
  arbiter: { verdict: '→ HUMAN', confidence: 0.88, detail: 'open_pr + page_oncall auto · notify_customer held at Guild gate' },
} satisfies Required<Verdicts>;

const V_SUPPRESSED = {
  reachability: { verdict: 'NOT REACHABLE', confidence: 0.99, detail: '0 paths · 6 repos checked · depth 5' },
  arbiter: { verdict: 'SUPPRESS', confidence: 0.99, detail: 'zero hops · no clause in range · no action' },
} satisfies Verdicts;

const V_PRECEDENT = {
  reachability: { verdict: 'REACHABLE', confidence: 0.79, detail: 'minimatch → glob → jest → build-api · 4 hops' },
  patch: { verdict: 'CONFLICT', confidence: 0.44, detail: 'bumped 90s ago, staging broke — PatchAttempt#3', conflict: true },
  obligation: { verdict: '§7.3 · 24h', confidence: 1.0, detail: 'folds into the open Northwind notice window' },
  arbiter: { verdict: '→ HUMAN', confidence: 0.71, detail: 'patch-engineer dissents · auto-PR withheld · ticket NW-2291' },
} satisfies Required<Verdicts>;

// ─── focus builders ─────────────────────────────────────────────────────────

function heroFocus(over: Partial<FocusView> = {}): FocusView {
  return {
    advisory: HERO_ADVISORY,
    advisory_class: HERO_CLASS,
    hop_paths: [HERO_PATH],
    absence: null,
    precedents: [],
    oncall: ONCALL,
    transcript: [],
    verdicts: {},
    clocks: [],
    approvals: [],
    receipts: [],
    run: null,
    audit: [],
    ...over,
  };
}

function suppressedFocus(over: Partial<FocusView> = {}): FocusView {
  return {
    advisory: SUPPRESSED_ADVISORY,
    advisory_class: SUPPRESSED_CLASS,
    hop_paths: [],
    absence: null,
    precedents: [],
    oncall: [],
    transcript: [],
    verdicts: {},
    clocks: [],
    approvals: [],
    receipts: [],
    run: null,
    audit: [],
    ...over,
  };
}

function precedentFocus(over: Partial<FocusView> = {}): FocusView {
  return {
    advisory: PRECEDENT_ADVISORY,
    advisory_class: PRECEDENT_CLASS,
    hop_paths: [PRECEDENT_PATH],
    absence: null,
    precedents: [PATCH_PRECEDENT],
    oncall: ONCALL,
    transcript: [],
    verdicts: {},
    clocks: [],
    approvals: [],
    receipts: [],
    run: null,
    audit: [],
    ...over,
  };
}

// ─── the quiet 48: everything the graph threw away ──────────────────────────

const QUIET_PACKAGES = [
  'lodash.template', 'tough-cookie', 'word-wrap', 'semver', 'tar', 'xml2js',
  'follow-redirects', 'postcss', 'webpack-dev-middleware', 'fast-xml-parser',
  'ip', 'braces', 'decode-uri-component', 'http-cache-semantics', 'json5',
  'loader-utils', 'nth-check', 'ansi-regex', 'minimist', 'node-fetch',
  'path-parse', 'shell-quote', 'trim-newlines', 'ua-parser-js', 'underscore',
  'ws', 'yargs-parser', 'async', 'axios', 'body-parser', 'cookie',
  'cross-spawn', 'debug', 'engine.io', 'express-session', 'glob-parent',
  'got', 'jose', 'jsonwebtoken', 'marked', 'moment', 'mongoose', 'multer',
  'nanoid', 'netmask', 'pac-resolver', 'qs', 'request',
];

const QUIET_SUMMARIES = [
  'prototype pollution in deep merge helper',
  'regular expression denial of service in parser',
  'improper input validation on nested keys',
  'uncontrolled resource consumption on malformed input',
  'incorrect authorization check in middleware path',
  'path traversal via crafted archive entry',
  'insufficient escaping in template compilation',
  'open redirect on protocol-relative location header',
];

const QUIET_SEVERITIES: Severity[] = ['HIGH', 'MODERATE', 'CRITICAL', 'LOW', 'MODERATE', 'HIGH'];

const GHSA_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function quietGhsa(seed: number): string {
  let x = (seed * 2_654_435_761) % 2_147_483_647;
  const group = () => {
    let s = '';
    for (let i = 0; i < 4; i += 1) {
      x = (x * 48_271) % 2_147_483_647;
      s += GHSA_ALPHABET[x % GHSA_ALPHABET.length];
    }
    return s;
  };
  return `GHSA-${group()}-${group()}-${group()}`;
}

function quietFeed(): FeedItem[] {
  const base = Date.parse('2026-08-03T16:14:05Z');
  return QUIET_PACKAGES.map((pkg, i) => {
    const received = new Date(base - (i * 1_740_000 + (i % 7) * 61_000));
    const published = new Date(received.getTime() - 900_000);
    return {
      ghsa_id: quietGhsa(i + 17),
      cve_id: `CVE-2026-${(64_100 + i * 13).toString()}`,
      package: pkg,
      severity: QUIET_SEVERITIES[i % QUIET_SEVERITIES.length],
      published_at: published.toISOString(),
      received_at: received.toISOString(),
      hops: 0,
      state: 'suppressed',
      customers: 0,
      in_kev: i % 11 === 3,
      summary: `${pkg}: ${QUIET_SUMMARIES[i % QUIET_SUMMARIES.length]}`,
    };
  });
}

export const QUIET_FEED = quietFeed();

// ─── the hero feed rows ─────────────────────────────────────────────────────

function heroFeedItem(state: FeedItem['state'], hops: number): FeedItem {
  return {
    ghsa_id: HERO_GHSA,
    cve_id: HERO_ADVISORY.cve_id,
    package: HERO_PACKAGE,
    severity: HERO_ADVISORY.severity,
    published_at: HERO_ADVISORY.published_at,
    received_at: '2026-08-03T16:35:33Z',
    hops,
    state,
    customers: hops > 0 ? 1 : 0,
    in_kev: HERO_ADVISORY.in_kev,
    summary: HERO_ADVISORY.summary,
  };
}

function suppressedFeedItem(state: FeedItem['state']): FeedItem {
  return {
    ghsa_id: SUPPRESSED_GHSA,
    cve_id: SUPPRESSED_ADVISORY.cve_id,
    package: SUPPRESSED_PACKAGE,
    severity: SUPPRESSED_ADVISORY.severity,
    published_at: SUPPRESSED_ADVISORY.published_at,
    received_at: '2026-08-03T16:23:12Z',
    hops: 0,
    state,
    customers: 0,
    in_kev: false,
    summary: SUPPRESSED_ADVISORY.summary,
  };
}

function precedentFeedItem(state: FeedItem['state'], hops: number): FeedItem {
  return {
    ghsa_id: PRECEDENT_GHSA,
    cve_id: PRECEDENT_ADVISORY.cve_id,
    package: PRECEDENT_PACKAGE,
    severity: PRECEDENT_ADVISORY.severity,
    published_at: PRECEDENT_ADVISORY.published_at,
    received_at: '2026-08-03T17:02:45Z',
    hops,
    state,
    customers: hops > 0 ? 1 : 0,
    in_kev: false,
    summary: PRECEDENT_ADVISORY.summary,
  };
}

// ─── funnel snapshots ───────────────────────────────────────────────────────

const FUNNEL_BASE: FunnelStats = {
  ingested: 48,
  deduped: 6,
  traversed: 48,
  suppressed: 48,
  escalated: 0,
  actions: 0,
  p99_ms: 1_620,
  window_started_at: '2026-08-02T16:35:00Z',
};

const FUNNEL_B1: FunnelStats = { ...FUNNEL_BASE, ingested: 49, traversed: 49, escalated: 1, actions: 2, p99_ms: 1_842 };
const FUNNEL_B2: FunnelStats = { ...FUNNEL_B1, ingested: 50, traversed: 50, suppressed: 49 };
const FUNNEL_B3: FunnelStats = { ...FUNNEL_B2, ingested: 51, traversed: 51, escalated: 2, actions: 3 };

// ─── the initial AppState ───────────────────────────────────────────────────

export const INITIAL_STATE: AppState = {
  status: {
    live: false,
    mock: true,
    transport: 'local',
    graph_connected: true,
    advisories_24h: 30,
    kev_count: 1_656,
    falkor_ui: 'http://localhost:3000',
    rocketride_trace: 'http://localhost:7070/trace',
    started_at: '2026-08-03T16:30:00Z',
  },
  feed: QUIET_FEED,
  funnel: FUNNEL_BASE,
  clocks: [],
  approvals: [],
  receipts: [],
  runs: [],
  pipelines: PIPELINES,
  graph_stats: {
    nodes: 4_187,
    edges: 11_342,
    advisories: 51,
    packages: 2_604,
    customers: 12,
    chokepoints: 7,
  },
  chokepoints: CHOKEPOINTS,
  focus: null,
};

// ─── the scripted timeline ──────────────────────────────────────────────────

export interface Cue {
  /** ms from the start of the beat */
  at: number;
  msg: ServerMessage;
}

export interface ScriptedBeat {
  step: 1 | 2 | 3;
  label: string;
  ghsa_id: string;
  /** ms — how long to leave the beat running before the next one is sensible */
  duration: number;
  cues: Cue[];
}

const cue = (at: number, msg: ServerMessage): Cue => ({ at, msg });
const log = (at: number, message: string, level: 'info' | 'warn' | 'error' = 'info'): Cue =>
  cue(at, { type: 'log', level, message });

function sorted(cues: Cue[]): Cue[] {
  return cues.slice().sort((a, b) => a.at - b.at);
}

// Beat 1 — the hit. Rings propagate, the clock starts, the PR opens.
const BEAT_1: ScriptedBeat = {
  step: 1,
  label: 'the hit',
  ghsa_id: HERO_GHSA,
  duration: 12_000,
  cues: sorted([
    log(0, 'laserdata: advisories → GHSA-rgw5-rvv9-x895 (published 9h ago)'),
    cue(60, { type: 'feed', item: heroFeedItem('traversing', 0) }),
    cue(160, { type: 'focus', focus: heroFocus() }),
    cue(300, { type: 'pipeline', selection: SEL_HERO }),
    log(320, `rocketride: ${SEL_HERO.pipeline_id} selected by graph for ${HERO_CLASS.id}`),

    ...hopMessages(HERO_GHSA, HERO_CHAIN, { offset: 400 }).map((h) => cue(h.at, h.msg)),

    cue(600, { type: 'agent', event: HERO_BUS[0] }),
    cue(1_500, { type: 'agent', event: HERO_BUS[1] }),
    cue(1_520, { type: 'focus', focus: heroFocus({ transcript: HERO_BUS.slice(0, 2), verdicts: { reachability: V_HERO.reachability } }) }),
    cue(1_700, { type: 'agent', event: HERO_BUS[2] }),

    // terminal ring lands at 2200 — the clock starts the moment it does
    cue(2_300, { type: 'clock', tick: clock(CLOCK_START_SECONDS) }),
    cue(2_400, { type: 'feed', item: heroFeedItem('escalated', 5) }),

    cue(2_500, { type: 'agent', event: HERO_BUS[3] }),
    cue(2_520, { type: 'focus', focus: heroFocus({ transcript: HERO_BUS.slice(0, 4), verdicts: { reachability: V_HERO.reachability, patch: V_HERO.patch } }) }),
    cue(2_800, { type: 'agent', event: HERO_BUS[4] }),
    cue(3_300, { type: 'agent', event: HERO_BUS[5] }),
    cue(3_320, { type: 'focus', focus: heroFocus({ transcript: HERO_BUS.slice(0, 6), verdicts: { reachability: V_HERO.reachability, patch: V_HERO.patch, obligation: V_HERO.obligation }, clocks: [clock(CLOCK_START_SECONDS - 1)] }) }),
    cue(3_800, { type: 'agent', event: HERO_BUS[6] }),
    cue(3_820, { type: 'focus', focus: heroFocus({ transcript: HERO_BUS.slice(0, 7), verdicts: V_HERO, clocks: [clock(CLOCK_START_SECONDS - 2)] }) }),

    cue(4_200, { type: 'receipt', receipt: RECEIPT_PR }),
    log(4_240, 'github: PR #4471 opened on northwind/build-api (mock)'),
    cue(4_600, { type: 'receipt', receipt: RECEIPT_PAGE }),
    log(4_640, 'slack: paged @dvorak in #platform-oncall (mock)'),

    cue(5_100, { type: 'approval', approval: APPROVAL }),
    log(5_140, 'guild: notify_customer BLOCKED — awaiting human approval', 'warn'),

    cue(5_400, { type: 'funnel', funnel: FUNNEL_B1 }),
    cue(5_800, { type: 'agent', event: HERO_BUS[7] }),
    cue(6_000, { type: 'run', run: RUN_HERO }),
    log(6_400, 'falkordb: PatchAttempt#3 written · minimatch 9.0.3 → 9.0.5 · broke_staging', 'warn'),
    cue(6_600, {
      type: 'focus',
      focus: heroFocus({
        transcript: HERO_BUS,
        verdicts: V_HERO,
        clocks: [clock(CLOCK_START_SECONDS - 4)],
        approvals: [APPROVAL],
        receipts: [RECEIPT_PR, RECEIPT_PAGE],
        run: RUN_HERO,
        audit: HERO_AUDIT,
      }),
    }),
    cue(7_000, { type: 'clock', tick: clock(CLOCK_START_SECONDS - 5) }),
    cue(11_000, { type: 'clock', tick: clock(CLOCK_START_SECONDS - 9) }),
  ]),
};

// Beat 2 — the restraint. The wave dies at hop 2 and the screen turns teal.
const BEAT_2: ScriptedBeat = {
  step: 2,
  label: 'the restraint',
  ghsa_id: SUPPRESSED_GHSA,
  duration: 5_000,
  cues: sorted([
    log(0, 'laserdata: advisories → GHSA-0000-supp-0001 (HIGH · cvss 8.1)'),
    cue(60, { type: 'feed', item: suppressedFeedItem('traversing') }),
    cue(160, { type: 'focus', focus: suppressedFocus() }),
    cue(300, { type: 'pipeline', selection: SEL_SUPPRESSED }),
    log(320, `rocketride: ${SEL_SUPPRESSED.pipeline_id} selected by graph for ${SUPPRESSED_CLASS.id}`),

    ...hopMessages(SUPPRESSED_GHSA, SUPPRESSED_CHAIN, { suppressed: true, offset: 400 }).map((h) => cue(h.at, h.msg)),

    cue(600, { type: 'agent', event: SUPPRESSED_BUS[0] }),
    cue(1_000, { type: 'clock', tick: clock(CLOCK_START_SECONDS - 23) }),
    cue(1_200, { type: 'agent', event: SUPPRESSED_BUS[1] }),
    cue(1_260, { type: 'focus', focus: suppressedFocus({ absence: ABSENCE, transcript: SUPPRESSED_BUS.slice(0, 2), verdicts: { reachability: V_SUPPRESSED.reachability } }) }),
    log(1_300, 'falkordb: Q2 proof of no path — 6 repos, depth 5, 0 results'),
    cue(1_700, { type: 'agent', event: SUPPRESSED_BUS[2] }),
    cue(1_760, { type: 'focus', focus: suppressedFocus({ absence: ABSENCE, transcript: SUPPRESSED_BUS.slice(0, 3), verdicts: V_SUPPRESSED }) }),
    cue(1_900, { type: 'feed', item: suppressedFeedItem('suppressed') }),
    cue(2_200, { type: 'agent', event: SUPPRESSED_BUS[3] }),
    cue(2_400, { type: 'funnel', funnel: FUNNEL_B2 }),
    cue(2_700, { type: 'run', run: RUN_SUPPRESSED }),
    cue(2_900, {
      type: 'focus',
      focus: suppressedFocus({
        absence: ABSENCE,
        transcript: SUPPRESSED_BUS,
        verdicts: V_SUPPRESSED,
        run: RUN_SUPPRESSED,
        audit: SUPPRESSED_AUDIT,
      }),
    }),
    log(3_000, 'decision: SUPPRESSED · zero hops · no action taken'),
    cue(4_000, { type: 'clock', tick: clock(CLOCK_START_SECONDS - 26) }),
  ]),
};

// Beat 3 — memory. A different pipeline, and the Patch Engineer dissents.
const BEAT_3: ScriptedBeat = {
  step: 3,
  label: 'memory',
  ghsa_id: PRECEDENT_GHSA,
  duration: 9_000,
  cues: sorted([
    log(0, 'laserdata: advisories → GHSA-0000-prec-0001 (minimatch)'),
    cue(60, { type: 'feed', item: precedentFeedItem('traversing', 0) }),
    cue(160, { type: 'focus', focus: precedentFocus() }),
    cue(300, { type: 'pipeline', selection: SEL_PRECEDENT }),
    log(340, `rocketride: pipeline#2 → ${SEL_PRECEDENT.pipeline_id} — the graph changed its mind`, 'warn'),

    ...hopMessages(PRECEDENT_GHSA, PRECEDENT_CHAIN, { offset: 400 }).map((h) => cue(h.at, h.msg)),

    cue(600, { type: 'agent', event: PRECEDENT_BUS[0] }),
    cue(1_000, { type: 'clock', tick: clock(CLOCK_START_SECONDS - 51) }),
    cue(1_400, { type: 'agent', event: PRECEDENT_BUS[1] }),
    cue(1_460, { type: 'focus', focus: precedentFocus({ transcript: PRECEDENT_BUS.slice(0, 2), verdicts: { reachability: V_PRECEDENT.reachability } }) }),
    cue(1_900, { type: 'feed', item: precedentFeedItem('escalated', 4) }),
    cue(2_000, { type: 'agent', event: PRECEDENT_BUS[2] }),
    log(2_100, 'falkordb: Q3 precedent hit — PatchAttempt#3, written 90s ago', 'warn'),
    cue(2_400, { type: 'agent', event: PRECEDENT_BUS[3] }),
    cue(2_700, { type: 'agent', event: PRECEDENT_BUS[4] }),
    cue(2_760, { type: 'focus', focus: precedentFocus({ transcript: PRECEDENT_BUS.slice(0, 5), verdicts: { reachability: V_PRECEDENT.reachability, patch: V_PRECEDENT.patch } }) }),
    cue(3_300, { type: 'agent', event: PRECEDENT_BUS[5] }),
    cue(3_360, { type: 'focus', focus: precedentFocus({ transcript: PRECEDENT_BUS.slice(0, 6), verdicts: { reachability: V_PRECEDENT.reachability, patch: V_PRECEDENT.patch, obligation: V_PRECEDENT.obligation } }) }),
    cue(3_900, { type: 'agent', event: PRECEDENT_BUS[6] }),
    cue(4_100, { type: 'agent', event: PRECEDENT_BUS[7] }),
    cue(4_160, { type: 'focus', focus: precedentFocus({ transcript: PRECEDENT_BUS, verdicts: V_PRECEDENT }) }),
    cue(4_600, { type: 'receipt', receipt: RECEIPT_TICKET }),
    log(4_640, 'jira: NW-2291 opened — auto-PR withheld on precedent'),
    cue(5_000, { type: 'funnel', funnel: FUNNEL_B3 }),
    cue(5_400, { type: 'run', run: RUN_PRECEDENT }),
    cue(5_600, {
      type: 'focus',
      focus: precedentFocus({
        transcript: PRECEDENT_BUS,
        verdicts: V_PRECEDENT,
        receipts: [RECEIPT_TICKET],
        run: RUN_PRECEDENT,
        audit: PRECEDENT_AUDIT,
      }),
    }),
    cue(6_000, { type: 'clock', tick: clock(CLOCK_START_SECONDS - 56) }),
    cue(8_000, { type: 'clock', tick: clock(CLOCK_START_SECONDS - 58) }),
  ]),
};

export const BEATS: ScriptedBeat[] = [BEAT_1, BEAT_2, BEAT_3];

export function beat(step: number): ScriptedBeat | undefined {
  return BEATS.find((b) => b.step === step);
}

/** the whole arc, flattened, for a headless replay */
export function allCues(): ServerMessage[] {
  return BEATS.flatMap((b) => b.cues.map((c) => c.msg));
}

export const FIXTURE_META = {
  hero_ghsa: HERO_GHSA,
  suppressed_ghsa: SUPPRESSED_GHSA,
  precedent_ghsa: PRECEDENT_GHSA,
  approval_id: APPROVAL_ID,
  deadline_utc: DEADLINE_UTC,
} as const;
