/**
 * HOPPER — one seed, either backend.
 *
 * real (deps.dev transitive closure)  +  overlay (repos → customers → clauses)
 * +  the three demo advisories  →  ingest  →  betweenness.
 */
import { isMock } from '@hopper/contracts';
import type { GraphPort } from '@hopper/contracts';
import { mergeDatasets, type Dataset } from '../dataset.js';
import { advisoryDataset } from './advisories.js';
import { depsdevDataset, type DepsDatasetSummary } from './depsdev.js';
import { syntheticDataset } from './synthetic.js';

/** both backends implement this; it is not part of the frozen GraphPort */
export interface Ingestable {
  ingest(ds: Dataset): Promise<void>;
}

export interface SeedOptions {
  /** wipe the graph first */
  reset?: boolean;
  /** never touch the network — cache only. Defaults to isMock(). */
  offline?: boolean;
  maxDepth?: number;
  quiet?: boolean;
  log?: (m: string) => void;
}

export interface SeedSummary {
  packages: number;
  depEdges: number;
  repos: number;
  services: number;
  customers: number;
  contracts: number;
  clauses: number;
  advisories: number;
  patchAttempts: number;
  chokepoints: number;
  roots: DepsDatasetSummary['roots'];
  cache_fetched_at: string;
  elapsed_ms: number;
}

export function isIngestable(g: unknown): g is Ingestable {
  return typeof (g as Ingestable)?.ingest === 'function';
}

/** build the full dataset without touching a graph — used by tests and the CLI */
export async function buildDataset(
  opts: SeedOptions = {},
): Promise<{ dataset: Dataset; deps: DepsDatasetSummary }> {
  const offline = opts.offline ?? isMock();
  const log = opts.quiet ? () => undefined : opts.log ?? ((m: string) => process.stdout.write(`${m}\n`));
  const { dataset: real, summary } = await depsdevDataset({
    offline,
    maxDepth: opts.maxDepth,
    log,
  });
  const dataset = mergeDatasets(real, syntheticDataset(), advisoryDataset());
  return { dataset, deps: summary };
}

export async function seedAll(g: GraphPort, opts: SeedOptions = {}): Promise<SeedSummary> {
  const started = Date.now();
  const log = opts.quiet ? () => undefined : opts.log ?? ((m: string) => process.stdout.write(`${m}\n`));
  if (!isIngestable(g)) {
    throw new Error('seedAll: this GraphPort implementation cannot ingest a dataset');
  }
  if (opts.reset) {
    await g.reset();
    log('  reset');
  }
  const { dataset, deps } = await buildDataset({ ...opts, log });
  await g.ingest(dataset);
  log(
    `  ingested ${dataset.packages.length} packages, ${dataset.deps.length} DEPENDS_ON, ` +
      `${dataset.uses.length} USES`,
  );
  const chokepoints = await g.computeBetweenness();
  log(`  betweenness computed — ${chokepoints.filter((c) => c.is_chokepoint).length} choke points`);

  return {
    packages: dataset.packages.length,
    depEdges: dataset.deps.length,
    repos: dataset.repos.length,
    services: dataset.services.length,
    customers: dataset.customers.length,
    contracts: dataset.contracts.length,
    clauses: dataset.clauses.length,
    advisories: dataset.advisories.length,
    patchAttempts: dataset.patchAttempts.length,
    chokepoints: chokepoints.filter((c) => c.is_chokepoint).length,
    roots: deps.roots,
    cache_fetched_at: deps.fetched_at,
    elapsed_ms: Date.now() - started,
  };
}

export { advisoryDataset, syntheticDataset };
export * from './depsdev.js';
