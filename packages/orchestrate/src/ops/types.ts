/**
 * What a .pipe node handler sees. Handlers are `(params, state, ctx)` and are
 * registered by `op` name — the same shape a RocketRide node handler has, so a
 * real runtime can drive these unchanged.
 */
import type {
  AbsenceProof,
  ActionReceipt,
  Advisory,
  AgentRunResult,
  HopPath,
  OnCall,
  Precedent,
  RunContext,
  TelemetryEvent,
} from '@hopper/contracts';

import type { Scalar } from '../expr.js';

export interface DeploymentFacts {
  repos: string[];
  services: string[];
  primary_repo: string | null;
  primary_service: string | null;
  tier0: boolean;
}

export interface ObligationFacts {
  customers: string[];
  clauses: Array<{
    customer: string;
    clause_ref: string;
    hours: number;
    deadline_utc: string;
    arr: number;
    governing_law: string;
  }>;
  earliest_deadline_utc: string | null;
  min_window_hours: number;
  arr_at_risk: number;
}

/** Everything a run accumulates. `vars` is the only thing branch conditions see. */
export interface RunState {
  advisory: Advisory;
  vars: Record<string, Scalar>;
  hop_paths: HopPath[];
  absence: AbsenceProof | null;
  deployment: DeploymentFacts | null;
  obligation: ObligationFacts | null;
  precedents: Precedent[];
  oncall: OnCall[];
  telemetry: TelemetryEvent[];
  agent: AgentRunResult | null;
  receipts: ActionReceipt[];
  outcome: 'escalated' | 'suppressed' | 'error';
  statement: string | null;
  started_ms: number;
  notes: string[];
}

export interface OpResult {
  /** one human line for the trace — this is what the operator reads */
  summary: string;
  /** token estimate; 0 for pure-Cypher work */
  tokens?: number;
  ok?: boolean;
  short_circuit?: boolean;
  /** hard jump — clears the pending queue (used by the suppression branch) */
  goto?: string;
  output?: unknown;
}

export type OpHandler = (
  params: Record<string, unknown>,
  state: RunState,
  ctx: RunContext,
) => Promise<OpResult> | OpResult;
