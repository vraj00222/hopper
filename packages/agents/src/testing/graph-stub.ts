/**
 * A GraphPort double for this package's gate only. Not exported from src/index.ts —
 * the real FalkorDB implementation lives in @hopper/graph and arrives through the port.
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

export class StubGraph implements GraphPort {
  readonly verdicts: AgentVerdict[] = [];
  readonly decisions: Decision[] = [];
  readonly patchAttempts: PatchAttempt[] = [];
  readonly observations: Array<{ ghsa_id: string; note: string; ts: string }> = [];
  readonly advisories: Advisory[] = [];

  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  async query<T = Record<string, unknown>>(): Promise<T[]> {
    return [];
  }

  async hopPaths(): Promise<HopPath[]> {
    return [];
  }
  async proveAbsence(ghsaId: string): Promise<AbsenceProof> {
    return {
      package: ghsaId,
      paths: 0,
      decision: 'SUPPRESSED',
      statement: 'SUPPRESSED · zero hops from any repo',
      repos_checked: 0,
      max_depth: 0,
    };
  }
  async precedent(): Promise<Precedent[]> {
    return [];
  }
  async chokePoints(): Promise<ChokePoint[]> {
    return [];
  }
  async whoToWake(): Promise<OnCall[]> {
    return [];
  }
  async auditTrail(): Promise<AuditEntry[]> {
    return [];
  }
  async selectPipeline(): Promise<PipelineSelection | null> {
    return null;
  }

  async upsertAdvisory(a: Advisory): Promise<void> {
    this.advisories.push(a);
  }
  async recordVerdict(v: AgentVerdict): Promise<void> {
    this.verdicts.push(v);
  }
  async recordDecision(d: Decision): Promise<void> {
    this.decisions.push(d);
  }
  async recordPatchAttempt(p: PatchAttempt): Promise<void> {
    this.patchAttempts.push(p);
  }
  async recordObservation(ghsaId: string, note: string, ts = new Date().toISOString()): Promise<void> {
    this.observations.push({ ghsa_id: ghsaId, note, ts });
  }
  async upsertPipeline(_p: Pipeline): Promise<void> {}
  async linkPipelineToClass(_id: string, _cls: AdvisoryClass): Promise<void> {}
  async recordPipelineRun(): Promise<void> {}

  async applySchema(): Promise<void> {}
  async computeBetweenness(): Promise<ChokePoint[]> {
    return [];
  }
  async stats(): Promise<GraphStats> {
    return { nodes: 0, edges: 0, advisories: 0, packages: 0, customers: 0, chokepoints: 0 };
  }
  async reset(): Promise<void> {
    this.verdicts.length = 0;
    this.decisions.length = 0;
    this.patchAttempts.length = 0;
    this.observations.length = 0;
    this.advisories.length = 0;
  }
  async knownAt(): Promise<AuditEntry[]> {
    return [];
  }
}
