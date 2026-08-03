/**
 * HOPPER — betweenness centrality over the DEPENDS_ON graph (Brandes, 2001).
 *
 * A choke point is a package that sits on a disproportionate number of the
 * shortest supply-chain routes between other packages. brace-expansion is the
 * canonical one: nobody installs it, it is the only way from minimatch to
 * balanced-match / concat-map, and half the JS build ecosystem walks through it.
 *
 * Plain TypeScript over an edge list — no graph-algo dependency, ~O(V·E), and
 * the whole seeded graph is a few hundred nodes, so it runs in milliseconds.
 */
import type { ChokePoint } from '@hopper/contracts';

export interface BetweennessOptions {
  /**
   * A package is a choke point when its normalised betweenness is at or above
   * this quantile of the NON-ZERO scores. Most packages in a dependency closure
   * are leaves and score exactly zero, so 0.70 of the non-zero tail is roughly
   * the top 13% of all packages — brace-expansion sits at ~rank 41 of 445 in
   * the seeded closure, comfortably inside.
   */
  quantile?: number;
  /** never flag more than this many, however the distribution falls */
  maxChokePoints?: number;
  /** always flag at least this many (if that many have non-zero scores) */
  minChokePoints?: number;
}

export interface BetweennessOutcome {
  /** package name -> normalised betweenness in [0,1] */
  scores: Map<string, number>;
  /** package name -> direct in-degree over DEPENDS_ON */
  dependents: Map<string, number>;
  chokepoints: Set<string>;
  threshold: number;
}

/**
 * Brandes' algorithm, directed, unweighted.
 * Returns raw (unnormalised) pair-dependency sums.
 */
export function brandes(
  nodes: readonly string[],
  edges: ReadonlyArray<readonly [string, string]>,
): Map<string, number> {
  const n = nodes.length;
  const index = new Map<string, number>();
  nodes.forEach((name, i) => index.set(name, i));

  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [from, to] of edges) {
    const f = index.get(from);
    const t = index.get(to);
    if (f === undefined || t === undefined || f === t) continue;
    adj[f].push(t);
  }

  const cb = new Float64Array(n);
  const sigma = new Float64Array(n);
  const delta = new Float64Array(n);
  const dist = new Int32Array(n);
  const queue = new Int32Array(n);
  const stack = new Int32Array(n);
  const preds: number[][] = Array.from({ length: n }, () => []);

  for (let s = 0; s < n; s += 1) {
    sigma.fill(0);
    delta.fill(0);
    dist.fill(-1);
    for (let i = 0; i < n; i += 1) preds[i].length = 0;

    sigma[s] = 1;
    dist[s] = 0;
    let qHead = 0;
    let qTail = 0;
    let sTop = 0;
    queue[qTail++] = s;

    while (qHead < qTail) {
      const v = queue[qHead++];
      stack[sTop++] = v;
      const dv = dist[v];
      for (const w of adj[v]) {
        if (dist[w] < 0) {
          dist[w] = dv + 1;
          queue[qTail++] = w;
        }
        if (dist[w] === dv + 1) {
          sigma[w] += sigma[v];
          preds[w].push(v);
        }
      }
    }

    while (sTop > 0) {
      const w = stack[--sTop];
      const coeff = (1 + delta[w]) / sigma[w];
      for (const v of preds[w]) delta[v] += sigma[v] * coeff;
      if (w !== s) cb[w] += delta[w];
    }
  }

  const out = new Map<string, number>();
  nodes.forEach((name, i) => out.set(name, cb[i]));
  return out;
}

function quantileOf(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

export function computeBetweenness(
  nodes: readonly string[],
  edges: ReadonlyArray<readonly [string, string]>,
  opts: BetweennessOptions = {},
): BetweennessOutcome {
  const quantile = opts.quantile ?? 0.7;
  const maxChokePoints = opts.maxChokePoints ?? 60;
  const minChokePoints = opts.minChokePoints ?? 8;

  const raw = brandes(nodes, edges);
  const n = nodes.length;
  // directed normalisation: (n-1)(n-2) ordered pairs excluding the node itself
  const denom = n > 2 ? (n - 1) * (n - 2) : 1;

  const scores = new Map<string, number>();
  for (const [name, v] of raw) scores.set(name, v / denom);

  const dependents = new Map<string, number>();
  for (const name of nodes) dependents.set(name, 0);
  for (const [, to] of edges) dependents.set(to, (dependents.get(to) ?? 0) + 1);

  const nonZero = [...scores.values()].filter((v) => v > 0).sort((a, b) => a - b);
  const threshold = quantileOf(nonZero, quantile);

  const ranked = [...scores.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  const chokepoints = new Set<string>();
  for (const [name, v] of ranked) {
    if (chokepoints.size >= maxChokePoints) break;
    if (v >= threshold || chokepoints.size < minChokePoints) chokepoints.add(name);
  }

  return { scores, dependents, chokepoints, threshold };
}

export function toChokePoints(
  outcome: BetweennessOutcome,
  limit = 20,
): ChokePoint[] {
  return [...outcome.scores.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, betweenness]) => ({
      package: name,
      betweenness,
      dependents: outcome.dependents.get(name) ?? 0,
      is_chokepoint: outcome.chokepoints.has(name),
    }));
}
