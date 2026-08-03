/**
 * HOPPER — the FalkorDB-backed GraphPort. The primary backend.
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
  PatchAttempt as PatchAttemptType,
  Pipeline,
  PipelineSelection,
  Precedent,
} from '@hopper/contracts';
import { classId, id as newId, nowIso } from '@hopper/contracts';
import { FalkorClient, type ClientOptions } from './client.js';
import { applySchemaTo } from './schema.js';
import { computeBetweenness as brandesChokePoints } from './betweenness.js';
import type { Dataset } from './dataset.js';
import {
  Q2_REPO_COUNT,
  Q3_PRECEDENT,
  Q3_PRECEDENT_FALLBACK,
  Q4_CHOKEPOINTS,
  Q6_DECISIONS,
  Q6_OBSERVATIONS,
  Q6_PATCHES,
  Q6_VERDICTS,
  Q7_SELECT_PIPELINE,
  clampDepth,
  decisionEntry,
  observationEntry,
  patchEntry,
  pipelineReason,
  q1HopPaths,
  q2Absence,
  q5WhoToWake,
  shapeAbsence,
  shapeChokePoints,
  shapeHopPaths,
  shapeOnCall,
  shapePrecedent,
  sortAudit,
  unknownAbsence,
  verdictEntry,
  type Q1Row,
} from './queries.js';

const BATCH = 400;

function chunk<T>(rows: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export class FalkorGraph implements GraphPort {
  private readonly client: FalkorClient;

  constructor(opts: ClientOptions = {}) {
    this.client = new FalkorClient(opts);
  }

  backend(): 'falkordb' {
    return 'falkordb';
  }

  get endpoint(): string {
    return `${this.client.endpoint.host}:${this.client.endpoint.port}/${this.client.graphName}`;
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async query<T = Record<string, unknown>>(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    return this.client.query<T>(cypher, params);
  }

  private async batched(
    cypher: string,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    for (const part of chunk(rows)) {
      if (part.length === 0) continue;
      await this.client.query(cypher, { rows: part });
    }
  }

  // ─── housekeeping ─────────────────────────────────────────────────────────

  async applySchema(): Promise<void> {
    await applySchemaTo(this.client);
  }

  async reset(): Promise<void> {
    await this.client.query('MATCH (n) DETACH DELETE n');
  }

  async stats(): Promise<GraphStats> {
    const one = async (cypher: string): Promise<number> => {
      const rows = await this.client.query<{ c: number }>(cypher);
      return rows.length ? Number(rows[0].c ?? 0) : 0;
    };
    const [nodes, edges, advisories, packages, customers, chokepoints] = await Promise.all([
      one('MATCH (n) RETURN count(n) AS c'),
      one('MATCH ()-[e]->() RETURN count(e) AS c'),
      one('MATCH (a:Advisory) RETURN count(a) AS c'),
      one('MATCH (p:Package) RETURN count(p) AS c'),
      one('MATCH (c:Customer) RETURN count(c) AS c'),
      one('MATCH (p:Package) WHERE p.is_chokepoint = true RETURN count(p) AS c'),
    ]);
    return { nodes, edges, advisories, packages, customers, chokepoints };
  }

  // ─── ingest ───────────────────────────────────────────────────────────────

  async ingest(ds: Dataset): Promise<void> {
    await this.batched(
      `UNWIND $rows AS r
       MERGE (p:Package {name: r.name})
       SET p.ecosystem = r.ecosystem, p.version = r.version,
           p.betweenness = coalesce(p.betweenness, 0.0),
           p.is_chokepoint = coalesce(p.is_chokepoint, false)`,
      ds.packages.map((p) => ({ name: p.name, ecosystem: p.ecosystem, version: p.version })),
    );

    await this.batched(
      `UNWIND $rows AS r
       MATCH (a:Package {name: r.from}), (b:Package {name: r.to})
       MERGE (a)-[e:DEPENDS_ON]->(b)
       SET e.depth = r.depth, e.relation = r.relation`,
      ds.deps as unknown as Record<string, unknown>[],
    );

    await this.batched(
      `UNWIND $rows AS r
       MERGE (x:Repo {name: r.name}) SET x.org = r.org, x.lockfile_path = r.lockfile_path`,
      ds.repos as unknown as Record<string, unknown>[],
    );
    await this.batched(
      `UNWIND $rows AS r
       MERGE (x:Service {name: r.name})
       SET x.tier = r.tier, x.env = r.env, x.public_facing = r.public_facing`,
      ds.services as unknown as Record<string, unknown>[],
    );
    await this.batched(
      `UNWIND $rows AS r MERGE (x:Team {name: r.name}) SET x.slack_channel = r.slack_channel`,
      ds.teams as unknown as Record<string, unknown>[],
    );
    await this.batched(
      `UNWIND $rows AS r
       MERGE (x:Person {email: r.email})
       SET x.name = r.name, x.slack_handle = r.slack_handle, x.oncall_until = r.oncall_until`,
      ds.people as unknown as Record<string, unknown>[],
    );
    await this.batched(
      `UNWIND $rows AS r
       MERGE (x:Customer {name: r.name}) SET x.tier = r.tier, x.arr = r.arr, x.region = r.region`,
      ds.customers as unknown as Record<string, unknown>[],
    );
    await this.batched(
      `UNWIND $rows AS r
       MERGE (x:Contract {id: r.id})
       SET x.signed_at = r.signed_at, x.governing_law = r.governing_law`,
      ds.contracts as unknown as Record<string, unknown>[],
    );
    await this.batched(
      `UNWIND $rows AS r
       MERGE (x:Clause {type: r.type, text_ref: r.text_ref})
       SET x.hours = r.hours, x.text = r.text`,
      ds.clauses as unknown as Record<string, unknown>[],
    );
    await this.batched(
      `UNWIND $rows AS r
       MERGE (x:Advisory {ghsa_id: r.ghsa_id})
       SET x.cve_id = r.cve_id, x.severity = r.severity, x.cvss = r.cvss,
           x.published_at = r.published_at, x.summary = r.summary, x.in_kev = r.in_kev,
           x.ecosystem = r.ecosystem, x.package_name = r.package_name,
           x.vulnerable_range = r.vulnerable_range, x.fixed_in = r.fixed_in,
           x.source = r.source`,
      ds.advisories.map((a) => ({ ...a, source: a.source ?? 'fixture' })),
    );
    await this.batched(
      `UNWIND $rows AS r
       MERGE (x:PatchAttempt {id: r.id})
       SET x.package = r.package, x.from_v = r.from_v, x.to_v = r.to_v,
           x.outcome = r.outcome, x.ts = r.ts, x.notes = r.notes
       WITH x, r MERGE (p:Package {name: r.package}) MERGE (x)-[:ON]->(p)`,
      ds.patchAttempts as unknown as Record<string, unknown>[],
    );

    // ─── edges ──────────────────────────────────────────────────────────────
    await this.batched(
      `UNWIND $rows AS r
       MATCH (x:Repo {name: r.repo}) MERGE (p:Package {name: r.package})
       MERGE (x)-[u:USES]->(p) SET u.declared_version = r.declared_version`,
      ds.uses as unknown as Record<string, unknown>[],
    );
    await this.batched(
      `UNWIND $rows AS r
       MATCH (a:Repo {name: r.from}), (b:Service {name: r.to}) MERGE (a)-[:DEPLOYS]->(b)`,
      ds.deploys as unknown as Record<string, unknown>[],
    );
    await this.batched(
      `UNWIND $rows AS r
       MATCH (a:Service {name: r.from}), (b:Service {name: r.to}) MERGE (a)-[:CALLS]->(b)`,
      ds.calls as unknown as Record<string, unknown>[],
    );
    await this.batched(
      `UNWIND $rows AS r
       MATCH (a:Service {name: r.from}), (b:Team {name: r.to}) MERGE (a)-[:OWNED_BY]->(b)`,
      ds.ownedBy as unknown as Record<string, unknown>[],
    );
    await this.batched(
      `UNWIND $rows AS r
       MATCH (a:Team {name: r.from}), (b:Person {email: r.to}) MERGE (a)-[:ONCALL]->(b)`,
      ds.oncall as unknown as Record<string, unknown>[],
    );
    await this.batched(
      `UNWIND $rows AS r
       MATCH (a:Service {name: r.from}), (b:Customer {name: r.to}) MERGE (a)-[:SERVES]->(b)`,
      ds.serves as unknown as Record<string, unknown>[],
    );
    await this.batched(
      `UNWIND $rows AS r
       MATCH (a:Customer {name: r.from}), (b:Contract {id: r.to}) MERGE (a)-[:SIGNED]->(b)`,
      ds.signed as unknown as Record<string, unknown>[],
    );
    await this.batched(
      `UNWIND $rows AS r
       MATCH (a:Contract {id: r.from}), (b:Clause {text_ref: r.to}) MERGE (a)-[:HAS_CLAUSE]->(b)`,
      ds.hasClause as unknown as Record<string, unknown>[],
    );
    await this.batched(
      `UNWIND $rows AS r
       MATCH (a:Advisory {ghsa_id: r.ghsa_id}) MERGE (p:Package {name: r.package})
       MERGE (a)-[af:AFFECTS]->(p) SET af.range = r.range, af.fixed_in = r.fixed_in`,
      ds.affects as unknown as Record<string, unknown>[],
    );
  }

  // ─── Q1..Q7 ───────────────────────────────────────────────────────────────

  async hopPaths(ghsaId: string, maxDepth?: number): Promise<HopPath[]> {
    const d = clampDepth(maxDepth);
    const rows = await this.client.query<Q1Row>(q1HopPaths(d), { id: ghsaId });
    return shapeHopPaths(rows);
  }

  async proveAbsence(ghsaId: string, maxDepth?: number): Promise<AbsenceProof> {
    const d = clampDepth(maxDepth);
    const repoRows = await this.client.query<{ repos: number }>(Q2_REPO_COUNT);
    const repos = repoRows.length ? Number(repoRows[0].repos ?? 0) : 0;
    const rows = await this.client.query<{ package: string; paths: number; decision: string }>(
      q2Absence(d),
      { id: ghsaId },
    );
    if (rows.length === 0) return unknownAbsence(ghsaId, repos, d);
    return shapeAbsence(rows[0].package, Number(rows[0].paths ?? 0), repos, d);
  }

  async precedent(packageName: string): Promise<Precedent[]> {
    let rows = await this.client.query<Omit<Precedent, 'age_seconds'>>(Q3_PRECEDENT, {
      pkg: packageName,
    });
    if (rows.length === 0) {
      rows = await this.client.query<Omit<Precedent, 'age_seconds'>>(Q3_PRECEDENT_FALLBACK, {
        pkg: packageName,
      });
    }
    return shapePrecedent(rows);
  }

  async chokePoints(limit = 50): Promise<ChokePoint[]> {
    const rows = await this.client.query<{
      package: string;
      betweenness: number;
      dependents: number;
      is_chokepoint: boolean;
    }>(Q4_CHOKEPOINTS, { limit: Math.max(1, Math.floor(limit)) });
    return shapeChokePoints(rows);
  }

  async whoToWake(ghsaId: string): Promise<OnCall[]> {
    const rows = await this.client.query<OnCall & { tier?: string }>(q5WhoToWake(clampDepth(undefined)), {
      id: ghsaId,
    });
    return shapeOnCall(rows);
  }

  async auditTrail(ghsaId: string): Promise<AuditEntry[]> {
    const [verdicts, decisions, observations, patches] = await Promise.all([
      this.client.query<{
        ts: string;
        agent: string;
        verdict: string;
        confidence: number;
        rationale: string;
      }>(Q6_VERDICTS, { id: ghsaId }),
      this.client.query<{
        ts: string;
        action: string;
        auto: boolean;
        approved_by: string | null;
        outcome?: string;
      }>(Q6_DECISIONS, { id: ghsaId }),
      this.client.query<{ ts: string; note: string }>(Q6_OBSERVATIONS, { id: ghsaId }),
      this.client.query<{
        ts: string;
        package: string;
        from_v: string;
        to_v: string;
        outcome: string;
        notes: string;
      }>(Q6_PATCHES, { id: ghsaId }),
    ]);
    return sortAudit([
      ...verdicts.map((v) => verdictEntry(ghsaId, v)),
      ...decisions.map((d) => decisionEntry(ghsaId, d)),
      ...observations.filter((o) => o.note).map((o) => observationEntry(ghsaId, o)),
      ...patches.map((p) => patchEntry(ghsaId, p)),
    ]);
  }

  async knownAt(ghsaId: string, isoTs: string): Promise<AuditEntry[]> {
    const cutoff = Date.parse(isoTs);
    const all = await this.auditTrail(ghsaId);
    return all.filter((e) => Date.parse(e.ts) <= cutoff);
  }

  async selectPipeline(cls: AdvisoryClass): Promise<PipelineSelection | null> {
    const rows = await this.client.query<{
      pipeline_id: string;
      name: string;
      spec_json: string;
      success_rate: number;
      avg_latency: number;
    }>(Q7_SELECT_PIPELINE, {
      eco: cls.ecosystem,
      sev: cls.severity_band,
      depth: cls.depth_band,
    });
    if (rows.length === 0) return null;
    const r = rows[0];
    const cid = cls.id || classId(cls.ecosystem, cls.severity_band, cls.depth_band);
    return {
      pipeline_id: r.pipeline_id,
      name: r.name,
      spec_json: r.spec_json,
      success_rate: Number(r.success_rate ?? 0),
      avg_latency: Number(r.avg_latency ?? 0),
      advisory_class: cid,
      reason: pipelineReason(r.name, Number(r.success_rate ?? 0), Number(r.avg_latency ?? 0), cid),
    };
  }

  // ─── writes ───────────────────────────────────────────────────────────────

  async upsertAdvisory(a: Advisory): Promise<void> {
    await this.client.query(
      `MERGE (x:Advisory {ghsa_id: $ghsa_id})
       SET x.cve_id = $cve_id, x.severity = $severity, x.cvss = $cvss,
           x.published_at = $published_at, x.summary = $summary, x.in_kev = $in_kev,
           x.ecosystem = $ecosystem, x.package_name = $package_name,
           x.vulnerable_range = $vulnerable_range, x.fixed_in = $fixed_in, x.source = $source
       WITH x MERGE (p:Package {name: $package_name})
       SET p.ecosystem = $ecosystem,
           p.betweenness = coalesce(p.betweenness, 0.0),
           p.is_chokepoint = coalesce(p.is_chokepoint, false)
       MERGE (x)-[af:AFFECTS]->(p)
       SET af.range = $vulnerable_range, af.fixed_in = $fixed_in`,
      { ...a, source: a.source ?? 'fixture' },
    );
  }

  async recordVerdict(v: AgentVerdict): Promise<void> {
    await this.client.query(
      `MERGE (x:AgentVerdict {id: $id})
       SET x.agent = $agent, x.verdict = $verdict, x.confidence = $confidence,
           x.rationale = $rationale, x.ts = $ts, x.ghsa_id = $ghsa_id,
           x.payload_json = $payload_json
       WITH x MERGE (a:Advisory {ghsa_id: $ghsa_id}) MERGE (x)-[:ABOUT]->(a)`,
      { ...v, payload_json: v.payload_json ?? null },
    );
  }

  async recordDecision(d: Decision): Promise<void> {
    await this.client.query(
      `MERGE (x:Decision {id: $id})
       SET x.action = $action, x.auto = $auto, x.approved_by = $approved_by,
           x.ts = $ts, x.ghsa_id = $ghsa_id, x.outcome = $outcome
       WITH x MERGE (a:Advisory {ghsa_id: $ghsa_id}) MERGE (x)-[:RESOLVED]->(a)`,
      { ...d, outcome: d.outcome ?? 'executed' },
    );
  }

  async recordPatchAttempt(p: PatchAttemptType): Promise<void> {
    await this.client.query(
      `MERGE (x:PatchAttempt {id: $id})
       SET x.package = $package, x.from_v = $from_v, x.to_v = $to_v,
           x.outcome = $outcome, x.ts = $ts, x.notes = $notes
       WITH x MERGE (p:Package {name: $package})
       SET p.betweenness = coalesce(p.betweenness, 0.0),
           p.is_chokepoint = coalesce(p.is_chokepoint, false)
       MERGE (x)-[:ON]->(p)`,
      p as unknown as Record<string, unknown>,
    );
  }

  async recordObservation(ghsaId: string, note: string, ts?: string): Promise<void> {
    await this.client.query(
      `MERGE (i:Incident {id: $id})
       SET i.opened_at = $ts, i.severity = 'LOW', i.ghsa_id = $ghsa_id, i.note = $note
       WITH i MERGE (a:Advisory {ghsa_id: $ghsa_id}) MERGE (i)-[:ABOUT]->(a)`,
      { id: newId('inc'), ts: ts ?? nowIso(), ghsa_id: ghsaId, note },
    );
  }

  async upsertPipeline(p: Pipeline): Promise<void> {
    await this.client.query(
      `MERGE (x:Pipeline {id: $id})
       SET x.name = $name, x.spec_json = $spec_json, x.avg_latency = $avg_latency,
           x.success_rate = $success_rate, x.runs = $runs`,
      p as unknown as Record<string, unknown>,
    );
  }

  async linkPipelineToClass(pipelineId: string, cls: AdvisoryClass): Promise<void> {
    const cid = cls.id || classId(cls.ecosystem, cls.severity_band, cls.depth_band);
    await this.client.query(
      `MERGE (ac:AdvisoryClass {id: $cid})
       SET ac.ecosystem = $eco, ac.severity_band = $sev, ac.depth_band = $depth
       WITH ac MATCH (p:Pipeline {id: $pid}) MERGE (p)-[:HANDLES]->(ac)`,
      { cid, eco: cls.ecosystem, sev: cls.severity_band, depth: cls.depth_band, pid: pipelineId },
    );
  }

  async recordPipelineRun(pipelineId: string, ok: boolean, latencyMs: number): Promise<void> {
    await this.client.query(
      `MATCH (p:Pipeline {id: $id})
       WITH p, coalesce(p.runs, 0) AS n,
            coalesce(p.success_rate, 0.0) AS sr,
            coalesce(p.avg_latency, 0.0) AS al
       SET p.runs = n + 1,
           p.success_rate = ((sr * n) + $ok) / (n + 1),
           p.avg_latency = ((al * n) + $lat) / (n + 1)`,
      { id: pipelineId, ok: ok ? 1 : 0, lat: latencyMs },
    );
  }

  // ─── betweenness ──────────────────────────────────────────────────────────

  async computeBetweenness(): Promise<ChokePoint[]> {
    const nodes = await this.client.query<{ name: string }>(
      'MATCH (p:Package) RETURN p.name AS name',
    );
    const edges = await this.client.query<{ f: string; t: string }>(
      'MATCH (a:Package)-[:DEPENDS_ON]->(b:Package) RETURN a.name AS f, b.name AS t',
    );
    const outcome = brandesChokePoints(
      nodes.map((n) => n.name),
      edges.map((e) => [e.f, e.t] as [string, string]),
    );
    const rows = nodes.map((n) => ({
      name: n.name,
      b: outcome.scores.get(n.name) ?? 0,
      c: outcome.chokepoints.has(n.name),
    }));
    await this.batched(
      `UNWIND $rows AS r
       MATCH (p:Package {name: r.name}) SET p.betweenness = r.b, p.is_chokepoint = r.c`,
      rows,
    );
    return this.chokePoints(50);
  }
}

export type { PatchAttempt };
