/**
 * Strict runtime validators for the four agent output schemas in
 * contracts/src/events.ts.
 *
 * Strict means: every required field present, correctly typed, no unknown keys,
 * enums closed, confidences inside [0,1], ISO timestamps parseable. Both the
 * deterministic path and the model path go through these before anything is
 * returned, published, or written to the graph. A half-shaped verdict never
 * leaves this package: we repair what is mechanically repairable and throw
 * loudly otherwise.
 */
import type {
  ActionKind,
  AgentName,
  ArbiterVerdict,
  ObligationVerdict,
  PatchVerdict,
  ReachabilityVerdict,
} from '@hopper/contracts';

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export const AGENT_NAMES: AgentName[] = [
  'reachability',
  'patch-engineer',
  'obligation-officer',
  'arbiter',
];
export const ACTION_KINDS: ActionKind[] = [
  'open_pr',
  'page_oncall',
  'notify_customer',
  'open_ticket',
];
const BREAKING_RISKS = ['none', 'low', 'medium', 'high'] as const;
const DECISIONS = ['auto', 'human', 'suppress'] as const;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

// ─── primitives ─────────────────────────────────────────────────────────────

const isStr = (v: unknown): v is string => typeof v === 'string';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isConfidence = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isIso = (v: unknown): v is string => isStr(v) && ISO.test(v) && !Number.isNaN(Date.parse(v));
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function check(
  raw: unknown,
  keys: string[],
  rules: Array<[string, boolean, string]>,
): ValidationResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['not an object'] };
  const extra = Object.keys(raw).filter((k) => !keys.includes(k));
  if (extra.length) errors.push(`unknown key(s): ${extra.join(', ')}`);
  for (const [field, ok, expected] of rules) if (!ok) errors.push(`${field}: expected ${expected}`);
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ─── the four schemas ───────────────────────────────────────────────────────

export function validateReachability(raw: unknown): ValidationResult {
  const v = raw as Partial<ReachabilityVerdict>;
  return check(
    raw,
    ['agent', 'reachable', 'confidence', 'call_path', 'telemetry_hits', 'rationale'],
    [
      ['agent', v?.agent === 'reachability', "'reachability'"],
      ['reachable', isBool(v?.reachable), 'boolean'],
      ['confidence', isConfidence(v?.confidence), 'number in [0,1]'],
      ['call_path', isStrArray(v?.call_path), 'string[]'],
      ['telemetry_hits', isCount(v?.telemetry_hits), 'non-negative integer'],
      ['rationale', isStr(v?.rationale) && v.rationale.trim().length > 0, 'non-empty string'],
    ],
  );
}

export function validatePatch(raw: unknown): ValidationResult {
  const v = raw as Partial<PatchVerdict>;
  return check(
    raw,
    ['agent', 'safe_bump', 'target', 'breaking_risk', 'confidence', 'precedent_ids', 'rationale'],
    [
      ['agent', v?.agent === 'patch-engineer', "'patch-engineer'"],
      ['safe_bump', isBool(v?.safe_bump), 'boolean'],
      ['target', v?.target === null || isStr(v?.target), 'string | null'],
      [
        'breaking_risk',
        BREAKING_RISKS.includes(v?.breaking_risk as (typeof BREAKING_RISKS)[number]),
        BREAKING_RISKS.join(' | '),
      ],
      ['confidence', isConfidence(v?.confidence), 'number in [0,1]'],
      ['precedent_ids', isStrArray(v?.precedent_ids), 'string[]'],
      ['rationale', isStr(v?.rationale) && v.rationale.trim().length > 0, 'non-empty string'],
    ],
  );
}

export function validateObligation(raw: unknown): ValidationResult {
  const v = raw as Partial<ObligationVerdict>;
  const clausesOk =
    Array.isArray(v?.clauses) &&
    v.clauses.every(
      (c) =>
        isObj(c) &&
        Object.keys(c).length === 4 &&
        isStr(c.customer) &&
        isStr(c.clause_ref) &&
        typeof c.hours === 'number' &&
        Number.isFinite(c.hours) &&
        c.hours >= 0 &&
        isIso(c.deadline_utc),
    );
  return check(
    raw,
    ['agent', 'obligated', 'clauses', 'deadline_utc', 'notice_draft', 'confidence', 'rationale'],
    [
      ['agent', v?.agent === 'obligation-officer', "'obligation-officer'"],
      ['obligated', isBool(v?.obligated), 'boolean'],
      ['clauses', clausesOk, '{customer,clause_ref,hours,deadline_utc:ISO}[]'],
      ['deadline_utc', v?.deadline_utc === null || isIso(v?.deadline_utc), 'ISO-8601 UTC | null'],
      ['notice_draft', isStr(v?.notice_draft), 'string'],
      ['confidence', isConfidence(v?.confidence), 'number in [0,1]'],
      ['rationale', isStr(v?.rationale) && v.rationale.trim().length > 0, 'non-empty string'],
      [
        'obligated/notice_draft',
        !v?.obligated || (isStr(v?.notice_draft) && v.notice_draft.trim().length > 0),
        'a non-empty notice when obligated',
      ],
      [
        'obligated/deadline_utc',
        !v?.obligated || isIso(v?.deadline_utc),
        'a deadline when obligated',
      ],
    ],
  );
}

export function validateArbiter(raw: unknown): ValidationResult {
  const v = raw as Partial<ArbiterVerdict>;
  return check(
    raw,
    ['agent', 'decision', 'conflict', 'conflict_between', 'actions', 'confidence', 'rationale'],
    [
      ['agent', v?.agent === 'arbiter', "'arbiter'"],
      ['decision', DECISIONS.includes(v?.decision as (typeof DECISIONS)[number]), DECISIONS.join(' | ')],
      ['conflict', isBool(v?.conflict), 'boolean'],
      [
        'conflict_between',
        Array.isArray(v?.conflict_between) && v.conflict_between.every((a) => AGENT_NAMES.includes(a)),
        'AgentName[]',
      ],
      [
        'actions',
        Array.isArray(v?.actions) && v.actions.every((a) => ACTION_KINDS.includes(a)),
        'ActionKind[]',
      ],
      ['confidence', isConfidence(v?.confidence), 'number in [0,1]'],
      ['rationale', isStr(v?.rationale) && v.rationale.trim().length > 0, 'non-empty string'],
      [
        'conflict/conflict_between',
        !v?.conflict || (Array.isArray(v?.conflict_between) && v.conflict_between.length >= 2),
        'two or more parties when conflict is true',
      ],
      [
        'suppress/actions',
        v?.decision !== 'suppress' || (Array.isArray(v?.actions) && v.actions.length === 0),
        'no actions when suppressing',
      ],
    ],
  );
}

export const VALIDATORS: Record<AgentName, (raw: unknown) => ValidationResult> = {
  reachability: validateReachability,
  'patch-engineer': validatePatch,
  'obligation-officer': validateObligation,
  arbiter: validateArbiter,
};

export class VerdictShapeError extends Error {
  constructor(
    readonly agent: AgentName,
    readonly errors: string[],
  ) {
    super(`${agent} produced an invalid verdict: ${errors.join('; ')}`);
    this.name = 'VerdictShapeError';
  }
}

/** throw rather than return anything half-shaped */
export function assertVerdict<T>(agent: AgentName, raw: unknown): T {
  const r = VALIDATORS[agent](raw);
  if (!r.ok) throw new VerdictShapeError(agent, r.errors);
  return raw as T;
}

/**
 * Repair loop for model output. Starts from the deterministic verdict, adopts any
 * field from `raw` that is individually well-typed, then re-applies `pins` — the
 * fields that are arithmetic rather than judgement (agent name, computed deadlines,
 * cited precedent ids) and which a model is not allowed to invent. The result is
 * validated strictly; on failure the caller falls back to the deterministic verdict.
 */
export function repair<T extends object>(
  agent: AgentName,
  raw: unknown,
  fallback: T,
  pins: Partial<T> = {},
): T {
  const merged: Record<string, unknown> = { ...(fallback as Record<string, unknown>) };
  if (isObj(raw)) {
    for (const key of Object.keys(fallback)) {
      if (!(key in raw)) continue;
      const candidate = { ...merged, [key]: (raw as Record<string, unknown>)[key] };
      if (VALIDATORS[agent](candidate).ok) merged[key] = (raw as Record<string, unknown>)[key];
    }
  }
  Object.assign(merged, pins);
  return assertVerdict<T>(agent, merged);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
