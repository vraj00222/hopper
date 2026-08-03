/**
 * HOPPER — real transitive dependency ingestion from deps.dev.
 *
 *   GET https://api.deps.dev/v3alpha/systems/npm/packages/{pkg}
 *   GET https://api.deps.dev/v3alpha/systems/npm/packages/{pkg}/versions/{ver}:dependencies
 *
 * Both auth-free. The `:dependencies` response is a flat node list (each node
 * carries relation SELF | DIRECT | INDIRECT relative to the root) plus an edge
 * list of index pairs. We BFS the edge list from the SELF node to recover the
 * TRUE depth of every package, then emit (Package)-[:DEPENDS_ON {depth, relation}]
 * edges for everything within `maxDepth`.
 *
 * Raw responses are cached to fixtures/depsdev.json so MOCK=true seeds with
 * zero network. Docker dies at 8pm; the network goes with it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_ROOTS } from '@hopper/contracts';
import type { Dataset, DepEdge, PackageSeed } from '../dataset.js';
import { emptyDataset } from '../dataset.js';

export const DEPSDEV_API = 'https://api.deps.dev/v3alpha';
export const MAX_DEPTH = 5;

/**
 * What the fictional org actually has in its lockfiles.
 *
 * These are real published versions and the dependency graphs below them are
 * real deps.dev responses — we are choosing which lockfile to ingest, not
 * inventing data. Two reasons not to just take `latest`:
 *
 *  1. An enterprise monorepo is never on a package published three months ago.
 *     Resolving `latest` models a greenfield repo, which is the one kind of
 *     repo this product is useless for.
 *  2. HERO_ADVISORY covers `brace-expansion < 1.1.18`. This pin set resolves
 *     brace-expansion to 1.1.18 via minimatch@3 via glob@7, so the version on
 *     the Package node lines up with the advisory a judge can read next to it.
 *
 * Anything not pinned here falls back to the deps.dev default (latest) version.
 */
export const LOCKFILE_PINS: Record<string, string> = {
  express: '4.21.2',
  next: '14.2.15',
  webpack: '5.95.0',
  jest: '29.7.0',
  eslint: '8.57.1',
  axios: '1.7.7',
};

const here = dirname(fileURLToPath(import.meta.url));

export interface DepsDevNode {
  versionKey: { system: string; name: string; version: string };
  bundled?: boolean;
  relation: 'SELF' | 'DIRECT' | 'INDIRECT';
  errors?: string[];
}

export interface DepsDevEdge {
  fromNode?: number;
  toNode?: number;
  requirement?: string;
}

export interface DepsDevResponse {
  nodes: DepsDevNode[];
  edges: DepsDevEdge[];
  error?: string;
}

export interface DepsDevRoot {
  name: string;
  version: string;
  published_at: string | null;
  url: string;
  response: DepsDevResponse;
}

export interface DepsDevCache {
  fetched_at: string;
  api: string;
  roots: Record<string, DepsDevRoot>;
}

export function cachePath(): string {
  const candidates = [
    resolve(here, '../../../../fixtures/depsdev.json'),
    resolve(process.cwd(), 'fixtures/depsdev.json'),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return candidates[0];
}

export function loadCache(): DepsDevCache | null {
  const p = cachePath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as DepsDevCache;
  } catch (err) {
    throw new Error(
      `fixtures/depsdev.json is unreadable (${err instanceof Error ? err.message : String(err)}). ` +
        `Delete it and re-run: MOCK=false npx tsx packages/graph/src/cli/seed.ts`,
    );
  }
}

export function writeCache(cache: DepsDevCache): string {
  const p = resolve(here, '../../../../fixtures/depsdev.json');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  return p;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'hopper/1.0 (+graph-seeder)' },
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

interface VersionsReply {
  versions: Array<{
    versionKey: { name: string; version: string };
    publishedAt?: string;
    isDefault?: boolean;
    isDeprecated?: boolean;
  }>;
}

/**
 * The pinned lockfile version if we have one, otherwise the version deps.dev
 * calls default (what `npm i pkg` resolves to today). Either way we go to the
 * API for the published_at so the cache records provenance.
 */
export async function resolveVersion(
  pkg: string,
): Promise<{ version: string; published_at: string | null }> {
  const reply = await getJson<VersionsReply>(
    `${DEPSDEV_API}/systems/npm/packages/${encodeURIComponent(pkg)}`,
  );
  const pin = LOCKFILE_PINS[pkg];
  if (pin) {
    const hit = reply.versions.find((v) => v.versionKey.version === pin);
    if (hit) return { version: pin, published_at: hit.publishedAt ?? null };
  }
  const usable = reply.versions.filter((v) => !v.isDeprecated);
  const chosen =
    usable.find((v) => v.isDefault) ??
    reply.versions.find((v) => v.isDefault) ??
    usable[usable.length - 1] ??
    reply.versions[reply.versions.length - 1];
  if (!chosen) throw new Error(`deps.dev knows no versions for npm/${pkg}`);
  return { version: chosen.versionKey.version, published_at: chosen.publishedAt ?? null };
}

export async function fetchRoot(pkg: string): Promise<DepsDevRoot> {
  const { version, published_at } = await resolveVersion(pkg);
  const url =
    `${DEPSDEV_API}/systems/npm/packages/${encodeURIComponent(pkg)}` +
    `/versions/${encodeURIComponent(version)}:dependencies`;
  const response = await getJson<DepsDevResponse>(url);
  if (!Array.isArray(response.nodes) || response.nodes.length === 0) {
    throw new Error(`deps.dev returned no dependency nodes for ${pkg}@${version}`);
  }
  return { name: pkg, version, published_at, url, response };
}

/** hit the network for every SEED_ROOT and rewrite fixtures/depsdev.json */
export async function refreshCache(
  roots: readonly string[] = SEED_ROOTS,
  log: (m: string) => void = () => undefined,
): Promise<DepsDevCache> {
  const cache: DepsDevCache = { fetched_at: new Date().toISOString(), api: DEPSDEV_API, roots: {} };
  for (const pkg of roots) {
    const root = await fetchRoot(pkg);
    cache.roots[pkg] = root;
    log(
      `  deps.dev ${pkg}@${root.version} — ${root.response.nodes.length} nodes, ` +
        `${root.response.edges?.length ?? 0} edges`,
    );
  }
  const p = writeCache(cache);
  log(`  cached -> ${p}`);
  return cache;
}

/** BFS the deps.dev edge list from the SELF node to get true depth per index */
export function depthsFrom(res: DepsDevResponse): Map<number, number> {
  const adj = new Map<number, number[]>();
  for (const e of res.edges ?? []) {
    const from = e.fromNode ?? 0;
    const to = e.toNode ?? 0;
    const list = adj.get(from);
    if (list) list.push(to);
    else adj.set(from, [to]);
  }
  const selfIdx = res.nodes.findIndex((n) => n.relation === 'SELF');
  const start = selfIdx >= 0 ? selfIdx : 0;
  const depth = new Map<number, number>([[start, 0]]);
  const queue: number[] = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head];
    const d = depth.get(cur) ?? 0;
    for (const nxt of adj.get(cur) ?? []) {
      if (!depth.has(nxt)) {
        depth.set(nxt, d + 1);
        queue.push(nxt);
      }
    }
  }
  return depth;
}

export interface DepsDatasetSummary {
  roots: Array<{ name: string; version: string; nodes: number; edges: number }>;
  fetched_at: string;
}

export function buildDepsDataset(
  cache: DepsDevCache,
  maxDepth = MAX_DEPTH,
): { dataset: Dataset; summary: DepsDatasetSummary } {
  const ds = emptyDataset();
  const pkgs = new Map<string, PackageSeed>();
  const deps = new Map<string, DepEdge>();
  const summary: DepsDatasetSummary = { roots: [], fetched_at: cache.fetched_at };

  for (const root of Object.values(cache.roots)) {
    const res = root.response;
    const depth = depthsFrom(res);
    let kept = 0;

    res.nodes.forEach((n, i) => {
      const d = depth.get(i);
      if (d === undefined || d > maxDepth) return;
      const name = n.versionKey.name;
      const prev = pkgs.get(name);
      if (!prev) pkgs.set(name, { name, ecosystem: 'npm', version: n.versionKey.version });
      else if (!prev.version) prev.version = n.versionKey.version;
    });

    for (const e of res.edges ?? []) {
      const fi = e.fromNode ?? 0;
      const ti = e.toNode ?? 0;
      const fd = depth.get(fi);
      const td = depth.get(ti);
      if (fd === undefined || td === undefined) continue;
      if (fd > maxDepth || td > maxDepth) continue;
      const from = res.nodes[fi]?.versionKey.name;
      const to = res.nodes[ti]?.versionKey.name;
      if (!from || !to || from === to) continue;
      const relation = res.nodes[ti]?.relation ?? 'INDIRECT';
      const k = `${from} ${to}`;
      const prev = deps.get(k);
      if (!prev || td < prev.depth) deps.set(k, { from, to, depth: td, relation });
      kept += 1;
    }

    summary.roots.push({
      name: root.name,
      version: root.version,
      nodes: res.nodes.length,
      edges: kept,
    });
  }

  ds.packages = [...pkgs.values()];
  ds.deps = [...deps.values()];
  return { dataset: ds, summary };
}

export interface DepsSeedOptions {
  /** true = never touch the network, cache only */
  offline: boolean;
  maxDepth?: number;
  log?: (m: string) => void;
}

export async function depsdevDataset(
  opts: DepsSeedOptions,
): Promise<{ dataset: Dataset; summary: DepsDatasetSummary }> {
  const log = opts.log ?? (() => undefined);
  let cache = loadCache();
  if (!cache && opts.offline) {
    throw new Error(
      'fixtures/depsdev.json is missing and this run is offline (MOCK=true).\n' +
        'Run the seeder online once to build the cache:\n' +
        '  MOCK=false npx tsx packages/graph/src/cli/seed.ts --reset',
    );
  }
  if (!cache) {
    log('  fixtures/depsdev.json missing — fetching from deps.dev');
    cache = await refreshCache(SEED_ROOTS, log);
  } else if (!opts.offline) {
    log('  refreshing fixtures/depsdev.json from deps.dev');
    cache = await refreshCache(SEED_ROOTS, log);
  }
  const missing = SEED_ROOTS.filter((r) => !cache!.roots[r]);
  if (missing.length) {
    throw new Error(
      `fixtures/depsdev.json is missing roots [${missing.join(', ')}].\n` +
        'Rebuild it online: MOCK=false npx tsx packages/graph/src/cli/seed.ts --reset',
    );
  }
  return buildDepsDataset(cache, opts.maxDepth ?? MAX_DEPTH);
}
