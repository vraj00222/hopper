/**
 * Outcome write-back — the loop that closes.
 *
 * A run finishes, its result goes back onto the Pipeline node, and the next
 * advisory of that class asks the graph again and may get a different answer.
 * This is the only reason the selection in select.ts is interesting: without a
 * write-back it is a lookup table.
 */
import type { GraphPort } from '@hopper/contracts';
import { nowIso } from '@hopper/contracts';

import { LINK_OUTPERFORMED, LIST_OUTPERFORMED, RANK_ALL, UNLINK_OUTPERFORMED, coerceRank } from './cypher.js';
import { expandHandles } from './specs.js';
import { OUTPERFORM_THRESHOLD, applyOutcome, points, q7Order, type MetaState } from './state.js';

export interface OutperformedEdge {
  from: string;
  to: string;
  margin: number;
  advisory_class: string;
}

export async function recordOutcome(
  state: MetaState,
  pipelineId: string,
  ok: boolean,
  latencyMs: number,
): Promise<void> {
  const stat = state.stats.get(pipelineId);
  if (!stat) return; // an id we do not own; nothing to learn from it

  const next = applyOutcome(stat, ok, latencyMs);
  state.stats.set(pipelineId, next);

  // the graph's own counter first, then push the authoritative running numbers
  // onto the node so Q7 orders by what we just learned.
  try {
    await state.graph.recordPipelineRun(pipelineId, ok, latencyMs);
  } catch {
    /* offline: the local cache still moved */
  }

  const spec = state.specs.find((s) => s.id === pipelineId);
  if (spec) {
    try {
      await state.graph.upsertPipeline({
        id: spec.id,
        name: spec.name,
        spec_json: JSON.stringify(spec),
        avg_latency: next.avg_latency,
        success_rate: next.success_rate,
        runs: next.runs,
      });
    } catch {
      /* offline */
    }
  }

  await refreshOutperformed(state);
}

/** classes both pipelines declare — an OUTPERFORMED edge only means something there */
function sharedClasses(state: MetaState, a: string, b: string): string[] {
  const sa = state.specs.find((s) => s.id === a);
  const sb = state.specs.find((s) => s.id === b);
  if (!sa || !sb) return [];
  const setB = new Set(expandHandles(sb).map((c) => c.id));
  return expandHandles(sa)
    .map((c) => c.id)
    .filter((id) => setB.has(id));
}

/**
 * Recompute (Pipeline)-[:OUTPERFORMED {margin}]->(Pipeline).
 *
 * Written when one pipeline leads another by more than 5 percentage points on a
 * class they both claim, retracted when the lead falls back below it - so the
 * edge is a live statement about the library, not an accumulating log.
 */
export async function refreshOutperformed(state: MetaState): Promise<void> {
  const ids = state.specs.map((s) => s.id);
  const ts = nowIso();

  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      const shared = sharedClasses(state, a, b);
      const sa = state.stats.get(a)!;
      const sb = state.stats.get(b)!;
      const margin = points(sa.success_rate) - points(sb.success_rate);

      if (shared.length > 0 && margin > OUTPERFORM_THRESHOLD) {
        try {
          await state.graph.query(LINK_OUTPERFORMED, {
            from: a,
            to: b,
            margin,
            cls: shared[0],
            ts,
          });
        } catch {
          /* offline */
        }
      } else {
        try {
          await state.graph.query(UNLINK_OUTPERFORMED, { from: a, to: b });
        } catch {
          /* offline */
        }
      }
    }
  }
}

export async function outperformedEdges(graph: GraphPort): Promise<OutperformedEdge[]> {
  try {
    const rows = await graph.query<Record<string, unknown>>(LIST_OUTPERFORMED);
    return rows.map((r) => ({
      from: String(r.from_id ?? ''),
      to: String(r.to_id ?? ''),
      margin: Number(r.margin ?? 0),
      advisory_class: String(r.advisory_class ?? ''),
    }));
  } catch {
    return [];
  }
}

export interface LeaderboardRow {
  pipeline_id: string;
  name: string;
  success_rate: number;
  avg_latency: number;
  runs: number;
}

/**
 * Current standings, sorted exactly the way Q7 sorts. Read out of the graph so
 * the board on screen is the same data the selection query ranks over; falls
 * back to the local cache when the graph is unreachable.
 */
export async function leaderboard(state: MetaState): Promise<LeaderboardRow[]> {
  const local = q7Order([...state.stats.values()]).map((s) => ({
    pipeline_id: s.pipeline_id,
    name: s.name,
    success_rate: s.success_rate,
    avg_latency: s.avg_latency,
    runs: s.runs,
  }));

  try {
    const rows = coerceRank(await state.graph.query<Record<string, unknown>>(RANK_ALL));
    if (rows.length === 0) return local;
    return q7Order(rows).map((r) => ({
      pipeline_id: r.pipeline_id,
      name: r.name,
      success_rate: r.success_rate,
      avg_latency: r.avg_latency,
      runs: r.runs,
    }));
  } catch {
    return local;
  }
}
