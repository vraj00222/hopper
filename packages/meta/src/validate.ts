/**
 * Structural validation for portable pipeline JSON.
 *
 * A spec that lives in the graph is data we did not write by hand at run time —
 * it arrives as a string on a Pipeline node. So it gets checked before anything
 * executes it: entry resolves, every edge target exists, and every op is one the
 * RocketRide runtime actually registers.
 */
import type { PipelineNodeKind, PipelineSpec } from '@hopper/contracts';

/** the exact handler names @hopper/orchestrate registers. Nothing else runs. */
export const OPS = [
  'traverse.reachability',
  'traverse.deployment',
  'traverse.obligation',
  'traverse.precedent',
  'traverse.ownership',
  'branch.suppress',
  'agent.dispatch',
  'tool.open_pr',
  'tool.page_oncall',
  'tool.notify_customer',
  'tool.open_ticket',
  'writeback.graph',
] as const;

export type Op = (typeof OPS)[number];

/** an op implies its node kind; a mismatch means the spec lies about itself */
export const OP_KIND: Record<Op, PipelineNodeKind> = {
  'traverse.reachability': 'cypher',
  'traverse.deployment': 'cypher',
  'traverse.obligation': 'cypher',
  'traverse.precedent': 'cypher',
  'traverse.ownership': 'cypher',
  'branch.suppress': 'branch',
  'agent.dispatch': 'agent',
  'tool.open_pr': 'tool',
  'tool.page_oncall': 'tool',
  'tool.notify_customer': 'tool',
  'tool.open_ticket': 'tool',
  'writeback.graph': 'writeback',
};

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function isOp(op: string): op is Op {
  return (OPS as readonly string[]).includes(op);
}

export function validateSpec(spec: unknown): ValidationResult {
  const errors: string[] = [];
  const s = spec as PipelineSpec | null;

  if (!s || typeof s !== 'object') return { ok: false, errors: ['spec is not an object'] };
  for (const f of ['id', 'name', 'version', 'description', 'entry'] as const) {
    if (typeof s[f] !== 'string' || s[f].length === 0) errors.push(`missing/empty field "${f}"`);
  }
  if (!Array.isArray(s.nodes) || s.nodes.length === 0) {
    errors.push('nodes[] is missing or empty');
    return { ok: false, errors };
  }

  const ids = new Set<string>();
  for (const n of s.nodes) {
    if (typeof n?.id !== 'string' || n.id.length === 0) {
      errors.push('a node has no id');
      continue;
    }
    if (ids.has(n.id)) errors.push(`duplicate node id "${n.id}"`);
    ids.add(n.id);
    if (typeof n.op !== 'string' || !isOp(n.op)) {
      errors.push(`node "${n.id}" has unknown op "${String(n.op)}"`);
    } else if (OP_KIND[n.op] !== n.kind) {
      errors.push(`node "${n.id}" op ${n.op} implies kind "${OP_KIND[n.op]}", spec says "${String(n.kind)}"`);
    }
  }

  if (!ids.has(s.entry)) errors.push(`entry "${s.entry}" does not resolve to a node`);

  for (const n of s.nodes) {
    for (const t of n.next ?? []) {
      if (!ids.has(t)) errors.push(`node "${n.id}".next -> "${t}" does not resolve`);
    }
    for (const b of n.branches ?? []) {
      if (typeof b?.when !== 'string' || b.when.length === 0) {
        errors.push(`node "${n.id}" has a branch with no "when"`);
      }
      if (!ids.has(b?.to)) errors.push(`node "${n.id}".branches -> "${String(b?.to)}" does not resolve`);
    }
    if (n.kind === 'branch' && (n.branches ?? []).length === 0) {
      errors.push(`branch node "${n.id}" has no branches[]`);
    }
  }

  // every node must be reachable from entry, or it is dead weight in the graph
  const seen = new Set<string>();
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const stack = [s.entry];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const n = byId.get(cur);
    if (!n) continue;
    for (const t of n.next ?? []) stack.push(t);
    for (const b of n.branches ?? []) stack.push(b.to);
  }
  for (const n of s.nodes) {
    if (!seen.has(n.id)) errors.push(`node "${n.id}" is unreachable from entry`);
  }

  // at least one terminal node, otherwise the runtime never stops
  const terminal = s.nodes.filter((n) => (n.next ?? []).length === 0 && (n.branches ?? []).length === 0);
  if (terminal.length === 0) errors.push('no terminal node - the pipeline never ends');

  if (s.handles !== undefined && !Array.isArray(s.handles)) errors.push('handles must be an array when present');

  return { ok: errors.length === 0, errors };
}
