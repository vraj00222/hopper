/**
 * The meta layer's own memory of how each pipeline has been doing.
 *
 * The graph is authoritative - Q7 runs in FalkorDB - but the same numbers are
 * kept here so fallback (c) can still select when the graph is unreachable, and
 * so the running success_rate / EWMA latency arithmetic happens in one place.
 */
import type { GraphPort, PipelineSpec } from '@hopper/contracts';

import { SEED_STATS, loadSpecs, type PipelineId } from './specs.js';

/** how heavily a single run moves the latency average */
export const EWMA_ALPHA = 0.3;

/** a pipeline must lead by more than this many percentage points to OUTPERFORM */
export const OUTPERFORM_THRESHOLD = 5;

export interface PipelineStat {
  pipeline_id: string;
  name: string;
  successes: number;
  runs: number;
  success_rate: number;
  avg_latency: number;
}

export interface MetaState {
  graph: GraphPort;
  mock: boolean;
  specs: PipelineSpec[];
  stats: Map<string, PipelineStat>;
  seeded: boolean;
}

export function createState(graph: GraphPort, mock: boolean): MetaState {
  const specs = loadSpecs();
  const stats = new Map<string, PipelineStat>();
  for (const spec of specs) {
    const seed = SEED_STATS[spec.id as PipelineId] ?? { successes: 0, runs: 0, avg_latency: 1000 };
    stats.set(spec.id, {
      pipeline_id: spec.id,
      name: spec.name,
      successes: seed.successes,
      runs: seed.runs,
      success_rate: seed.runs > 0 ? seed.successes / seed.runs : 0,
      avg_latency: seed.avg_latency,
    });
  }
  return { graph, mock, specs, stats, seeded: false };
}

/** running success rate + exponentially weighted latency */
export function applyOutcome(stat: PipelineStat, ok: boolean, latencyMs: number): PipelineStat {
  const runs = stat.runs + 1;
  const successes = stat.successes + (ok ? 1 : 0);
  const avg_latency =
    stat.runs === 0 ? latencyMs : stat.avg_latency + EWMA_ALPHA * (latencyMs - stat.avg_latency);
  return { ...stat, runs, successes, success_rate: successes / runs, avg_latency };
}

/** Q7's ordering, applied locally: success_rate DESC, avg_latency ASC */
export function q7Order<T extends { success_rate: number; avg_latency: number }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => b.success_rate - a.success_rate || a.avg_latency - b.avg_latency,
  );
}

export function points(rate: number): number {
  return Math.round(rate * 100);
}

export function fmtLatency(ms: number): string {
  if (!Number.isFinite(ms)) return 'n/a';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
