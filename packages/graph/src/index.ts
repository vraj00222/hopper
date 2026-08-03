/**
 * HOPPER — @hopper/graph.
 *
 *   const g = createGraph();          // FalkorDB if it answers, memory if not
 *   const g = createGraph({ memory: true });
 *
 * The returned object is a GraphPort. It picks its backend on connect(): the
 * FalkorDB driver if localhost:6379 answers within a second, otherwise the
 * in-memory store. Both pass the same gate, so a dead container costs the demo
 * nothing but the browser UI on :3000.
 */
import type { GraphPort } from '@hopper/contracts';
import { DEFAULT_GRAPH, DEFAULT_URL, falkorReachable } from './client.js';
import type { Dataset } from './dataset.js';
import { FalkorGraph } from './falkor.js';
import { MemoryGraph } from './memory.js';

export type Backend = 'falkordb' | 'memory';

export interface CreateGraphOptions {
  url?: string;
  graph?: string;
  memory?: boolean;
  /** how long to wait for FalkorDB before falling back */
  connectTimeoutMs?: number;
  onFallback?: (reason: string) => void;
}

interface BackendImpl extends GraphPort {
  backend(): Backend;
  ingest(ds: Dataset): Promise<void>;
}

/**
 * A GraphPort that resolves its backend lazily. Every method funnels through
 * `impl()`, so callers can use it before connect() and still get the right one.
 */
class HopperGraph implements GraphPort {
  private chosen: BackendImpl | null = null;
  private pending: Promise<BackendImpl> | null = null;

  constructor(private readonly opts: CreateGraphOptions) {}

  backend(): Backend | 'unresolved' {
    return this.chosen ? this.chosen.backend() : 'unresolved';
  }

  private async resolve(): Promise<BackendImpl> {
    if (this.chosen) return this.chosen;
    if (this.pending) return this.pending;
    this.pending = (async (): Promise<BackendImpl> => {
      if (this.opts.memory) {
        const m = new MemoryGraph();
        await m.connect();
        this.chosen = m;
        return m;
      }
      const clientOpts = {
        url: this.opts.url ?? DEFAULT_URL,
        graph: this.opts.graph ?? DEFAULT_GRAPH,
        connectTimeoutMs: this.opts.connectTimeoutMs,
      };
      if (await falkorReachable(clientOpts)) {
        const f = new FalkorGraph(clientOpts);
        try {
          await f.connect();
          this.chosen = f;
          return f;
        } catch (err) {
          await f.close().catch(() => undefined);
          this.opts.onFallback?.(
            `FalkorDB connect failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        this.opts.onFallback?.(
          `FalkorDB unreachable at ${clientOpts.url} — using the in-memory backend`,
        );
      }
      const m = new MemoryGraph();
      await m.connect();
      this.chosen = m;
      return m;
    })();
    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }

  private async impl(): Promise<BackendImpl> {
    return this.chosen ?? this.resolve();
  }

  async connect(): Promise<void> {
    await this.resolve();
  }

  async close(): Promise<void> {
    const c = this.chosen;
    this.chosen = null;
    if (c) await c.close();
  }

  async ingest(ds: Dataset): Promise<void> {
    return (await this.impl()).ingest(ds);
  }

  async query<T = Record<string, unknown>>(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    return (await this.impl()).query<T>(cypher, params);
  }

  async hopPaths(...a: Parameters<GraphPort['hopPaths']>) {
    return (await this.impl()).hopPaths(...a);
  }
  async proveAbsence(...a: Parameters<GraphPort['proveAbsence']>) {
    return (await this.impl()).proveAbsence(...a);
  }
  async precedent(...a: Parameters<GraphPort['precedent']>) {
    return (await this.impl()).precedent(...a);
  }
  async chokePoints(...a: Parameters<GraphPort['chokePoints']>) {
    return (await this.impl()).chokePoints(...a);
  }
  async whoToWake(...a: Parameters<GraphPort['whoToWake']>) {
    return (await this.impl()).whoToWake(...a);
  }
  async auditTrail(...a: Parameters<GraphPort['auditTrail']>) {
    return (await this.impl()).auditTrail(...a);
  }
  async selectPipeline(...a: Parameters<GraphPort['selectPipeline']>) {
    return (await this.impl()).selectPipeline(...a);
  }
  async upsertAdvisory(...a: Parameters<GraphPort['upsertAdvisory']>) {
    return (await this.impl()).upsertAdvisory(...a);
  }
  async recordVerdict(...a: Parameters<GraphPort['recordVerdict']>) {
    return (await this.impl()).recordVerdict(...a);
  }
  async recordDecision(...a: Parameters<GraphPort['recordDecision']>) {
    return (await this.impl()).recordDecision(...a);
  }
  async recordPatchAttempt(...a: Parameters<GraphPort['recordPatchAttempt']>) {
    return (await this.impl()).recordPatchAttempt(...a);
  }
  async recordObservation(...a: Parameters<GraphPort['recordObservation']>) {
    return (await this.impl()).recordObservation(...a);
  }
  async upsertPipeline(...a: Parameters<GraphPort['upsertPipeline']>) {
    return (await this.impl()).upsertPipeline(...a);
  }
  async linkPipelineToClass(...a: Parameters<GraphPort['linkPipelineToClass']>) {
    return (await this.impl()).linkPipelineToClass(...a);
  }
  async recordPipelineRun(...a: Parameters<GraphPort['recordPipelineRun']>) {
    return (await this.impl()).recordPipelineRun(...a);
  }
  async applySchema(): Promise<void> {
    return (await this.impl()).applySchema();
  }
  async computeBetweenness(...a: Parameters<GraphPort['computeBetweenness']>) {
    return (await this.impl()).computeBetweenness(...a);
  }
  async stats(...a: Parameters<GraphPort['stats']>) {
    return (await this.impl()).stats(...a);
  }
  async reset(...a: Parameters<GraphPort['reset']>) {
    return (await this.impl()).reset(...a);
  }
  async knownAt(...a: Parameters<GraphPort['knownAt']>) {
    return (await this.impl()).knownAt(...a);
  }
}

export function createGraph(opts: CreateGraphOptions = {}): GraphPort {
  return new HopperGraph(opts);
}

/** which backend a createGraph() handle settled on ('unresolved' before connect) */
export function graphBackend(g: GraphPort): Backend | 'unresolved' {
  const b = (g as { backend?: () => Backend | 'unresolved' }).backend;
  return typeof b === 'function' ? b.call(g) : 'unresolved';
}

export { FalkorGraph } from './falkor.js';
export { MemoryGraph } from './memory.js';
export { DEFAULT_GRAPH, DEFAULT_URL, falkorReachable, parseUrl } from './client.js';
export { readSchema, schemaPath, schemaStatements } from './schema.js';
export { brandes, computeBetweenness, toChokePoints } from './betweenness.js';
export type { Dataset, DepEdge, PackageSeed, UsesEdge } from './dataset.js';
export { buildDataset, seedAll, type SeedOptions, type SeedSummary } from './seed/index.js';
export {
  LOCKFILE_PINS,
  cachePath as depsdevCachePath,
  refreshCache as refreshDepsdevCache,
} from './seed/depsdev.js';
export { HERO_REPO, HERO_TEAM, HERO_CONTRACT_ID } from './seed/synthetic.js';
export { MAX_HOPS } from './queries.js';
