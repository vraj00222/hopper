/**
 * HOPPER — event contract.
 * Everything that crosses the LaserData bus is one of these. Frozen after Phase 0.
 */
import type {
  ActionKind,
  Advisory,
  AdvisoryClass,
  AgentName,
  HopPath,
  Severity,
} from './graph.js';

export const TOPICS = [
  'advisories',
  'telemetry',
  'clock',
  'kev-delta',
  'agent-bus',
  'decisions',
] as const;
export type Topic = (typeof TOPICS)[number];

export interface EventEnvelope<T = unknown> {
  id: string;
  topic: Topic;
  ts: string; // ISO-8601 UTC
  seq: number;
  payload: T;
}

/** L1 — every new CVE is an event. */
export interface AdvisoryEvent {
  kind: 'advisory';
  advisory: Advisory;
  received_at: string;
}

/** L2 — which functions ran in which service. The reachability signal. */
export interface TelemetryEvent {
  kind: 'telemetry';
  service: string;
  package: string;
  symbol: string; // e.g. "expand"
  calls: number;
  window_seconds: number;
  observed_at: string;
}

/** L3 — 1Hz obligation countdown. The most demo-able object in the product. */
export interface ClockTick {
  kind: 'clock';
  customer: string;
  ghsa_id: string;
  deadline_utc: string;
  remaining_seconds: number;
  window_hours: number;
  clause_ref: string;
  state: 'running' | 'satisfied' | 'breached' | 'paused';
}

/** L4 — a tracked CVE appearing in KEV = severity escalation. */
export interface KevDeltaEvent {
  kind: 'kev-delta';
  cve_id: string;
  ghsa_id: string | null;
  added_at: string;
  known_ransomware: boolean;
  action: 'escalate' | 'noop';
}

/** L5 — agents coordinate over a LaserData topic. Replayable transcript. */
export interface AgentBusEvent {
  kind: 'agent-bus';
  agent: AgentName;
  ghsa_id: string;
  phase: 'started' | 'verdict' | 'conflict' | 'resolved' | 'error';
  message: string;
  confidence?: number;
  payload?: unknown;
  session_id?: string;
}

export interface DecisionEvent {
  kind: 'decision';
  ghsa_id: string;
  action: ActionKind;
  auto: boolean;
  requires_approval: boolean;
  approval_id?: string;
  approved_by?: string | null;
  status: 'proposed' | 'pending_approval' | 'executed' | 'rejected';
  receipt?: ActionReceipt;
  ts: string;
}

export type HopperEvent =
  | AdvisoryEvent
  | TelemetryEvent
  | ClockTick
  | KevDeltaEvent
  | AgentBusEvent
  | DecisionEvent;

// ─── agent I/O — strict JSON schemas ────────────────────────────────────────

export interface ReachabilityVerdict {
  agent: 'reachability';
  reachable: boolean;
  confidence: number;
  call_path: string[];
  telemetry_hits: number;
  rationale: string;
}

export interface PatchVerdict {
  agent: 'patch-engineer';
  safe_bump: boolean;
  target: string | null;
  breaking_risk: 'none' | 'low' | 'medium' | 'high';
  confidence: number;
  precedent_ids: string[];
  rationale: string;
}

export interface ObligationVerdict {
  agent: 'obligation-officer';
  obligated: boolean;
  clauses: Array<{
    customer: string;
    clause_ref: string;
    hours: number;
    deadline_utc: string;
  }>;
  deadline_utc: string | null;
  notice_draft: string;
  confidence: number;
  rationale: string;
}

export interface ArbiterVerdict {
  agent: 'arbiter';
  decision: 'auto' | 'human' | 'suppress';
  conflict: boolean;
  conflict_between: AgentName[];
  actions: ActionKind[];
  confidence: number;
  rationale: string;
}

export type Verdict =
  | ReachabilityVerdict
  | PatchVerdict
  | ObligationVerdict
  | ArbiterVerdict;

export interface AgentRunResult {
  ghsa_id: string;
  session_id: string;
  reachability: ReachabilityVerdict;
  patch: PatchVerdict;
  obligation: ObligationVerdict;
  arbiter: ArbiterVerdict;
  conflict: boolean;
  transcript: AgentBusEvent[];
  approvals: ApprovalRequest[];
}

// ─── HITL (Guild) ───────────────────────────────────────────────────────────

export interface ApprovalRequest {
  id: string;
  action: ActionKind;
  ghsa_id: string;
  title: string;
  body: string;
  requested_at: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  approved_by?: string;
  decided_at?: string;
  /** the token an executor must present; only issued on approval */
  token?: string;
}

export interface ActionReceipt {
  action: ActionKind;
  ok: boolean;
  mock: boolean;
  ref: string; // PR url, slack ts, message id, ticket id
  detail: string;
  ts: string;
  latency_ms: number;
}

// ─── RocketRide pipelines ───────────────────────────────────────────────────

export type PipelineNodeKind =
  | 'source'
  | 'cypher'
  | 'branch'
  | 'agent'
  | 'tool'
  | 'writeback'
  | 'sink';

export interface PipelineNodeSpec {
  id: string;
  kind: PipelineNodeKind;
  op: string; // handler name registered in the runtime
  params?: Record<string, unknown>;
  next?: string[];
  /** for branch nodes: {expression -> nodeId} */
  branches?: Array<{ when: string; to: string }>;
}

export interface PipelineSpec {
  id: string;
  name: string;
  version: string;
  description: string;
  entry: string;
  nodes: PipelineNodeSpec[];
  handles?: Array<Partial<AdvisoryClass>>;
}

export interface NodeTrace {
  node_id: string;
  kind: PipelineNodeKind;
  op: string;
  started_at: string;
  ended_at: string;
  latency_ms: number;
  tokens: number;
  ok: boolean;
  short_circuit: boolean;
  summary: string;
  output?: unknown;
}

export interface PipelineRun {
  run_id: string;
  pipeline_id: string;
  ghsa_id: string;
  advisory_class: string;
  started_at: string;
  ended_at: string;
  latency_ms: number;
  ok: boolean;
  outcome: 'escalated' | 'suppressed' | 'error';
  traces: NodeTrace[];
  hop_paths: HopPath[];
  agent_result?: AgentRunResult;
  receipts: ActionReceipt[];
  selection_reason: string;
}

// ─── funnel / metrics ───────────────────────────────────────────────────────

export interface FunnelStats {
  ingested: number;
  deduped: number;
  traversed: number;
  suppressed: number;
  escalated: number;
  actions: number;
  p99_ms: number;
  window_started_at: string;
}

export interface AdvisoryClassInput {
  advisory: Advisory;
  maxHops: number;
  pathCount: number;
  isChokepoint: boolean;
}

export { type Severity, type ActionKind, type AdvisoryClass, type AgentName };
