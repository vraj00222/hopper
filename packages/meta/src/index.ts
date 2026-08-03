/**
 * @hopper/meta — the pipeline layer.
 *
 * Most systems have one hardcoded pipeline. Hopper has a library of them stored
 * as nodes in FalkorDB, and the graph picks. Memory does not just feed motion -
 * memory chooses the motion. Portable JSON is what made that possible.
 *
 *   advisory lands
 *     -> classify()      ecosystem + severity band + depth band from the walk
 *     -> select()        Q7 in FalkorDB: success_rate DESC, avg_latency ASC
 *     -> RocketRide runs the returned spec
 *     -> recordOutcome() success_rate / avg_latency back onto the node
 *     -> the next advisory of that class may get a different pipeline
 *
 * Depends on @hopper/contracts and nothing else.
 */
import type {
  AdvisoryClass,
  AdvisoryClassInput,
  GraphPort,
  MetaPort,
  PipelineSpec,
} from '@hopper/contracts';

import { classify } from './classify.js';
import { leaderboard, recordOutcome } from './outcome.js';
import { seedPipelines } from './seed.js';
import { select } from './select.js';
import { createState } from './state.js';

export function createMeta(deps: { graph: GraphPort; mock?: boolean }): MetaPort {
  const state = createState(deps.graph, deps.mock ?? true);

  return {
    classify(input: AdvisoryClassInput): AdvisoryClass {
      return classify(input);
    },

    select(cls: AdvisoryClass) {
      return select(state, cls);
    },

    seedPipelines(): Promise<PipelineSpec[]> {
      return seedPipelines(state);
    },

    recordOutcome(pipelineId: string, ok: boolean, latencyMs: number): Promise<void> {
      return recordOutcome(state, pipelineId, ok, latencyMs);
    },

    leaderboard() {
      return leaderboard(state);
    },

    specs(): PipelineSpec[] {
      return state.specs;
    },
  };
}

export { classify } from './classify.js';
export { OPS, OP_KIND, validateSpec, type ValidationResult } from './validate.js';
export {
  PIPELINE_FILES,
  PIPELINE_IDS,
  SEED_STATS,
  expandHandles,
  loadSpecs,
  pipelinesDir,
  specById,
} from './specs.js';
export { outperformedEdges, type LeaderboardRow, type OutperformedEdge } from './outcome.js';
export type { Selection } from './select.js';
