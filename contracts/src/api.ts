/**
 * HOPPER — REST + WS surface. The UI builds against this and nothing else.
 */
import type {
  AbsenceProof,
  Advisory,
  AdvisoryClass,
  AuditEntry,
  ChokePoint,
  GraphStats,
  HopPath,
  OnCall,
  Precedent,
} from './graph.js';
import type {
  ActionReceipt,
  AgentBusEvent,
  ApprovalRequest,
  ClockTick,
  FunnelStats,
  PipelineRun,
  PipelineSpec,
} from './events.js';

export const API_PORT = 8787;
export const UI_PORT = 5173;
export const WS_PATH = '/ws';

/** GET /api/state — everything the UI needs on first paint */
export interface AppState {
  status: {
    live: boolean;
    mock: boolean;
    transport: 'laserdata' | 'local';
    graph_connected: boolean;
    advisories_24h: number;
    kev_count: number;
    falkor_ui: string; // http://localhost:3000
    rocketride_trace: string;
    started_at: string;
  };
  feed: FeedItem[];
  funnel: FunnelStats;
  clocks: ClockTick[];
  approvals: ApprovalRequest[];
  receipts: ActionReceipt[];
  runs: PipelineRun[];
  pipelines: Array<{
    pipeline_id: string;
    name: string;
    success_rate: number;
    avg_latency: number;
    runs: number;
  }>;
  graph_stats: GraphStats;
  chokepoints: ChokePoint[];
  focus: FocusView | null;
}

export interface FeedItem {
  ghsa_id: string;
  cve_id: string | null;
  package: string;
  severity: Advisory['severity'];
  published_at: string;
  received_at: string;
  hops: number;
  state: 'ingested' | 'traversing' | 'suppressed' | 'escalated' | 'awaiting_approval';
  customers: number;
  in_kev: boolean;
  summary: string;
}

/** the centre of the screen: one advisory, fully walked */
export interface FocusView {
  advisory: Advisory;
  advisory_class: AdvisoryClass;
  hop_paths: HopPath[];
  absence: AbsenceProof | null;
  precedents: Precedent[];
  oncall: OnCall[];
  transcript: AgentBusEvent[];
  verdicts: {
    reachability?: { verdict: string; confidence: number; detail: string };
    patch?: { verdict: string; confidence: number; detail: string; conflict: boolean };
    obligation?: { verdict: string; confidence: number; detail: string };
    arbiter?: { verdict: string; confidence: number; detail: string };
  };
  clocks: ClockTick[];
  approvals: ApprovalRequest[];
  receipts: ActionReceipt[];
  run: PipelineRun | null;
  audit: AuditEntry[];
}

// ─── WS messages ────────────────────────────────────────────────────────────

export type ServerMessage =
  | { type: 'state'; state: AppState }
  | { type: 'feed'; item: FeedItem }
  | { type: 'clock'; tick: ClockTick }
  | { type: 'agent'; event: AgentBusEvent }
  | { type: 'focus'; focus: FocusView }
  | { type: 'hop'; ghsa_id: string; hop: number; total: number; node: string; terminal: boolean; suppressed: boolean }
  | { type: 'approval'; approval: ApprovalRequest }
  | { type: 'receipt'; receipt: ActionReceipt }
  | { type: 'run'; run: PipelineRun }
  | { type: 'funnel'; funnel: FunnelStats }
  | { type: 'pipeline'; selection: { pipeline_id: string; name: string; success_rate: number; avg_latency: number; advisory_class: string; reason: string } }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

export type ClientMessage =
  | { type: 'subscribe' }
  | { type: 'focus'; ghsa_id: string }
  | { type: 'approve'; approval_id: string; approver: string }
  | { type: 'reject'; approval_id: string; approver: string }
  | { type: 'demo'; step?: number };

// ─── REST ───────────────────────────────────────────────────────────────────

export interface ApiRoutes {
  'GET /api/state': { res: AppState };
  'GET /api/advisories': { res: FeedItem[] };
  'GET /api/advisory/:id': { res: FocusView };
  'POST /api/approve': { req: { approval_id: string; approver: string }; res: ApprovalRequest };
  'POST /api/reject': { req: { approval_id: string; approver: string }; res: ApprovalRequest };
  'POST /api/demo': { req: { step?: number }; res: { ok: boolean } };
  'POST /api/pull-live': { req: { limit?: number }; res: { pulled: number } };
  'GET /api/pipelines': { res: PipelineSpec[] };
  'GET /api/runs': { res: PipelineRun[] };
  'GET /api/audit/:id': { res: AuditEntry[] };
  'POST /api/cypher': { req: { cypher: string }; res: { rows: unknown[] } };
}

export const DEFAULT_APPROVER = 'v.patel@hopper.dev';
