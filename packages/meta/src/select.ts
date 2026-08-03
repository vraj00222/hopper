/**
 * Selection — Q7, running inside FalkorDB.
 *
 *   MATCH (ac:AdvisoryClass {ecosystem, severity_band, depth_band})
 *   MATCH (p:Pipeline)-[:HANDLES]->(ac)
 *   RETURN p.id, p.spec_json, p.success_rate, p.avg_latency
 *   ORDER BY p.success_rate DESC, p.avg_latency ASC LIMIT 1
 *
 * The graph is not consulted about the pipeline - the graph *is* the decision.
 * This module only turns its answer into something the runtime can execute and
 * one line a person can read off the pipeline strip.
 *
 * Fallbacks, in order:
 *   (a) Q7 hit
 *   (b) no HANDLES edge for this exact class -> widen: same ecosystem+severity,
 *       any depth; then ecosystem only; then the whole library
 *   (c) graph unreachable -> local selection over the same three specs from
 *       cached stats
 * Never throws, always returns a runnable spec, and the reason says which rung
 * fired.
 */
import type { AdvisoryClass, PipelineSelection, PipelineSpec } from '@hopper/contracts';

import {
  RANK_ALL,
  RANK_EXACT,
  RANK_WIDE_ANY,
  RANK_WIDE_ECOSYSTEM,
  RANK_WIDE_SEVERITY,
  coerceRank,
  type RankRow,
} from './cypher.js';
import {
  handlesAnything,
  handlesClass,
  handlesEcosystem,
  handlesEcosystemSeverity,
  parseSpecJson,
  specById,
} from './specs.js';
import { fmtLatency, points, q7Order, type MetaState } from './state.js';

export interface Selection {
  spec: PipelineSpec;
  selection: { pipeline_id: string; success_rate: number; avg_latency: number };
  reason: string;
}

/** the one line that goes on the pipeline strip and gets said out loud */
function reasonLine(
  cls: AdvisoryClass,
  winner: { name: string; success_rate: number; avg_latency: number },
  runnerUp: { name: string; success_rate: number } | null,
  note: string | null,
): string {
  const parts = [
    `${cls.id} -> ${winner.name} (${points(winner.success_rate)}% success, ${fmtLatency(winner.avg_latency)})`,
  ];
  if (note) parts.push(note);
  parts.push(
    runnerUp
      ? `${points(winner.success_rate) - points(runnerUp.success_rate)} points ahead of ${runnerUp.name}`
      : 'only pipeline that handles this class',
  );
  return parts.join(' - ');
}

/** spec_json off the node is authoritative; the on-disk copy is the safety net */
function specFor(pipelineId: string, specJson: string): PipelineSpec | null {
  return parseSpecJson(specJson, pipelineId) ?? specById(pipelineId);
}

/** shape a ranked candidate list into a Selection, or null if it is unusable */
function fromRows(cls: AdvisoryClass, rows: RankRow[], note: string | null): Selection | null {
  const ordered = q7Order(rows);
  for (let i = 0; i < ordered.length; i += 1) {
    const row = ordered[i];
    const spec = specFor(row.pipeline_id, row.spec_json);
    if (!spec) continue;
    const runnerUp = ordered[i + 1] ?? null;
    return {
      spec,
      selection: {
        pipeline_id: row.pipeline_id,
        success_rate: row.success_rate,
        avg_latency: row.avg_latency,
      },
      reason: reasonLine(
        cls,
        { name: row.name || spec.name, success_rate: row.success_rate, avg_latency: row.avg_latency },
        runnerUp ? { name: runnerUp.name, success_rate: runnerUp.success_rate } : null,
        note,
      ),
    };
  }
  return null;
}

/** local candidates built from the cached stats */
function localRows(state: MetaState, match: (s: PipelineSpec) => boolean): RankRow[] {
  return state.specs.filter(match).map((s) => {
    const stat = state.stats.get(s.id)!;
    return {
      pipeline_id: s.id,
      name: s.name,
      spec_json: JSON.stringify(s),
      success_rate: stat.success_rate,
      avg_latency: stat.avg_latency,
      runs: stat.runs,
    };
  });
}

/** fallback (c) — decide from memory over the same library, same ordering */
function selectLocal(state: MetaState, cls: AdvisoryClass, prefix: string): Selection {
  const rungs: Array<[string | null, (s: PipelineSpec) => boolean]> = [
    [prefix, (s) => handlesClass(s, cls)],
    [`${prefix}, widened to ${cls.ecosystem}/${cls.severity_band}/*`, (s) => handlesEcosystemSeverity(s, cls)],
    [`${prefix}, widened to ${cls.ecosystem}/*`, (s) => handlesEcosystem(s, cls)],
    [`${prefix}, widened to */*`, (s) => handlesAnything(s, cls)],
    [`${prefix}, global best`, () => true],
  ];
  for (const [note, match] of rungs) {
    const sel = fromRows(cls, localRows(state, match), note);
    if (sel) return sel;
  }
  // the library is never empty, so this is belt and braces
  const spec = state.specs[0];
  const stat = state.stats.get(spec.id)!;
  return {
    spec,
    selection: { pipeline_id: spec.id, success_rate: stat.success_rate, avg_latency: stat.avg_latency },
    reason: `${cls.id} -> ${spec.name} - ${prefix}, last resort`,
  };
}

/** the runner-up for this class, for the margin in the reason line */
async function runnerUpFor(
  state: MetaState,
  cls: AdvisoryClass,
  winnerId: string,
): Promise<{ name: string; success_rate: number } | null> {
  const params = { eco: cls.ecosystem, sev: cls.severity_band, depth: cls.depth_band };
  let rows: RankRow[];
  try {
    rows = coerceRank(await state.graph.query<Record<string, unknown>>(RANK_EXACT, params));
  } catch {
    rows = localRows(state, (s) => handlesClass(s, cls));
  }
  if (rows.length === 0) rows = localRows(state, (s) => handlesClass(s, cls));
  const next = q7Order(rows).find((r) => r.pipeline_id !== winnerId);
  return next ? { name: next.name || next.pipeline_id, success_rate: next.success_rate } : null;
}

export async function select(state: MetaState, cls: AdvisoryClass): Promise<Selection> {
  // (a) Q7. This is the contract call, and it runs in FalkorDB.
  let hit: PipelineSelection | null = null;
  try {
    hit = await state.graph.selectPipeline(cls);
  } catch {
    return selectLocal(state, cls, 'graph unreachable, local memory');
  }

  if (hit) {
    const spec = specFor(hit.pipeline_id, hit.spec_json);
    if (spec) {
      const runnerUp = await runnerUpFor(state, cls, hit.pipeline_id);
      return {
        spec,
        selection: {
          pipeline_id: hit.pipeline_id,
          success_rate: hit.success_rate,
          avg_latency: hit.avg_latency,
        },
        reason: reasonLine(
          cls,
          { name: hit.name || spec.name, success_rate: hit.success_rate, avg_latency: hit.avg_latency },
          runnerUp,
          null,
        ),
      };
    }
  }

  // (b) no HANDLES edge for this exact class — widen, one rung at a time.
  // `zero` keeps every rung on the correct side of the zero-path boundary.
  const zero = cls.depth_band === 'none';
  const widenings: Array<[string, string, Record<string, unknown>]> = [
    [
      RANK_WIDE_SEVERITY,
      `no exact HANDLES edge, widened to ${cls.ecosystem}/${cls.severity_band}/*`,
      { eco: cls.ecosystem, sev: cls.severity_band, zero },
    ],
    [
      RANK_WIDE_ECOSYSTEM,
      `no exact HANDLES edge, widened to ${cls.ecosystem}/*`,
      { eco: cls.ecosystem, zero },
    ],
    [RANK_WIDE_ANY, 'no HANDLES edge for this ecosystem, widened to */*', { zero }],
    [RANK_ALL, 'no HANDLES edge anywhere, global best', {}],
  ];

  for (const [cypher, note, params] of widenings) {
    try {
      const sel = fromRows(cls, coerceRank(await state.graph.query<Record<string, unknown>>(cypher, params)), note);
      if (sel) return sel;
    } catch {
      return selectLocal(state, cls, 'graph unreachable, local memory');
    }
  }

  // the graph answered but holds nothing usable
  return selectLocal(state, cls, 'graph holds no pipelines, local memory');
}
