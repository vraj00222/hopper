/**
 * The Cypher the meta layer runs. Q7 and its widenings.
 *
 * Every statement carries a `// hopper.meta.<tag>` first line. Real FalkorDB
 * treats it as a comment; the in-memory GraphPort stub used by the gate reads
 * it to dispatch, so both implementations answer the *same* query text.
 */

export const TAG = /^\s*\/\/\s*hopper\.meta\.([a-z_]+)/;

export function tagOf(cypher: string): string | null {
  const m = TAG.exec(cypher);
  return m ? m[1] : null;
}

/** Q7 exactly as specified in §5, minus the LIMIT so the runner-up is visible. */
export const RANK_EXACT = `// hopper.meta.rank_exact
MATCH (ac:AdvisoryClass {ecosystem:$eco, severity_band:$sev, depth_band:$depth})
MATCH (p:Pipeline)-[:HANDLES]->(ac)
RETURN p.id AS pipeline_id, p.name AS name, p.spec_json AS spec_json,
       p.success_rate AS success_rate, p.avg_latency AS avg_latency, p.runs AS runs
ORDER BY p.success_rate DESC, p.avg_latency ASC`;

/**
 * Every widening carries the zero-path guard: $zero is true when the advisory
 * had no path at all, and a widened candidate must sit on the same side of that
 * line. Widening across severity is a judgement call; widening a suppressor
 * onto a live path is a bug.
 */
const ZERO_GUARD = `WHERE ($zero = true AND ac.depth_band = 'none')
   OR ($zero = false AND ac.depth_band <> 'none')`;

/** fallback (b) rung 1 — same ecosystem + severity band, any compatible depth */
export const RANK_WIDE_SEVERITY = `// hopper.meta.rank_wide_severity
MATCH (ac:AdvisoryClass {ecosystem:$eco, severity_band:$sev})
MATCH (p:Pipeline)-[:HANDLES]->(ac)
${ZERO_GUARD}
WITH DISTINCT p
RETURN p.id AS pipeline_id, p.name AS name, p.spec_json AS spec_json,
       p.success_rate AS success_rate, p.avg_latency AS avg_latency, p.runs AS runs
ORDER BY p.success_rate DESC, p.avg_latency ASC`;

/** fallback (b) rung 2 — ecosystem only */
export const RANK_WIDE_ECOSYSTEM = `// hopper.meta.rank_wide_ecosystem
MATCH (ac:AdvisoryClass {ecosystem:$eco})
MATCH (p:Pipeline)-[:HANDLES]->(ac)
${ZERO_GUARD}
WITH DISTINCT p
RETURN p.id AS pipeline_id, p.name AS name, p.spec_json AS spec_json,
       p.success_rate AS success_rate, p.avg_latency AS avg_latency, p.runs AS runs
ORDER BY p.success_rate DESC, p.avg_latency ASC`;

/** fallback (b) rung 3 — any ecosystem, still on the right side of the guard */
export const RANK_WIDE_ANY = `// hopper.meta.rank_wide_any
MATCH (p:Pipeline)-[:HANDLES]->(ac:AdvisoryClass)
${ZERO_GUARD}
WITH DISTINCT p
RETURN p.id AS pipeline_id, p.name AS name, p.spec_json AS spec_json,
       p.success_rate AS success_rate, p.avg_latency AS avg_latency, p.runs AS runs
ORDER BY p.success_rate DESC, p.avg_latency ASC`;

/** fallback (b) rung 4 — every pipeline in the library, Q7 ordering */
export const RANK_ALL = `// hopper.meta.rank_all
MATCH (p:Pipeline)
RETURN p.id AS pipeline_id, p.name AS name, p.spec_json AS spec_json,
       p.success_rate AS success_rate, p.avg_latency AS avg_latency, p.runs AS runs
ORDER BY p.success_rate DESC, p.avg_latency ASC`;

export const COUNT_PIPELINES = `// hopper.meta.count_pipelines
MATCH (p:Pipeline) RETURN count(p) AS n`;

export const LINK_OUTPERFORMED = `// hopper.meta.link_outperformed
MATCH (a:Pipeline {id:$from}), (b:Pipeline {id:$to})
MERGE (a)-[r:OUTPERFORMED]->(b)
SET r.margin = $margin, r.advisory_class = $cls, r.ts = $ts
RETURN r.margin AS margin`;

export const UNLINK_OUTPERFORMED = `// hopper.meta.unlink_outperformed
MATCH (a:Pipeline {id:$from})-[r:OUTPERFORMED]->(b:Pipeline {id:$to})
DELETE r`;

export const LIST_OUTPERFORMED = `// hopper.meta.list_outperformed
MATCH (a:Pipeline)-[r:OUTPERFORMED]->(b:Pipeline)
RETURN a.id AS from_id, b.id AS to_id, r.margin AS margin, r.advisory_class AS advisory_class
ORDER BY r.margin DESC`;

export interface RankRow {
  pipeline_id: string;
  name: string;
  spec_json: string;
  success_rate: number;
  avg_latency: number;
  runs: number;
}

export function coerceRank(rows: Array<Record<string, unknown>>): RankRow[] {
  return rows.map((r) => ({
    pipeline_id: String(r.pipeline_id ?? ''),
    name: String(r.name ?? ''),
    spec_json: typeof r.spec_json === 'string' ? r.spec_json : '',
    success_rate: Number(r.success_rate ?? 0),
    avg_latency: Number(r.avg_latency ?? 0),
    runs: Number(r.runs ?? 0),
  }));
}
