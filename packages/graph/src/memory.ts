/**
 * HOPPER — the in-memory GraphPort.
 *
 * Risk register, line 1: Docker dies at 8pm. This backend exists so the demo
 * does not. It is seeded from the same seed modules, answers Q1..Q7 with the
 * same shaping helpers, and passes the same gate — the only thing it gives up
 * is arbitrary Cypher through query(), where it understands a small, useful
 * subset and returns nothing for the rest.
 */
import type {
  AbsenceProof,
  Advisory,
  AdvisoryClass,
  AgentVerdict,
  AuditEntry,
  ChokePoint,
  Clause,
  Contract,
  Customer,
  Decision,
  GraphPort,
  GraphStats,
  HopPath,
  Incident,
  OnCall,
  Package,
  PatchAttempt,
  Person,
  Pipeline,
  PipelineSelection,
  Precedent,
  Repo,
  Service,
  Team,
} from '@hopper/contracts';
import { classId, id as newId, nowIso } from '@hopper/contracts';
import { computeBetweenness as brandesChokePoints } from './betweenness.js';
import type { AffectsEdge, ClauseSeed, Dataset, DepEdge, Edge2, UsesEdge } from './dataset.js';
import { toPackageNode } from './dataset.js';
import {
  clampDepth,
  decisionEntry,
  observationEntry,
  patchEntry,
  pipelineReason,
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

interface IncidentNote extends Incident {
  note: string;
}

export class MemoryGraph implements GraphPort {
  private packages = new Map<string, Package>();
  private deps: DepEdge[] = [];
  private adj = new Map<string, string[]>();
  private inDegree = new Map<string, number>();

  private repos = new Map<string, Repo>();
  private services = new Map<string, Service>();
  private teams = new Map<string, Team>();
  private people = new Map<string, Person>();
  private customers = new Map<string, Customer>();
  private contracts = new Map<string, Contract>();
  private clauses = new Map<string, ClauseSeed>();
  private advisories = new Map<string, Advisory>();
  private patchAttempts = new Map<string, PatchAttempt>();
  private verdicts = new Map<string, AgentVerdict>();
  private decisions = new Map<string, Decision>();
  private incidents = new Map<string, IncidentNote>();
  private pipelines = new Map<string, Pipeline>();
  private classes = new Map<string, AdvisoryClass>();
  private handles: Edge2[] = [];

  private uses: UsesEdge[] = [];
  private deploys: Edge2[] = [];
  private calls: Edge2[] = [];
  private ownedBy: Edge2[] = [];
  private oncallEdges: Edge2[] = [];
  private serves: Edge2[] = [];
  private signed: Edge2[] = [];
  private hasClause: Edge2[] = [];
  private affects: AffectsEdge[] = [];

  private warnedCypher = false;

  backend(): 'memory' {
    return 'memory';
  }

  async connect(): Promise<void> {
    /* nothing to connect to — that is the point */
  }

  async close(): Promise<void> {
    /* no-op */
  }

  async applySchema(): Promise<void> {
    /* the ontology is the TypeScript above; indices are Maps */
  }

  async reset(): Promise<void> {
    this.packages.clear();
    this.deps = [];
    this.adj.clear();
    this.inDegree.clear();
    this.repos.clear();
    this.services.clear();
    this.teams.clear();
    this.people.clear();
    this.customers.clear();
    this.contracts.clear();
    this.clauses.clear();
    this.advisories.clear();
    this.patchAttempts.clear();
    this.verdicts.clear();
    this.decisions.clear();
    this.incidents.clear();
    this.pipelines.clear();
    this.classes.clear();
    this.handles = [];
    this.uses = [];
    this.deploys = [];
    this.calls = [];
    this.ownedBy = [];
    this.oncallEdges = [];
    this.serves = [];
    this.signed = [];
    this.hasClause = [];
    this.affects = [];
  }

  // ─── ingest ───────────────────────────────────────────────────────────────

  private touchPackage(name: string, ecosystem: Package['ecosystem'] = 'npm'): Package {
    let p = this.packages.get(name);
    if (!p) {
      p = { name, ecosystem, is_chokepoint: false, betweenness: 0 };
      this.packages.set(name, p);
    }
    return p;
  }

  private reindexDeps(): void {
    this.adj.clear();
    this.inDegree.clear();
    for (const name of this.packages.keys()) this.inDegree.set(name, 0);
    for (const d of this.deps) {
      const list = this.adj.get(d.from);
      if (list) list.push(d.to);
      else this.adj.set(d.from, [d.to]);
      this.inDegree.set(d.to, (this.inDegree.get(d.to) ?? 0) + 1);
    }
  }

  async ingest(ds: Dataset): Promise<void> {
    for (const p of ds.packages) {
      const node = this.packages.get(p.name);
      if (node) {
        if (!node.version && p.version) node.version = p.version;
      } else {
        this.packages.set(p.name, toPackageNode(p));
      }
    }
    const depKey = new Set(this.deps.map((d) => `${d.from} ${d.to}`));
    for (const d of ds.deps) {
      this.touchPackage(d.from);
      this.touchPackage(d.to);
      const k = `${d.from} ${d.to}`;
      if (!depKey.has(k)) {
        depKey.add(k);
        this.deps.push(d);
      }
    }
    for (const r of ds.repos) this.repos.set(r.name, r);
    for (const s of ds.services) this.services.set(s.name, s);
    for (const t of ds.teams) this.teams.set(t.name, t);
    for (const p of ds.people) this.people.set(p.email, p);
    for (const c of ds.customers) this.customers.set(c.name, c);
    for (const c of ds.contracts) this.contracts.set(c.id, c);
    for (const c of ds.clauses) this.clauses.set(c.text_ref, c);
    for (const a of ds.advisories) this.advisories.set(a.ghsa_id, a);
    for (const pa of ds.patchAttempts) {
      this.patchAttempts.set(pa.id, pa);
      this.touchPackage(pa.package);
    }
    for (const u of ds.uses) {
      this.touchPackage(u.package);
      this.uses.push(u);
    }
    for (const a of ds.affects) {
      this.touchPackage(a.package);
      this.affects.push(a);
    }
    this.deploys.push(...ds.deploys);
    this.calls.push(...ds.calls);
    this.ownedBy.push(...ds.ownedBy);
    this.oncallEdges.push(...ds.oncall);
    this.serves.push(...ds.serves);
    this.signed.push(...ds.signed);
    this.hasClause.push(...ds.hasClause);
    this.reindexDeps();
  }

  // ─── traversal ────────────────────────────────────────────────────────────

  /** BFS from `root` over DEPENDS_ON; returns the shortest node path to `target` */
  private shortestChain(root: string, target: string, maxDepth: number): string[] | null {
    if (root === target) return [root];
    const prev = new Map<string, string | null>([[root, null]]);
    const depth = new Map<string, number>([[root, 0]]);
    const queue = [root];
    for (let head = 0; head < queue.length; head += 1) {
      const cur = queue[head];
      const d = depth.get(cur) ?? 0;
      if (d >= maxDepth) continue;
      for (const nxt of this.adj.get(cur) ?? []) {
        if (prev.has(nxt)) continue;
        prev.set(nxt, cur);
        depth.set(nxt, d + 1);
        if (nxt === target) {
          const chain: string[] = [];
          let c: string | null = nxt;
          while (c !== null && c !== undefined) {
            chain.unshift(c);
            c = prev.get(c) ?? null;
          }
          return chain;
        }
        queue.push(nxt);
      }
    }
    return null;
  }

  private vulnPackagesFor(ghsaId: string): string[] {
    const direct = this.affects.filter((a) => a.ghsa_id === ghsaId).map((a) => a.package);
    if (direct.length) return [...new Set(direct)];
    const adv = this.advisories.get(ghsaId);
    return adv && this.packages.has(adv.package_name) ? [adv.package_name] : [];
  }

  /** repo -> shortest package chain [root,...,vuln] */
  private reachingRepos(vuln: string, maxDepth: number): Map<string, string[]> {
    const best = new Map<string, string[]>();
    for (const u of this.uses) {
      const chain = this.shortestChain(u.package, vuln, maxDepth);
      if (!chain) continue;
      const prev = best.get(u.repo);
      if (!prev || chain.length < prev.length) best.set(u.repo, chain);
    }
    return best;
  }

  // ─── Q1..Q7 ───────────────────────────────────────────────────────────────

  async hopPaths(ghsaId: string, maxDepth?: number): Promise<HopPath[]> {
    const d = clampDepth(maxDepth);
    const rows: Q1Row[] = [];
    for (const vuln of this.vulnPackagesFor(ghsaId)) {
      for (const [repoName, chain] of this.reachingRepos(vuln, d)) {
        const repo = this.repos.get(repoName);
        if (!repo) continue;
        for (const dep of this.deploys.filter((e) => e.from === repoName)) {
          const service = this.services.get(dep.to);
          if (!service) continue;
          for (const sv of this.serves.filter((e) => e.from === service.name)) {
            const customer = this.customers.get(sv.to);
            if (!customer) continue;
            for (const sg of this.signed.filter((e) => e.from === customer.name)) {
              const contract = this.contracts.get(sg.to);
              if (!contract) continue;
              for (const hc of this.hasClause.filter((e) => e.from === contract.id)) {
                const clause = this.clauses.get(hc.to);
                if (!clause || clause.type !== 'breach_notification') continue;
                rows.push({
                  customer: customer.name,
                  customer_tier: customer.tier,
                  arr: customer.arr,
                  service: service.name,
                  repo: repo.name,
                  notice_window: clause.hours,
                  clause_ref: clause.text_ref,
                  clause_type: clause.type,
                  hops: chain.length, // 1 USES + (chain.length - 1) DEPENDS_ON
                  chain: [repo.name, ...chain],
                  contract_id: contract.id,
                  governing_law: contract.governing_law,
                });
              }
            }
          }
        }
      }
    }
    return shapeHopPaths(rows);
  }

  async proveAbsence(ghsaId: string, maxDepth?: number): Promise<AbsenceProof> {
    const d = clampDepth(maxDepth);
    const repos = this.repos.size;
    const vulns = this.vulnPackagesFor(ghsaId);
    if (vulns.length === 0) return unknownAbsence(ghsaId, repos, d);
    const reachers = new Set<string>();
    for (const vuln of vulns) for (const r of this.reachingRepos(vuln, d).keys()) reachers.add(r);
    return shapeAbsence(vulns[0], reachers.size, repos, d);
  }

  async precedent(packageName: string): Promise<Precedent[]> {
    const rows = [...this.patchAttempts.values()]
      .filter((p) => p.package === packageName)
      .map((p) => ({
        package: p.package,
        from_v: p.from_v,
        to_v: p.to_v,
        outcome: p.outcome,
        ts: p.ts,
        notes: p.notes,
      }));
    return shapePrecedent(rows);
  }

  async chokePoints(limit = 50): Promise<ChokePoint[]> {
    const rows = [...this.packages.values()]
      .filter((p) => p.is_chokepoint)
      .map((p) => ({
        package: p.name,
        betweenness: p.betweenness,
        dependents: this.inDegree.get(p.name) ?? 0,
        is_chokepoint: p.is_chokepoint,
      }))
      .sort(
        (a, b) =>
          b.betweenness - a.betweenness ||
          b.dependents - a.dependents ||
          a.package.localeCompare(b.package),
      )
      .slice(0, Math.max(1, Math.floor(limit)));
    return shapeChokePoints(rows);
  }

  async whoToWake(ghsaId: string): Promise<OnCall[]> {
    const d = clampDepth(undefined);
    const rows: Array<OnCall & { tier?: string }> = [];
    for (const vuln of this.vulnPackagesFor(ghsaId)) {
      for (const repoName of this.reachingRepos(vuln, d).keys()) {
        for (const dep of this.deploys.filter((e) => e.from === repoName)) {
          const service = this.services.get(dep.to);
          if (!service) continue;
          for (const ob of this.ownedBy.filter((e) => e.from === service.name)) {
            const team = this.teams.get(ob.to);
            if (!team) continue;
            for (const oc of this.oncallEdges.filter((e) => e.from === team.name)) {
              const person = this.people.get(oc.to);
              if (!person) continue;
              rows.push({
                person: person.name,
                email: person.email,
                slack_handle: person.slack_handle,
                team: team.name,
                slack_channel: team.slack_channel,
                service: service.name,
                oncall_until: person.oncall_until,
                tier: service.tier,
              });
            }
          }
        }
      }
    }
    return shapeOnCall(rows);
  }

  async auditTrail(ghsaId: string): Promise<AuditEntry[]> {
    const entries: AuditEntry[] = [];
    for (const v of this.verdicts.values()) {
      if (v.ghsa_id === ghsaId) entries.push(verdictEntry(ghsaId, v));
    }
    for (const d of this.decisions.values()) {
      if (d.ghsa_id === ghsaId) entries.push(decisionEntry(ghsaId, d));
    }
    for (const i of this.incidents.values()) {
      if (i.ghsa_id === ghsaId && i.note) {
        entries.push(observationEntry(ghsaId, { ts: i.opened_at, note: i.note }));
      }
    }
    const pkgs = new Set(this.vulnPackagesFor(ghsaId));
    for (const pa of this.patchAttempts.values()) {
      if (pkgs.has(pa.package)) entries.push(patchEntry(ghsaId, pa));
    }
    return sortAudit(entries);
  }

  async knownAt(ghsaId: string, isoTs: string): Promise<AuditEntry[]> {
    const cutoff = Date.parse(isoTs);
    const all = await this.auditTrail(ghsaId);
    return all.filter((e) => Date.parse(e.ts) <= cutoff);
  }

  async selectPipeline(cls: AdvisoryClass): Promise<PipelineSelection | null> {
    const cid = cls.id || classId(cls.ecosystem, cls.severity_band, cls.depth_band);
    const target = [...this.classes.values()].find(
      (c) =>
        c.ecosystem === cls.ecosystem &&
        c.severity_band === cls.severity_band &&
        c.depth_band === cls.depth_band,
    );
    if (!target) return null;
    const candidates = this.handles
      .filter((h) => h.to === target.id)
      .map((h) => this.pipelines.get(h.from))
      .filter((p): p is Pipeline => p !== undefined)
      .sort((a, b) => b.success_rate - a.success_rate || a.avg_latency - b.avg_latency);
    const p = candidates[0];
    if (!p) return null;
    return {
      pipeline_id: p.id,
      name: p.name,
      spec_json: p.spec_json,
      success_rate: p.success_rate,
      avg_latency: p.avg_latency,
      advisory_class: cid,
      reason: pipelineReason(p.name, p.success_rate, p.avg_latency, cid),
    };
  }

  // ─── writes ───────────────────────────────────────────────────────────────

  async upsertAdvisory(a: Advisory): Promise<void> {
    this.advisories.set(a.ghsa_id, a);
    this.touchPackage(a.package_name, a.ecosystem);
    if (!this.affects.some((e) => e.ghsa_id === a.ghsa_id && e.package === a.package_name)) {
      this.affects.push({
        ghsa_id: a.ghsa_id,
        package: a.package_name,
        range: a.vulnerable_range,
        fixed_in: a.fixed_in,
      });
    }
    this.reindexDeps();
  }

  async recordVerdict(v: AgentVerdict): Promise<void> {
    this.verdicts.set(v.id, v);
  }

  async recordDecision(d: Decision): Promise<void> {
    this.decisions.set(d.id, { ...d, outcome: d.outcome ?? 'executed' });
  }

  async recordPatchAttempt(p: PatchAttempt): Promise<void> {
    this.patchAttempts.set(p.id, p);
    this.touchPackage(p.package);
    this.reindexDeps();
  }

  async recordObservation(ghsaId: string, note: string, ts?: string): Promise<void> {
    const iid = newId('inc');
    this.incidents.set(iid, {
      id: iid,
      opened_at: ts ?? nowIso(),
      severity: 'LOW',
      ghsa_id: ghsaId,
      note,
    });
  }

  async upsertPipeline(p: Pipeline): Promise<void> {
    this.pipelines.set(p.id, { ...p });
  }

  async linkPipelineToClass(pipelineId: string, cls: AdvisoryClass): Promise<void> {
    const cid = cls.id || classId(cls.ecosystem, cls.severity_band, cls.depth_band);
    this.classes.set(cid, { ...cls, id: cid });
    if (!this.handles.some((h) => h.from === pipelineId && h.to === cid)) {
      this.handles.push({ from: pipelineId, to: cid });
    }
  }

  async recordPipelineRun(pipelineId: string, ok: boolean, latencyMs: number): Promise<void> {
    const p = this.pipelines.get(pipelineId);
    if (!p) return;
    const n = p.runs ?? 0;
    p.success_rate = (p.success_rate * n + (ok ? 1 : 0)) / (n + 1);
    p.avg_latency = (p.avg_latency * n + latencyMs) / (n + 1);
    p.runs = n + 1;
  }

  async computeBetweenness(): Promise<ChokePoint[]> {
    const names = [...this.packages.keys()];
    const outcome = brandesChokePoints(
      names,
      this.deps.map((d) => [d.from, d.to] as [string, string]),
    );
    for (const p of this.packages.values()) {
      p.betweenness = outcome.scores.get(p.name) ?? 0;
      p.is_chokepoint = outcome.chokepoints.has(p.name);
    }
    return this.chokePoints(50);
  }

  async stats(): Promise<GraphStats> {
    const nodes =
      this.packages.size +
      this.repos.size +
      this.services.size +
      this.teams.size +
      this.people.size +
      this.customers.size +
      this.contracts.size +
      this.clauses.size +
      this.advisories.size +
      this.patchAttempts.size +
      this.verdicts.size +
      this.decisions.size +
      this.incidents.size +
      this.pipelines.size +
      this.classes.size;
    const edges =
      this.deps.length +
      this.uses.length +
      this.deploys.length +
      this.calls.length +
      this.ownedBy.length +
      this.oncallEdges.length +
      this.serves.length +
      this.signed.length +
      this.hasClause.length +
      this.affects.length +
      this.patchAttempts.size + // :ON
      this.verdicts.size + // :ABOUT
      this.decisions.size + // :RESOLVED
      this.incidents.size + // :ABOUT
      this.handles.length;
    return {
      nodes,
      edges,
      advisories: this.advisories.size,
      packages: this.packages.size,
      customers: this.customers.size,
      chokepoints: [...this.packages.values()].filter((p) => p.is_chokepoint).length,
    };
  }

  // ─── the escape hatch, within reason ──────────────────────────────────────

  /**
   * A deliberately small Cypher subset: label counts, total node/edge counts,
   * and delete-by-key. Anything else returns no rows rather than throwing, so a
   * demo console pointed at the fallback degrades instead of exploding.
   */
  async query<T = Record<string, unknown>>(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    const q = cypher.replace(/\s+/g, ' ').trim();

    const labelCount = /^MATCH \(\w+:(\w+)\)(?: WHERE .+?)? RETURN count\(.+?\) AS (\w+)$/i.exec(q);
    if (labelCount) {
      const n = this.countLabel(labelCount[1]);
      return [{ [labelCount[2]]: n } as unknown as T];
    }
    const allNodes = /^MATCH \(\w*\) RETURN count\(\w*\) AS (\w+)$/i.exec(q);
    if (allNodes) {
      const s = await this.stats();
      return [{ [allNodes[1]]: s.nodes } as unknown as T];
    }
    const allEdges = /^MATCH \(\)-\[\w*\]->\(\) RETURN count\(\w*\) AS (\w+)$/i.exec(q);
    if (allEdges) {
      const s = await this.stats();
      return [{ [allEdges[1]]: s.edges } as unknown as T];
    }
    const del = /^MATCH \((\w+):(\w+) \{(\w+):\$(\w+)\}\) DETACH DELETE \1$/i.exec(q);
    if (del) {
      const key = params?.[del[4]];
      this.deleteByKey(del[2], del[3], String(key));
      return [];
    }
    if (!this.warnedCypher) {
      this.warnedCypher = true;
      process.stderr.write(
        '[hopper/graph] in-memory backend: raw Cypher is not executed, returning no rows.\n',
      );
    }
    return [];
  }

  private countLabel(label: string): number {
    switch (label) {
      case 'Package':
        return this.packages.size;
      case 'Repo':
        return this.repos.size;
      case 'Service':
        return this.services.size;
      case 'Team':
        return this.teams.size;
      case 'Person':
        return this.people.size;
      case 'Customer':
        return this.customers.size;
      case 'Contract':
        return this.contracts.size;
      case 'Clause':
        return this.clauses.size;
      case 'Advisory':
        return this.advisories.size;
      case 'PatchAttempt':
        return this.patchAttempts.size;
      case 'AgentVerdict':
        return this.verdicts.size;
      case 'Decision':
        return this.decisions.size;
      case 'Incident':
        return this.incidents.size;
      case 'Pipeline':
        return this.pipelines.size;
      case 'AdvisoryClass':
        return this.classes.size;
      default:
        return 0;
    }
  }

  private deleteByKey(label: string, prop: string, value: string): void {
    if (label === 'Pipeline' && prop === 'id') {
      this.pipelines.delete(value);
      this.handles = this.handles.filter((h) => h.from !== value);
      return;
    }
    if (label === 'Advisory' && prop === 'ghsa_id') {
      this.advisories.delete(value);
      this.affects = this.affects.filter((a) => a.ghsa_id !== value);
    }
  }
}

export type { Clause, ClauseSeed };
