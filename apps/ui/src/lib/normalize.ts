/**
 * Defensive intake.
 *
 * Real server payloads are not always the flat contract shape: FalkorDB rows
 * come back as `{ id, labels, properties }` node envelopes, and at least one
 * server path forwards `focus.advisory` in that form. The UI is the last thing
 * standing between that and a blank screen on stage, so every inbound message
 * is unwrapped here before it reaches the reducer.
 *
 * This is intentionally forgiving. It never throws, and a payload that is
 * already correct passes through untouched.
 */

interface GraphNode {
  id: unknown;
  labels: unknown;
  properties: Record<string, unknown>;
}

/** a FalkorDB node envelope, as opposed to a plain contract object */
export function isGraphNode(v: unknown): v is GraphNode {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    'properties' in o &&
    'labels' in o &&
    o.properties !== null &&
    typeof o.properties === 'object' &&
    !Array.isArray(o.properties)
  );
}

/**
 * Recursively replace node envelopes with their properties. Depth-capped so a
 * cyclic or pathological payload can never hang the render loop.
 */
export function deepUnwrap<T>(value: T, depth = 0): T {
  if (depth > 12) return value;
  if (Array.isArray(value)) {
    return value.map((v) => deepUnwrap(v, depth + 1)) as unknown as T;
  }
  if (value === null || typeof value !== 'object') return value;

  const source = isGraphNode(value) ? (value as GraphNode).properties : (value as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) out[k] = deepUnwrap(v, depth + 1);
  return out as unknown as T;
}

/** numbers that arrived as strings, or not at all */
export function num(v: unknown, fallback = Number.NaN): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/** an array, whatever the server felt like sending */
export function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
