/**
 * In-memory MetaPort for the gate ONLY. The real one is @hopper/meta, which
 * stores the specs in FalkorDB and lets Q7 pick the winner (§4.3).
 */
import {
  classId,
  depthBand,
  severityBand,
  type AdvisoryClass,
  type AdvisoryClassInput,
  type MetaPort,
  type PipelineSpec,
} from '@hopper/contracts';

import { DEFAULT_SPEC } from '../specs/index.js';

export interface StubMeta extends MetaPort {
  outcomes: Array<{ pipelineId: string; ok: boolean; latencyMs: number }>;
  selections: Array<{ class_id: string; pipeline_id: string }>;
}

export function createStubMeta(spec: PipelineSpec = DEFAULT_SPEC): StubMeta {
  const outcomes: StubMeta['outcomes'] = [];
  const selections: StubMeta['selections'] = [];
  let runs = 0;
  let successes = 0;
  let totalLatency = 0;

  return {
    outcomes,
    selections,

    classify(input: AdvisoryClassInput): AdvisoryClass {
      const severity_band = severityBand(input.advisory.severity);
      const depth_band = depthBand(input.maxHops, input.pathCount);
      return {
        id: classId(input.advisory.ecosystem, severity_band, depth_band),
        ecosystem: input.advisory.ecosystem,
        severity_band,
        depth_band,
      };
    },

    async select(cls) {
      selections.push({ class_id: cls.id, pipeline_id: spec.id });
      return {
        spec,
        selection: {
          pipeline_id: spec.id,
          success_rate: runs === 0 ? 1 : successes / runs,
          avg_latency: runs === 0 ? 0 : totalLatency / runs,
        },
        reason: `stub meta: only pipeline registered for ${cls.id}`,
      };
    },

    async seedPipelines() {
      return [spec];
    },

    async recordOutcome(pipelineId, ok, latencyMs) {
      outcomes.push({ pipelineId, ok, latencyMs });
      runs += 1;
      if (ok) successes += 1;
      totalLatency += latencyMs;
    },

    async leaderboard() {
      return [
        {
          pipeline_id: spec.id,
          name: spec.name,
          success_rate: runs === 0 ? 1 : successes / runs,
          avg_latency: runs === 0 ? 0 : totalLatency / runs,
          runs,
        },
      ];
    },

    specs: () => [spec],
  };
}
