/**
 * In-memory GraphPort for the gate ONLY. Not exported from the package index —
 * the real thing is @hopper/graph, which we never import.
 */
import {
  HERO_CLAUSE,
  HERO_CUSTOMER,
  HERO_PACKAGE,
  HERO_SERVICE,
  HERO_WINDOW_HOURS,
  nowIso,
  sleep,
  type AbsenceProof,
  type Advisory,
  type AdvisoryClass,
  type AgentVerdict,
  type AuditEntry,
  type ChokePoint,
  type Decision,
  type GraphPort,
  type GraphStats,
  type HopPath,
  type OnCall,
  type PatchAttempt,
  type Pipeline,
  type PipelineSelection,
  type Precedent,
} from '@hopper/contracts';

export const HERO_HOP_PATHS: HopPath[] = [
  {
    customer: HERO_CUSTOMER,
    customer_tier: 'enterprise',
    arr: 1_850_000,
    service: HERO_SERVICE,
    repo: 'northwind/build-api',
    notice_window: HERO_WINDOW_HOURS,
    clause_ref: HERO_CLAUSE,
    clause_type: 'breach_notification',
    hops: 4,
    chain: [HERO_PACKAGE, 'minimatch', 'glob', 'jest', HERO_SERVICE, HERO_CUSTOMER, HERO_CLAUSE],
    contract_id: 'CTR-NW-0007',
    governing_law: 'Delaware',
  },
  {
    customer: 'Halcyon Freight',
    customer_tier: 'growth',
    arr: 420_000,
    service: 'ledger-api',
    repo: 'halcyon/ledger',
    notice_window: 72,
    clause_ref: '§11.2',
    clause_type: 'breach_notification',
    hops: 3,
    chain: [HERO_PACKAGE, 'minimatch', 'glob', 'ledger-api', 'Halcyon Freight', '§11.2'],
    contract_id: 'CTR-HF-0031',
    governing_law: 'England and Wales',
  },
];

export interface StubGraphCalls {
  hopPaths: number;
  proveAbsence: number;
  precedent: number;
  chokePoints: number;
  whoToWake: number;
  recordVerdict: number;
  recordDecision: number;
  recordPatchAttempt: number;
  recordObservation: number;
  recordPipelineRun: number;
}

export interface StubGraph extends GraphPort {
  calls: StubGraphCalls;
  written: {
    verdicts: AgentVerdict[];
    decisions: Decision[];
    attempts: PatchAttempt[];
    observations: Array<{ ghsa_id: string; note: string; ts: string }>;
    runs: Array<{ pipeline_id: string; ok: boolean; latency_ms: number }>;
  };
  setHopPaths(paths: HopPath[]): void;
}

export interface StubGraphOptions {
  hopPaths?: HopPath[];
  precedents?: Precedent[];
  chokepoints?: string[];
  /** simulated query latency, ms */
  latencyMs?: number;
}

export function createStubGraph(opts: StubGraphOptions = {}): StubGraph {
  let paths = opts.hopPaths ?? HERO_HOP_PATHS;
  const latency = opts.latencyMs ?? 3;
  const chokepoints = opts.chokepoints ?? [HERO_PACKAGE, 'minimatch'];

  const calls: StubGraphCalls = {
    hopPaths: 0,
    proveAbsence: 0,
    precedent: 0,
    chokePoints: 0,
    whoToWake: 0,
    recordVerdict: 0,
    recordDecision: 0,
    recordPatchAttempt: 0,
    recordObservation: 0,
    recordPipelineRun: 0,
  };

  const written: StubGraph['written'] = {
    verdicts: [],
    decisions: [],
    attempts: [],
    observations: [],
    runs: [],
  };

  const precedents: Precedent[] =
    opts.precedents ??
    [
      {
        package: 'minimatch',
        from_v: '9.0.3',
        to_v: '9.0.5',
        outcome: 'broke_staging',
        ts: new Date(Date.now() - 90_000).toISOString(),
        notes: 'bump broke staging build for build-api; rolled forward next day',
        age_seconds: 90,
      },
    ];

  const q = () => sleep(latency);

  const graph: StubGraph = {
    calls,
    written,
    setHopPaths(next) {
      paths = next;
    },

    async connect() {},
    async close() {},
    async query() {
      await q();
      return [];
    },

    async hopPaths(_ghsaId, _maxDepth) {
      calls.hopPaths += 1;
      await q();
      return paths;
    },
    async proveAbsence(ghsaId, maxDepth = 5): Promise<AbsenceProof> {
      calls.proveAbsence += 1;
      await q();
      const n = paths.length;
      return {
        package: paths[0]?.chain[0] ?? ghsaId,
        paths: n,
        decision: n === 0 ? 'SUPPRESSED' : 'ESCALATE',
        statement:
          n === 0
            ? 'SUPPRESSED · zero hops from any repo'
            : `ESCALATE · ${n} path(s) from a deployed repo`,
        repos_checked: 6,
        max_depth: maxDepth,
      };
    },
    async precedent(packageName) {
      calls.precedent += 1;
      await q();
      return precedents.filter((p) => p.package === packageName || packageName.length > 0);
    },
    async chokePoints(limit = 10): Promise<ChokePoint[]> {
      calls.chokePoints += 1;
      await q();
      return chokepoints.slice(0, limit).map((p, i) => ({
        package: p,
        betweenness: 0.9 - i * 0.1,
        dependents: 120 - i * 20,
        is_chokepoint: true,
      }));
    },
    async whoToWake(): Promise<OnCall[]> {
      calls.whoToWake += 1;
      await q();
      if (paths.length === 0) return [];
      return [
        {
          person: 'R. Okafor',
          email: 'r.okafor@hopper.dev',
          slack_handle: '@rokafor',
          team: 'platform',
          slack_channel: '#platform-oncall',
          service: HERO_SERVICE,
          oncall_until: new Date(Date.now() + 6 * 3_600_000).toISOString(),
        },
      ];
    },
    async auditTrail(ghsaId): Promise<AuditEntry[]> {
      await q();
      return written.observations
        .filter((o) => o.ghsa_id === ghsaId)
        .map((o) => ({
          ts: o.ts,
          kind: 'observation' as const,
          actor: 'orchestrate',
          detail: o.note,
          ghsa_id: o.ghsa_id,
        }));
    },
    async selectPipeline(cls: AdvisoryClass): Promise<PipelineSelection | null> {
      await q();
      return {
        pipeline_id: 'pipe.traversal.full.v1',
        name: 'Traversal chain — full',
        spec_json: '{}',
        success_rate: 0.94,
        avg_latency: 380,
        advisory_class: cls.id,
        reason: 'stub graph selection',
      };
    },

    async upsertAdvisory(_a: Advisory) {},
    async recordVerdict(v) {
      calls.recordVerdict += 1;
      written.verdicts.push(v);
    },
    async recordDecision(d) {
      calls.recordDecision += 1;
      written.decisions.push(d);
    },
    async recordPatchAttempt(p) {
      calls.recordPatchAttempt += 1;
      written.attempts.push(p);
    },
    async recordObservation(ghsaId, note, ts) {
      calls.recordObservation += 1;
      written.observations.push({ ghsa_id: ghsaId, note, ts: ts ?? nowIso() });
    },
    async upsertPipeline(_p: Pipeline) {},
    async linkPipelineToClass() {},
    async recordPipelineRun(pipelineId, ok, latencyMs) {
      calls.recordPipelineRun += 1;
      written.runs.push({ pipeline_id: pipelineId, ok, latency_ms: latencyMs });
    },

    async applySchema() {},
    async computeBetweenness() {
      return graph.chokePoints(10);
    },
    async stats(): Promise<GraphStats> {
      return {
        nodes: 128,
        edges: 214,
        advisories: 3,
        packages: 42,
        customers: 5,
        chokepoints: chokepoints.length,
      };
    },
    async reset() {},
    async knownAt(ghsaId) {
      return graph.auditTrail(ghsaId);
    },
  };

  return graph;
}
