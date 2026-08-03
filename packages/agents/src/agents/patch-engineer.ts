/**
 * G2 — Patch Engineer. This is beat 3.
 *
 * Version ranges + PatchAttempt precedent → {safe_bump, target, breaking_risk}.
 *
 * The interesting case is not the semver arithmetic. It is that the graph may contain a
 * PatchAttempt written minutes ago — during this same demo run — recording that exactly
 * this bump broke staging. Nothing about that is in the prompt. It is an edge the system
 * wrote about itself, and it is enough to overturn the recommendation.
 *
 * The trigger is the precedent's outcome and its age. There is no advisory id in this
 * file: any library with a fresh failed bump gets the same answer.
 */
import type { PatchVerdict, Precedent } from '@hopper/contracts';

import { round2 } from '../validate.js';
import { SYSTEM_PREFIX } from '../llm.js';
import {
  agoPhrase,
  failedPrecedents,
  freshFailure,
  GROUNDING,
  precedentCitation,
  resolveVerdict,
  successPrecedents,
  type AgentContext,
  type GroundedInput,
} from './context.js';

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(v: string | null | undefined): SemVer | null {
  if (!v) return null;
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

/** the upper bound of a vulnerable range, e.g. "< 1.1.18" → 1.1.18 */
export function rangeCeiling(range: string | null | undefined): SemVer | null {
  return parseVersion(range ?? null);
}

export type BumpShape = 'patch' | 'minor' | 'major' | 'unknown';

export function bumpShape(from: SemVer | null, to: SemVer | null): BumpShape {
  if (!from || !to) return 'unknown';
  if (to.major !== from.major) return 'major';
  if (to.minor !== from.minor) return 'minor';
  return 'patch';
}

const RISK_BY_SHAPE: Record<BumpShape, PatchVerdict['breaking_risk']> = {
  patch: 'low',
  minor: 'low',
  major: 'medium',
  unknown: 'medium',
};

export function derivePatch(g: GroundedInput): PatchVerdict {
  const pkg = g.advisory.package_name;
  const target = g.advisory.fixed_in;
  const from = rangeCeiling(g.advisory.vulnerable_range);
  const to = parseVersion(target);
  const shape = bumpShape(from, to);
  const fresh = freshFailure(g.precedents);
  const stale = failedPrecedents(g.precedents).filter((p) => p !== fresh);
  const wins = successPrecedents(g.precedents);

  // ── the beat: this library was bumped moments ago and staging broke ──────
  if (fresh) {
    const cite = precedentCitation(fresh);
    const repeats = !!to && fresh.to_v === target;
    return {
      agent: 'patch-engineer',
      safe_bump: false,
      target,
      breaking_risk: 'high',
      confidence: 0.92,
      precedent_ids: [cite],
      rationale:
        `${fresh.package} was bumped ${fresh.from_v} → ${fresh.to_v} ${agoPhrase(fresh.age_seconds)} and staging broke ` +
        `(${cite}: ${fresh.notes || fresh.outcome}). ` +
        (repeats
          ? `The only published fix for ${describeRange(g)} is ${target}, which is the same bump that just failed, so shipping it now repeats a known failure.`
          : `That failure is recent enough that the ${target ?? 'proposed'} bump would land on a build we already know is unstable.`) +
        ` Recommending no automatic bump. This precedent is an edge in the graph written ${agoPhrase(fresh.age_seconds)}, not prior knowledge. ${GROUNDING}`,
    };
  }

  // ── no fix exists yet ────────────────────────────────────────────────────
  if (!target) {
    return {
      agent: 'patch-engineer',
      safe_bump: false,
      target: null,
      breaking_risk: 'high',
      confidence: 0.86,
      precedent_ids: [],
      rationale:
        `No fixed version of ${pkg} has been published for ${describeRange(g)}, so there is no bump to make and mitigation ` +
        `has to be operational rather than a version change. ${GROUNDING}`,
    };
  }

  // ── a prior success for exactly this bump ────────────────────────────────
  const matched = wins.find((p) => p.package === pkg && p.to_v === target);
  if (matched) {
    return {
      agent: 'patch-engineer',
      safe_bump: true,
      target,
      breaking_risk: 'none',
      confidence: 0.93,
      precedent_ids: [precedentCitation(matched)],
      rationale:
        `${pkg} → ${target} has been applied before and succeeded (${precedentCitation(matched)}, ${agoPhrase(matched.age_seconds)}: ` +
        `${matched.notes || 'clean'}), and no failed attempt sits inside the recency window. Safe to bump. ${GROUNDING}`,
    };
  }

  // ── an older failure: history, not a live hazard, but still worth pricing ─
  if (stale.length > 0) {
    const worst = [...stale].sort((a, b) => a.age_seconds - b.age_seconds)[0];
    return {
      agent: 'patch-engineer',
      safe_bump: true,
      target,
      breaking_risk: 'medium',
      confidence: 0.71,
      precedent_ids: [precedentCitation(worst)],
      rationale:
        `${pkg} → ${target} is a ${shape}-level bump. A previous attempt failed (${precedentCitation(worst)}, ` +
        `${agoPhrase(worst.age_seconds)}, ${worst.outcome}: ${worst.notes}) but it is outside the recency window, so it prices ` +
        `the risk rather than blocking the change. Bump with staged verification. ${GROUNDING}`,
    };
  }

  // ── plain semver reasoning ───────────────────────────────────────────────
  const risk = RISK_BY_SHAPE[shape];
  const confidence = round2(shape === 'patch' ? 0.88 : shape === 'minor' ? 0.82 : 0.72);
  return {
    agent: 'patch-engineer',
    safe_bump: true,
    target,
    breaking_risk: risk,
    confidence,
    precedent_ids: [],
    rationale:
      `${pkg} ${describeRange(g)} → ${target} is a ${shape}-level bump and the graph holds no patch attempt for this ` +
      `library, failed or otherwise, so there is no precedent to argue against it. Breaking risk assessed as ${risk} from the ` +
      `version delta alone. ${GROUNDING}`,
  };
}

function describeRange(g: GroundedInput): string {
  return g.advisory.vulnerable_range || 'the vulnerable range';
}

/** exposed so the Arbiter can reason about the same precedent the engineer cited */
export function citedFreshFailure(g: GroundedInput): Precedent | null {
  return freshFailure(g.precedents);
}

export async function runPatchEngineer(ctx: AgentContext): Promise<PatchVerdict> {
  const deterministic = derivePatch(ctx.grounded);
  return resolveVerdict<PatchVerdict>(
    ctx,
    'patch-engineer',
    deterministic,
    () => ({
      system:
        `${SYSTEM_PREFIX} You are the Patch Engineer. Decide whether the fixed version can be applied automatically. A prior ` +
        `PatchAttempt with outcome broke_staging or rolled_back, recent enough to still describe the current build, is ` +
        `disqualifying: say so plainly and cite it. Schema: {"agent":"patch-engineer","safe_bump":boolean,` +
        `"target":string|null,"breaking_risk":"none"|"low"|"medium"|"high","confidence":number 0..1,` +
        `"precedent_ids":string[],"rationale":string}.`,
      user: JSON.stringify(
        {
          advisory: ctx.grounded.advisory,
          precedents: ctx.grounded.precedents,
          is_chokepoint: ctx.grounded.isChokepoint,
        },
        null,
        2,
      ),
    }),
    // arithmetic, not judgement: the fixed version and the citations are facts
    {
      agent: 'patch-engineer',
      target: deterministic.target,
      precedent_ids: deterministic.precedent_ids,
    },
  );
}
