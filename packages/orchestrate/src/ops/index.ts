/**
 * The op registry. A .pipe node names an `op`; the runtime looks it up here.
 * Registration is the whole extension point — a new node type is a new entry,
 * not a change to the runtime.
 */
import type { OpHandler } from './types.js';
import { TRAVERSE_OPS, estimateTokens } from './traverse.js';

export type OpRegistry = Map<string, OpHandler>;

export function createRegistry(extra?: Record<string, OpHandler>): OpRegistry {
  const m: OpRegistry = new Map(Object.entries(TRAVERSE_OPS));
  for (const [name, fn] of Object.entries(extra ?? {})) m.set(name, fn);
  return m;
}

export function opNames(registry?: OpRegistry): string[] {
  return [...(registry ?? createRegistry()).keys()].sort();
}

export { TRAVERSE_OPS, estimateTokens };
export type { OpHandler };
export type { OpResult, RunState, DeploymentFacts, ObligationFacts } from './types.js';
