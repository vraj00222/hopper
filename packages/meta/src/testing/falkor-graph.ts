/**
 * A GraphPort backed by the real FalkorDB on localhost:6379, for the gate only.
 *
 * It implements exactly the surface the meta layer touches, in real Cypher, so
 * the second gate pass proves Q7 orders inside the database rather than inside
 * a TypeScript sort. It writes to its own graph key (default
 * "hopper_meta_gate") so it never disturbs whatever @hopper/graph is seeding.
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

import { FalkorClient, rowsToObjects, withParams } from './falkor-client.js';

export const FALKOR_GRAPH = process.env.FALKOR_GRAPH_META ?? 'hopper_meta_gate';

function notForMeta(name: string): never {
  throw new Error(`falkor-graph: ${name}() is out of scope for the @hopper/meta gate`);
}

/** is FalkorDB up? Used to skip (not fail) the second pass. */
export async function falkorReachable(): Promise<boolean> {
  const c = new FalkorClient();
  try {
    await c.connect(1200);
    const pong = await c.command('PING');
    c.close();
    return pong === 'PONG';
  } catch {
    try {
      c.close();
    } catch {
      /* ignore */
    }
    return false;
  }
}

export function createFalkorGraph(): GraphPort {
  const client = new FalkorClient();

  const run = async (cypher: string, params: Record<string, unknown> = {}) => {
    const reply = await client.command('GRAPH.QUERY', FALKOR_GRAPH, withParams(cypher, params));
    return rowsToObjects(reply);
  };

  return {
    async connect() {
      await client.connect();
      // Q7 hits AdvisoryClass by its three properties and Pipeline by id
      await run('CREATE INDEX IF NOT EXISTS FOR (p:Pipeline) ON (p.id)').catch(() => []);
      await run('CREATE INDEX IF NOT EXISTS FOR (ac:AdvisoryClass) ON (ac.id)').catch(() => []);
    },

    async close() {
      client.close();
    },

    async query<T = Record<string, unknown>>(
      cypher: string,
      params: Record<string, unknown> = {},
    ): Promise<T[]> {
      return (await run(cypher, params)) as T[];
    },

    /** Q7, verbatim from §5, executed by FalkorDB */
    async selectPipeline(cls: AdvisoryClass): Promise<PipelineSelection | null> {
      const rows = await run(
        `MATCH (ac:AdvisoryClass {ecosystem:$eco, severity_band:$sev, depth_band:$depth})
         MATCH (p:Pipeline)-[:HANDLES]->(ac)
         RETURN p.id AS pipeline_id, p.name AS name, p.spec_json AS spec_json,
                p.success_rate AS success_rate, p.avg_latency AS avg_latency
         ORDER BY p.success_rate DESC, p.avg_latency ASC LIMIT 1`,
        { eco: cls.ecosystem, sev: cls.severity_band, depth: cls.depth_band },
      );
      const r = rows[0];
      if (!r) return null;
      return {
        pipeline_id: String(r.pipeline_id),
        name: String(r.name),
        spec_json: String(r.spec_json),
        success_rate: Number(r.success_rate),
        avg_latency: Number(r.avg_latency),
        advisory_class: cls.id,
        reason: 'Q7 · FalkorDB · ORDER BY success_rate DESC, avg_latency ASC LIMIT 1',
      };
    },

    async upsertPipeline(p: Pipeline): Promise<void> {
      await run(
        `MERGE (pl:Pipeline {id:$id})
         SET pl.name = $name, pl.spec_json = $spec, pl.avg_latency = $lat,
             pl.success_rate = $rate, pl.runs = $runs`,
        { id: p.id, name: p.name, spec: p.spec_json, lat: p.avg_latency, rate: p.success_rate, runs: p.runs },
      );
    },

    async linkPipelineToClass(pipelineId: string, cls: AdvisoryClass): Promise<void> {
      await run(
        `MERGE (ac:AdvisoryClass {id:$cid})
         SET ac.ecosystem = $eco, ac.severity_band = $sev, ac.depth_band = $depth
         WITH ac
         MATCH (pl:Pipeline {id:$pid})
         MERGE (pl)-[:HANDLES]->(ac)`,
        { cid: cls.id, eco: cls.ecosystem, sev: cls.severity_band, depth: cls.depth_band, pid: pipelineId },
      );
    },

    async recordPipelineRun(pipelineId: string, ok: boolean, latencyMs: number): Promise<void> {
      await run(
        `MATCH (pl:Pipeline {id:$id})
         SET pl.runs = pl.runs + 1,
             pl.success_rate = (pl.success_rate * (pl.runs - 1) + $delta) / pl.runs,
             pl.avg_latency = pl.avg_latency + 0.3 * ($lat - pl.avg_latency)`,
        { id: pipelineId, delta: ok ? 1 : 0, lat: latencyMs },
      );
    },

    async applySchema(): Promise<void> {
      await run('CREATE INDEX IF NOT EXISTS FOR (p:Pipeline) ON (p.id)').catch(() => []);
    },

    async stats(): Promise<GraphStats> {
      const rows = await run('MATCH (n) RETURN count(n) AS nodes');
      return {
        nodes: Number(rows[0]?.nodes ?? 0),
        edges: 0,
        advisories: 0,
        packages: 0,
        customers: 0,
        chokepoints: 0,
      };
    },

    async reset(): Promise<void> {
      try {
        await client.command('GRAPH.DELETE', FALKOR_GRAPH);
      } catch {
        // the graph key may not exist yet, which is the state we wanted anyway
      }
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
