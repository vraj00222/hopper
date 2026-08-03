/**
 * HOPPER — port contract.
 *
 * Every package implements exactly one of these and depends on NOTHING but
 * @hopper/contracts. The server wires them. This is what stops interface drift.
 */
import type {
  ActionKind,
  Advisory,
  AdvisoryClass,
  GraphPort,
  HopPath,
  Precedent,
} from './graph.js';
import type {
  ActionReceipt,
  AdvisoryClassInput,
  AgentBusEvent,
  AgentRunResult,
  ApprovalRequest,
  ClockTick,
  EventEnvelope,
  FunnelStats,
  HopperEvent,
  PipelineRun,
  PipelineSpec,
  TelemetryEvent,
  Topic,
} from './events.js';

export type Unsubscribe = () => void;

/** LaserData — @hopper/ingest */
export interface EventBusPort {
  connect(): Promise<void>;
  close(): Promise<void>;
  publish<T extends HopperEvent>(topic: Topic, payload: T): Promise<EventEnvelope<T>>;
  subscribe<T extends HopperEvent>(
    topic: Topic,
    handler: (e: EventEnvelope<T>) => void | Promise<void>,
  ): Unsubscribe;
  /** replay everything seen so far on a topic (F5 / demo replay) */
  history<T extends HopperEvent>(topic: Topic, limit?: number): EventEnvelope<T>[];
  kvSet(namespace: string, key: string, value: unknown): Promise<void>;
  kvGet<T = unknown>(namespace: string, key: string): Promise<T | null>;
  kvList<T = unknown>(namespace: string): Promise<Array<{ key: string; value: T }>>;
  /** memory-recall over past incidents (LaserData memory()) */
  recall(namespace: string, q: string): Promise<Array<{ text: string; score: number }>>;
  stats(): FunnelStats;
  transport(): 'laserdata' | 'local';
  p99(): number;
}

/** @hopper/ingest — the producer side */
export interface IngestPort {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** pull real advisories (github → osv → fixture cascade) */
  pullLive(opts?: { limit?: number; hours?: number }): Promise<Advisory[]>;
  /** publish a burst for the 50→2 funnel demo */
  burst(n: number, overSeconds: number): Promise<number>;
  /** start a 1Hz obligation clock in kv */
  startClock(input: {
    ghsa_id: string;
    customer: string;
    window_hours: number;
    clause_ref: string;
    started_at?: string;
  }): Promise<ClockTick>;
  stopClock(ghsaId: string, customer: string): Promise<void>;
  clocks(): Promise<ClockTick[]>;
  telemetryFor(packageName: string): TelemetryEvent[];
  /** replay a fixture file through the bus, preserving relative timing */
  replay(fixturePath: string, speed?: number): Promise<number>;
}

/** RocketRide — @hopper/orchestrate */
export interface PipelineRuntimePort {
  register(spec: PipelineSpec): void;
  registered(): PipelineSpec[];
  /** load a .pipe spec from a JSON string at runtime (§4.3 depends on this) */
  loadFromJson(json: string): PipelineSpec;
  run(spec: PipelineSpec, advisory: Advisory, ctx: RunContext): Promise<PipelineRun>;
  runs(): PipelineRun[];
  traceUrl(runId: string): string;
}

export interface RunContext {
  graph: GraphPort;
  bus: EventBusPort;
  agents: AgentsPort;
  tools: ToolsPort;
  meta: MetaPort;
  selection_reason: string;
  advisory_class: AdvisoryClass;
  mock: boolean;
  log(msg: string): void;
}

/** the event router that owns the whole loop */
export interface OrchestratorPort {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** full arc for one advisory: classify → select → execute → write back */
  handle(advisory: Advisory): Promise<PipelineRun | null>;
  runs(): PipelineRun[];
  funnel(): FunnelStats;
}

/** Guild — @hopper/agents */
export interface AgentsPort {
  run(input: AgentInput): Promise<AgentRunResult>;
  transcript(ghsaId: string): AgentBusEvent[];
  pendingApprovals(): ApprovalRequest[];
  approve(id: string, approver: string): Promise<ApprovalRequest>;
  reject(id: string, approver: string): Promise<ApprovalRequest>;
  approval(id: string): ApprovalRequest | null;
  /** Guild session trace, read back out for the audit panel (G8) */
  sessionTrace(sessionId: string): Promise<AgentBusEvent[]>;
  credential(name: string): Promise<string | null>;
}

export interface AgentInput {
  advisory: Advisory;
  hopPaths: HopPath[];
  telemetry: TelemetryEvent[];
  precedents: Precedent[];
  isChokepoint: boolean;
  bus?: EventBusPort;
  graph?: GraphPort;
}

/** the four tool executors — every one honours MOCK */
export interface ToolsPort {
  openPr(input: {
    ghsa_id: string;
    package: string;
    from_v: string;
    to_v: string;
    repo: string;
  }): Promise<ActionReceipt>;
  pageOncall(input: {
    ghsa_id: string;
    person: string;
    slack_handle: string;
    channel: string;
    summary: string;
  }): Promise<ActionReceipt>;
  notifyCustomer(input: {
    ghsa_id: string;
    customer: string;
    clause_ref: string;
    deadline_utc: string;
    body: string;
    approval_token: string; // G6 — cannot execute without one
  }): Promise<ActionReceipt>;
  openTicket(input: {
    ghsa_id: string;
    title: string;
    body: string;
    assignee: string;
  }): Promise<ActionReceipt>;
  receipts(): ActionReceipt[];
  requires(action: ActionKind): 'auto' | 'approval';
}

/** the meta layer — @hopper/meta */
export interface MetaPort {
  classify(input: AdvisoryClassInput): AdvisoryClass;
  /** graph-selected pipeline (Q7) with fallback */
  select(cls: AdvisoryClass): Promise<{
    spec: PipelineSpec;
    selection: { pipeline_id: string; success_rate: number; avg_latency: number };
    reason: string;
  }>;
  /** seed the 3 variants + their HANDLES edges */
  seedPipelines(): Promise<PipelineSpec[]>;
  recordOutcome(pipelineId: string, ok: boolean, latencyMs: number): Promise<void>;
  leaderboard(): Promise<
    Array<{ pipeline_id: string; name: string; success_rate: number; avg_latency: number; runs: number }>
  >;
  specs(): PipelineSpec[];
}

export type { ActionKind, ActionReceipt, ApprovalRequest, PipelineRun, PipelineSpec };
