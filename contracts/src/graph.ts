/**
 * HOPPER — graph contract.
 * 14 node labels, 14 relationship types. Frozen after Phase 0.
 * Every package imports these types; nobody redefines them.
 */

// ─── node labels ────────────────────────────────────────────────────────────

export const NODE_LABELS = [
  'Advisory',
  'Package',
  'Repo',
  'Service',
  'Team',
  'Person',
  'Customer',
  'Contract',
  'Clause',
  'Incident',
  'PatchAttempt',
  'AgentVerdict',
  'Decision',
  'Pipeline',
  'AdvisoryClass',
] as const;
export type NodeLabel = (typeof NODE_LABELS)[number];

export const REL_TYPES = [
  'AFFECTS',
  'DEPENDS_ON',
  'USES',
  'DEPLOYS',
  'CALLS',
  'OWNED_BY',
  'ONCALL',
  'SERVES',
  'SIGNED',
  'HAS_CLAUSE',
  'ON',
  'ABOUT',
  'RESOLVED',
  'HANDLES',
  'OUTPERFORMED',
  'SUPERSEDED_BY',
] as const;
export type RelType = (typeof REL_TYPES)[number];

export type Severity = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type Ecosystem = 'npm' | 'pypi' | 'go' | 'maven' | 'cargo' | 'rubygems';

// ─── node shapes ────────────────────────────────────────────────────────────

export interface Advisory {
  ghsa_id: string;
  cve_id: string | null;
  severity: Severity;
  cvss: number;
  published_at: string; // ISO-8601 UTC
  summary: string;
  in_kev: boolean;
  ecosystem: Ecosystem;
  /** package name the advisory is about, denormalised for fast classification */
  package_name: string;
  vulnerable_range: string;
  fixed_in: string | null;
  source?: 'github' | 'osv' | 'fixture' | 'synthetic';
}

export interface Package {
  name: string;
  ecosystem: Ecosystem;
  is_chokepoint: boolean;
  betweenness: number;
  version?: string;
}

export interface Repo {
  name: string;
  org: string;
  lockfile_path: string;
}

export interface Service {
  name: string;
  tier: 'tier-0' | 'tier-1' | 'tier-2';
  env: 'prod' | 'staging' | 'dev';
  public_facing: boolean;
}

export interface Team {
  name: string;
  slack_channel: string;
}

export interface Person {
  name: string;
  email: string;
  oncall_until: string | null;
  slack_handle: string;
}

export interface Customer {
  name: string;
  tier: 'enterprise' | 'growth' | 'starter';
  arr: number;
  region: 'us' | 'eu' | 'apac';
}

export interface Contract {
  id: string;
  signed_at: string;
  governing_law: string;
}

export type ClauseType =
  | 'breach_notification'
  | 'sla_uptime'
  | 'data_residency'
  | 'audit_right';

export interface Clause {
  type: ClauseType;
  hours: number;
  text_ref: string; // e.g. "§7.3"
  text?: string;
}

export interface Incident {
  id: string;
  opened_at: string;
  severity: Severity;
  ghsa_id?: string;
}

export interface PatchAttempt {
  id: string;
  package: string;
  from_v: string;
  to_v: string;
  outcome: 'success' | 'broke_staging' | 'rolled_back' | 'pending';
  ts: string;
  notes: string;
}

export type AgentName =
  | 'reachability'
  | 'patch-engineer'
  | 'obligation-officer'
  | 'arbiter';

export interface AgentVerdict {
  id: string;
  agent: AgentName;
  verdict: string;
  confidence: number; // 0..1
  rationale: string;
  ts: string;
  ghsa_id: string;
  payload_json?: string;
}

export interface Decision {
  id: string;
  action: ActionKind;
  auto: boolean;
  approved_by: string | null;
  ts: string;
  ghsa_id: string;
  outcome?: 'executed' | 'pending_approval' | 'suppressed' | 'rejected';
}

export interface Pipeline {
  id: string;
  name: string;
  spec_json: string;
  avg_latency: number; // ms
  success_rate: number; // 0..1
  runs: number;
}

export interface AdvisoryClass {
  id: string; // `${ecosystem}/${severity_band}/${depth_band}`
  ecosystem: Ecosystem;
  severity_band: 'low' | 'moderate' | 'high' | 'critical';
  depth_band: 'direct' | 'shallow' | 'deep' | 'none';
}

// ─── query result shapes (Q1–Q7) ────────────────────────────────────────────

/** Q1 — hop count to customer. The money query. */
export interface HopPath {
  customer: string;
  customer_tier: Customer['tier'];
  arr: number;
  service: string;
  repo: string;
  notice_window: number; // hours
  clause_ref: string;
  clause_type: ClauseType;
  hops: number;
  chain: string[]; // ["brace-expansion","minimatch","glob","jest","build-api","Northwind","§7.3"]
  contract_id: string;
  governing_law: string;
}

/** Q2 — proof of no path. */
export interface AbsenceProof {
  package: string;
  paths: number;
  decision: 'SUPPRESSED' | 'ESCALATE';
  statement: string; // "SUPPRESSED · zero hops from any repo"
  repos_checked: number;
  max_depth: number;
}

/** Q3 — precedent. */
export interface Precedent {
  package: string;
  from_v: string;
  to_v: string;
  outcome: PatchAttempt['outcome'];
  ts: string;
  notes: string;
  age_seconds: number;
}

/** Q4 — choke points. */
export interface ChokePoint {
  package: string;
  betweenness: number;
  dependents: number;
  is_chokepoint: boolean;
}

/** Q5 — who to wake. */
export interface OnCall {
  person: string;
  email: string;
  slack_handle: string;
  team: string;
  slack_channel: string;
  service: string;
  oncall_until: string | null;
}

/** Q6 — audit trail. */
export interface AuditEntry {
  ts: string;
  kind: 'verdict' | 'decision' | 'observation' | 'suppression' | 'approval';
  actor: string;
  detail: string;
  ghsa_id: string;
  confidence?: number;
}

/** Q7 — pipeline selection. The meta query. */
export interface PipelineSelection {
  pipeline_id: string;
  name: string;
  spec_json: string;
  success_rate: number;
  avg_latency: number;
  advisory_class: string;
  reason: string;
}

// ─── the graph port ─────────────────────────────────────────────────────────

export type ActionKind =
  | 'open_pr'
  | 'page_oncall'
  | 'notify_customer'
  | 'open_ticket';

export interface GraphStats {
  nodes: number;
  edges: number;
  advisories: number;
  packages: number;
  customers: number;
  chokepoints: number;
}

/**
 * The single interface every consumer of FalkorDB uses.
 * Implemented by @hopper/graph. Never import the falkordb driver outside that package.
 */
export interface GraphPort {
  connect(): Promise<void>;
  close(): Promise<void>;
  /** escape hatch — raw Cypher for the demo console */
  query<T = Record<string, unknown>>(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<T[]>;

  // Q1–Q7
  hopPaths(ghsaId: string, maxDepth?: number): Promise<HopPath[]>;
  proveAbsence(ghsaId: string, maxDepth?: number): Promise<AbsenceProof>;
  precedent(packageName: string): Promise<Precedent[]>;
  chokePoints(limit?: number): Promise<ChokePoint[]>;
  whoToWake(ghsaId: string): Promise<OnCall[]>;
  auditTrail(ghsaId: string): Promise<AuditEntry[]>;
  selectPipeline(cls: AdvisoryClass): Promise<PipelineSelection | null>;

  // writes — memory compounds inside the demo
  upsertAdvisory(a: Advisory): Promise<void>;
  recordVerdict(v: AgentVerdict): Promise<void>;
  recordDecision(d: Decision): Promise<void>;
  recordPatchAttempt(p: PatchAttempt): Promise<void>;
  recordObservation(ghsaId: string, note: string, ts?: string): Promise<void>;
  upsertPipeline(p: Pipeline): Promise<void>;
  linkPipelineToClass(pipelineId: string, cls: AdvisoryClass): Promise<void>;
  recordPipelineRun(
    pipelineId: string,
    ok: boolean,
    latencyMs: number,
  ): Promise<void>;

  // housekeeping
  applySchema(): Promise<void>;
  computeBetweenness(): Promise<ChokePoint[]>;
  stats(): Promise<GraphStats>;
  reset(): Promise<void>;
  /** temporal: what did we know at time T (F5) */
  knownAt(ghsaId: string, isoTs: string): Promise<AuditEntry[]>;
}
