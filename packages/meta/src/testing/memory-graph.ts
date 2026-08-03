/**
 * An in-memory GraphPort, for the gate only.
 *
 * @hopper/meta may not import @hopper/graph, so the gate needs its own graph to
 * prove against. This one implements the writes and reads the meta layer uses -
 * upsertPipeline, linkPipelineToClass, selectPipeline, recordPipelineRun and
 * query - with Q7's exact ordering semantics: success_rate DESC, avg_latency
 * ASC, LIMIT 1. Everything else on the port is out of scope here and says so.
 */
import type {
  AbsenceProof,
  Advisory,
  AdvisoryClass,
  AgentVerdict,
  AuditEntry,
  ChokePoint,
  Decision,
  GraphPort,
  GraphStats,
  HopPath,
  OnCall,
  PatchAttempt,
  Pipeline,
  PipelineSelection,
  Precedent,
} from '@hopper/contracts';

import { tagOf } from '../cypher.js';

interface Edge {
  from: string;
  to: string;
  margin: number;
  advisory_class: string;
  ts: string;
}

function notForMeta(name: string): never {
  throw new Error(`memory-graph: ${name}() is out of scope for the @hopper/meta gate`);
}

export interface MemoryGraph extends GraphPort {
  /** test hook: how many Pipeline nodes exist */
  pipelineCount(): number;
}

export function createMemoryGraph(): MemoryGraph {
  const pipelines = new Map<string, Pipeline>();
  const classes = new Map<string, AdvisoryClass>();
  const handles = new Set<string>(); // `${pipelineId}|${classId}`
  const outperformed = new Map<string, Edge>(); // `${from}|${to}`

  const rank = (candidates: Pipeline[]) =>
    [...candidates].sort((a, b) => b.success_rate - a.success_rate || a.avg_latency - b.avg_latency);

  const row = (p: Pipeline) => ({
    pipeline_id: p.id,
    name: p.name,
    spec_json: p.spec_json,
    success_rate: p.success_rate,
    avg_latency: p.avg_latency,
    runs: p.runs,
  });

  const matching = (pred: (c: AdvisoryClass) => boolean): Pipeline[] => {
    const ids = new Set<string>();
    for (const cls of classes.values()) {
      if (!pred(cls)) continue;
      for (const p of pipelines.values()) {
        if (handles.has(`${p.id}|${cls.id}`)) ids.add(p.id);
      }
    }
    return [...ids].map((id) => pipelines.get(id)!).filter(Boolean);
  };

  return {
    async connect() {
      /* nothing to connect */
    },
    async close() {
      /* nothing to close */
    },

    async query<T = Record<string, unknown>>(
      cypher: string,
      params: Record<string, unknown> = {},
    ): Promise<T[]> {
      const tag = tagOf(cypher);
      const p = params as Record<string, string | number | boolean>;
      // the zero-path guard the widening queries carry
      const zeroOk = (c: AdvisoryClass) => (c.depth_band === 'none') === (p.zero === true);

      switch (tag) {
        case 'rank_exact':
          return rank(
            matching(
              (c) => c.ecosystem === p.eco && c.severity_band === p.sev && c.depth_band === p.depth,
            ),
          ).map(row) as T[];

        case 'rank_wide_severity':
          return rank(
            matching((c) => c.ecosystem === p.eco && c.severity_band === p.sev && zeroOk(c)),
          ).map(row) as T[];

        case 'rank_wide_ecosystem':
          return rank(matching((c) => c.ecosystem === p.eco && zeroOk(c))).map(row) as T[];

        case 'rank_wide_any':
          return rank(matching((c) => zeroOk(c))).map(row) as T[];

        case 'rank_all':
          return rank([...pipelines.values()]).map(row) as T[];

        case 'count_pipelines':
          return [{ n: pipelines.size }] as T[];

        case 'link_outperformed': {
          const from = String(p.from);
          const to = String(p.to);
          if (!pipelines.has(from) || !pipelines.has(to)) return [] as T[];
          outperformed.set(`${from}|${to}`, {
            from,
            to,
            margin: Number(p.margin),
            advisory_class: String(p.cls ?? ''),
            ts: String(p.ts ?? ''),
          });
          return [{ margin: Number(p.margin) }] as T[];
        }

        case 'unlink_outperformed':
          outperformed.delete(`${String(p.from)}|${String(p.to)}`);
          return [] as T[];

        case 'list_outperformed':
          return [...outperformed.values()]
            .sort((a, b) => b.margin - a.margin)
            .map((e) => ({
              from_id: e.from,
              to_id: e.to,
              margin: e.margin,
              advisory_class: e.advisory_class,
            })) as T[];

        default:
          throw new Error(`memory-graph: unsupported cypher (tag=${String(tag)})`);
      }
    },

    // ── Q7 ────────────────────────────────────────────────────────────────
    async selectPipeline(cls: AdvisoryClass): Promise<PipelineSelection | null> {
      const candidates = rank(
        matching(
          (c) =>
            c.ecosystem === cls.ecosystem &&
            c.severity_band === cls.severity_band &&
            c.depth_band === cls.depth_band,
        ),
      );
      const winner = candidates[0];
      if (!winner) return null;
      return {
        pipeline_id: winner.id,
        name: winner.name,
        spec_json: winner.spec_json,
        success_rate: winner.success_rate,
        avg_latency: winner.avg_latency,
        advisory_class: cls.id,
        reason: 'Q7 · ORDER BY success_rate DESC, avg_latency ASC LIMIT 1',
      };
    },

    // ── writes the meta layer uses ────────────────────────────────────────
    async upsertPipeline(p: Pipeline): Promise<void> {
      pipelines.set(p.id, { ...p }); // MERGE-on-id: idempotent by construction
    },

    async linkPipelineToClass(pipelineId: string, cls: AdvisoryClass): Promise<void> {
      classes.set(cls.id, { ...cls });
      handles.add(`${pipelineId}|${cls.id}`); // a Set is a MERGE
    },

    async recordPipelineRun(pipelineId: string, ok: boolean, latencyMs: number): Promise<void> {
      const p = pipelines.get(pipelineId);
      if (!p) return;
      const runs = p.runs + 1;
      const successes = Math.round(p.success_rate * p.runs) + (ok ? 1 : 0);
      p.runs = runs;
      p.success_rate = successes / runs;
      p.avg_latency = p.avg_latency + 0.3 * (latencyMs - p.avg_latency);
    },

    // ── housekeeping ──────────────────────────────────────────────────────
    async applySchema(): Promise<void> {
      /* no schema to apply in memory */
    },

    async stats(): Promise<GraphStats> {
      return {
        nodes: pipelines.size + classes.size,
        edges: handles.size + outperformed.size,
        advisories: 0,
        packages: 0,
        customers: 0,
        chokepoints: 0,
      };
    },

    async reset(): Promise<void> {
      pipelines.clear();
      classes.clear();
      handles.clear();
      outperformed.clear();
    },

    pipelineCount(): number {
      return pipelines.size;
    },

    // ── out of scope for this package's gate ──────────────────────────────
    hopPaths(): Promise<HopPath[]> {
      return notForMeta('hopPaths');
    },
    proveAbsence(): Promise<AbsenceProof> {
      return notForMeta('proveAbsence');
    },
    precedent(): Promise<Precedent[]> {
      return notForMeta('precedent');
    },
    chokePoints(): Promise<ChokePoint[]> {
      return notForMeta('chokePoints');
    },
    whoToWake(): Promise<OnCall[]> {
      return notForMeta('whoToWake');
    },
    auditTrail(): Promise<AuditEntry[]> {
      return notForMeta('auditTrail');
    },
    upsertAdvisory(_a: Advisory): Promise<void> {
      return notForMeta('upsertAdvisory');
    },
    recordVerdict(_v: AgentVerdict): Promise<void> {
      return notForMeta('recordVerdict');
    },
    recordDecision(_d: Decision): Promise<void> {
      return notForMeta('recordDecision');
    },
    recordPatchAttempt(_p: PatchAttempt): Promise<void> {
      return notForMeta('recordPatchAttempt');
    },
    recordObservation(): Promise<void> {
      return notForMeta('recordObservation');
    },
    computeBetweenness(): Promise<ChokePoint[]> {
      return notForMeta('computeBetweenness');
    },
    knownAt(): Promise<AuditEntry[]> {
      return notForMeta('knownAt');
    },
  };
}

/** every call rejects — proves fallback (c) with no network anywhere near it */
export function createFailingGraph(): GraphPort {
  const boom = async (): Promise<never> => {
    throw new Error('ECONNREFUSED 127.0.0.1:6379');
  };
  return new Proxy({} as GraphPort, {
    get(_t, prop) {
      if (prop === 'then') return undefined; // do not look like a thenable
      return boom;
    },
  });
}
