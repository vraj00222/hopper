/**
 * The tiny branch-condition language used by `PipelineNodeSpec.branches[].when`.
 *
 * Grammar (deliberately minuscule — a .pipe file is data, and data does not get
 * to run code):
 *
 *   when      := disjunction | 'else' | 'default' | '*'
 *   disjunction := conjunction ('||' conjunction)*
 *   conjunction := comparison ('&&' comparison)*
 *   comparison  := ident | '!' ident | ident OP literal
 *   OP        := '==' | '!=' | '>=' | '<=' | '>' | '<'
 *   literal   := number | true | false | null | 'string' | "string" | bareword
 *
 * There is no eval, no Function constructor, no property access, no calls.
 * Identifiers resolve against the run's scalar variable bag and nothing else.
 */
import { PipelineSpecError } from './errors.js';

export type Scalar = string | number | boolean | null | undefined;
export type Vars = Record<string, Scalar>;

const COMPARISON = /^([A-Za-z_][A-Za-z0-9_.]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/;
const IDENT = /^!?\s*[A-Za-z_][A-Za-z0-9_.]*$/;
const ELSE = new Set(['else', 'default', '*', 'otherwise', 'true']);

/** `else` and friends — the fallthrough edge of a branch node. */
export function isElse(expr: string): boolean {
  return ELSE.has(expr.trim().toLowerCase());
}

function stripOuterParens(s: string): string {
  let out = s.trim();
  while (out.startsWith('(') && out.endsWith(')')) {
    // only strip if the parens actually wrap the whole expression
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < out.length; i += 1) {
      if (out[i] === '(') depth += 1;
      else if (out[i] === ')') {
        depth -= 1;
        if (depth === 0 && i < out.length - 1) wraps = false;
      }
    }
    if (!wraps || depth !== 0) break;
    out = out.slice(1, -1).trim();
  }
  return out;
}

/** split on a top-level operator, respecting parens and quotes */
function splitTop(s: string, op: '||' | '&&'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (depth === 0 && c === op[0] && s[i + 1] === op[1]) {
      parts.push(s.slice(start, i));
      i += 1;
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function literal(raw: string): Scalar {
  const t = raw.trim();
  if (
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2) ||
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2)
  ) {
    return t.slice(1, -1);
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (t === 'undefined') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t; // bare word — compared as a string
}

function truthy(v: Scalar): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0 && v !== 'false' && v !== '0';
  return v;
}

function compare(left: Scalar, op: string, right: Scalar): boolean {
  // numeric comparison when both sides look numeric
  const ln = typeof left === 'number' ? left : Number(left);
  const rn = typeof right === 'number' ? right : Number(right);
  const numeric =
    left !== null &&
    left !== undefined &&
    left !== '' &&
    right !== null &&
    right !== undefined &&
    right !== '' &&
    Number.isFinite(ln) &&
    Number.isFinite(rn);

  switch (op) {
    case '==':
      return numeric ? ln === rn : String(left) === String(right) || left === right;
    case '!=':
      return !(numeric ? ln === rn : String(left) === String(right) || left === right);
    case '>':
      return numeric && ln > rn;
    case '>=':
      return numeric && ln >= rn;
    case '<':
      return numeric && ln < rn;
    case '<=':
      return numeric && ln <= rn;
    default:
      throw new PipelineSpecError(`unsupported comparison operator '${op}'`);
  }
}

function evalComparison(expr: string, vars: Vars): boolean {
  const s = stripOuterParens(expr);
  const m = COMPARISON.exec(s);
  if (m) {
    const [, name, op, rhsRaw] = m;
    return compare(vars[name], op, literal(rhsRaw));
  }
  if (IDENT.test(s)) {
    const negated = s.startsWith('!');
    const name = s.replace(/^!\s*/, '');
    const v = truthy(vars[name]);
    return negated ? !v : v;
  }
  throw new PipelineSpecError(`cannot parse branch condition '${expr}'`);
}

/** Evaluate a `when` expression against the run's scalar bag. Never runs code. */
export function evaluate(expr: string, vars: Vars): boolean {
  if (isElse(expr)) return true;
  const s = stripOuterParens(expr);
  const ors = splitTop(s, '||');
  if (ors.length > 1) return ors.some((o) => evaluate(o, vars));
  const ands = splitTop(s, '&&');
  if (ands.length > 1) return ands.every((a) => evaluate(a, vars));
  return evalComparison(s, vars);
}

/** Parse-check a condition at spec-load time so typos fail loudly, not silently. */
export function validateExpression(expr: string, nodeId: string): void {
  if (typeof expr !== 'string' || expr.trim().length === 0) {
    throw new PipelineSpecError(`node '${nodeId}': branch condition is empty`, nodeId);
  }
  try {
    evaluate(expr, {});
  } catch (e) {
    throw new PipelineSpecError(
      `node '${nodeId}': ${(e as Error).message}`,
      nodeId,
    );
  }
}
