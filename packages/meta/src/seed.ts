/**
 * Seeding — the move itself.
 *
 * RocketRide pipelines are portable JSON. JSON is data. Data belongs in the
 * graph. So each .pipe.json becomes a Pipeline node with its whole spec on
 * `spec_json`, wired to every AdvisoryClass it declares by a HANDLES edge.
 * After this runs, nothing on disk is load-bearing: the library lives in
 * FalkorDB and the graph can be asked which pipeline should run.
 *
 * Idempotent. Running it twice leaves exactly three Pipeline nodes and does not
 * reset stats a demo has already earned.
 */
import type { Pipeline, PipelineSpec } from '@hopper/contracts';

import { expandHandles } from './specs.js';
import type { MetaState } from './state.js';
import { refreshOutperformed } from './outcome.js';

function toNode(spec: PipelineSpec, state: MetaState): Pipeline {
  const stat = state.stats.get(spec.id)!;
  return {
    id: spec.id,
    name: spec.name,
    spec_json: JSON.stringify(spec),
    avg_latency: stat.avg_latency,
    success_rate: stat.success_rate,
    runs: stat.runs,
  };
}

export async function seedPipelines(state: MetaState): Promise<PipelineSpec[]> {
  for (const spec of state.specs) {
    try {
      await state.graph.upsertPipeline(toNode(spec, state));
    } catch {
      // graph unreachable: the library still exists locally and fallback (c)
      // will select from it. Seeding is never allowed to take the process down.
    }
    for (const cls of expandHandles(spec)) {
      try {
        await state.graph.linkPipelineToClass(spec.id, cls);
      } catch {
        /* same */
      }
    }
  }

  state.seeded = true;
  await refreshOutperformed(state);
  return state.specs;
}
