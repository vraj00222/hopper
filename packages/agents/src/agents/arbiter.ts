/**
 * G4 — Arbiter, and G5 — staged disagreement.
 *
 * Reconciles the other three and decides auto, human or suppress.
 *
 *   zero paths                                  → suppress
 *   an obligated customer                       → human, always
 *   reachable + safe bump + no obligation       → auto
 *
 * The conflict is not a branch on an advisory id. The Arbiter re-reads the same
 * precedent list the Patch Engineer read and looks for the shape that makes two honest
 * agents disagree: the symbol is live in production, and the only published fix is a
 * bump that failed inside the recency window. Any library in that state produces the
 * same escalation.
 */
import type {
  ActionKind,
  AgentName,
  ArbiterVerdict,
  ObligationVerdict,
  PatchVerdict,
  ReachabilityVerdict,
} from '@hopper/contracts';

import { clamp01, round2 } from '../validate.js';
import { SYSTEM_PREFIX } from '../llm.js';
import {
  agoPhrase,
  freshFailure,
  GROUNDING,
  orderedPaths,
  precedentCitation,
  resolveVerdict,
  type AgentContext,
  type GroundedInput,
} from './context.js';

export interface ArbiterInput {
  grounded: GroundedInput;
  reachability: ReachabilityVerdict;
  patch: PatchVerdict;
  obligation: ObligationVerdict;
}

/** reachability has to be asserting something, not merely failing to deny it */
const URGENCY_FLOOR = 0.6;

const ACTION_ORDER: ActionKind[] = ['open_pr', 'page_oncall', 'notify_customer', 'open_ticket'];

/** actions that can never be automatic, whatever the agents conclude */
export const REQUIRES_APPROVAL: ReadonlySet<ActionKind> = new Set<ActionKind>(['notify_customer']);

export function deriveArbiter(input: ArbiterInput): ArbiterVerdict {
  const { grounded: g, reachability: reach, patch, obligation } = input;
  const pkg = g.advisory.package_name;
  const paths = orderedPaths(g.hopPaths);
  const lead = paths[0] ?? null;

  const fresh = freshFailure(g.precedents);
  const urgent = reach.reachable && reach.confidence >= URGENCY_FLOOR;
  const blocked = patch.safe_bump === false;

  // G5 — a genuine disagreement, derived from data on both sides
  const conflict = paths.length > 0 && urgent && blocked && fresh !== null;
  const conflict_between: AgentName[] = conflict ? ['reachability', 'patch-engineer'] : [];

  let decision: ArbiterVerdict['decision'];
  if (paths.length === 0) decision = 'suppress';
  else if (conflict) decision = 'human';
  else if (obligation.obligated) decision = 'human';
  else if (reach.reachable && patch.safe_bump) decision = 'auto';
  else if (!reach.reachable) decision = 'suppress';
  else decision = 'human';

  const actions: ActionKind[] = [];
  if (decision !== 'suppress') {
    if (reach.reachable && patch.safe_bump) actions.push('open_pr');
    if (reach.reachable && (conflict || obligation.obligated || blocked)) actions.push('page_oncall');
    if (obligation.obligated) actions.push('notify_customer');
    if (conflict || blocked) actions.push('open_ticket');
  }
  const ordered = ACTION_ORDER.filter((a) => actions.includes(a));

  const confidence = round2(
    clamp01(
      decision === 'suppress'
        ? reach.confidence
        : conflict
          ? Math.max(reach.confidence, patch.confidence)
          : Math.min(reach.confidence, patch.confidence, obligation.confidence),
    ),
  );

  return {
    agent: 'arbiter',
    decision,
    conflict,
    conflict_between,
    actions: ordered,
    confidence,
    rationale: rationale({ input, conflict, decision, fresh, lead, pkg }),
  };
}

function rationale(args: {
  input: ArbiterInput;
  conflict: boolean;
  decision: ArbiterVerdict['decision'];
  fresh: ReturnType<typeof freshFailure>;
  lead: ReturnType<typeof orderedPaths>[number] | null;
  pkg: string;
}): string {
  const { input, conflict, decision, fresh, lead, pkg } = args;
  const { grounded: g, reachability: reach, patch, obligation } = input;
  const a = g.advisory;

  if (conflict && fresh && lead) {
    return (
      `Reachability puts ${pkg} live in ${lead.service} and ${reach.telemetry_hits} calls deep on a ${lead.hops}-hop path to ` +
      `${lead.customer}, but the Patch Engineer holds ${precedentCitation(fresh)} — the same ${fresh.from_v} → ${fresh.to_v} bump ` +
      `broke staging ${agoPhrase(fresh.age_seconds)} — so shipping the only published fix risks a second outage while waiting ` +
      `leaves a live ${a.severity} advisory inside a ${lead.notice_window}h ${lead.clause_ref} notice window: a human decides ` +
      `which risk to take.`
    );
  }

  if (decision === 'suppress' && g.hopPaths.length === 0) {
    return (
      `Zero dependency paths from ${pkg} to any deployed service or customer, so there is nothing here to act on and nothing ` +
      `to tell anyone: suppressed on a proof of absence rather than a guess. ${GROUNDING}`
    );
  }

  if (decision === 'suppress') {
    return (
      `${pkg} reaches ${new Set(g.hopPaths.map((p) => p.service)).size} service(s) but the vulnerable symbol has not executed ` +
      `in any of them and no notice clause is in scope, so this is held rather than actioned; new telemetry reopens it. ${GROUNDING}`
    );
  }

  if (decision === 'auto') {
    return (
      `${pkg} is executing in ${reach.call_path[reach.call_path.length - 2] ?? 'a deployed service'}, the ${patch.target} bump ` +
      `carries ${patch.breaking_risk} breaking risk with no failed precedent, and no customer notice clause is in scope, so the ` +
      `pull request proceeds automatically. ${GROUNDING}`
    );
  }

  if (obligation.obligated && lead) {
    return (
      `${pkg} is live in ${lead.service} and reaches ${lead.customer} under ${lead.clause_ref}, and telling a customer is never ` +
      `an automatic act, so the ${lead.notice_window}h notice goes to a person for signature` +
      (patch.safe_bump ? ` while the ${patch.target} bump proceeds` : ` and the ${patch.breaking_risk}-risk bump is held`) +
      `. ${GROUNDING}`
    );
  }

  return (
    `${pkg} is reachable but the ${patch.target ?? 'proposed'} bump is not safe to apply automatically ` +
    `(${patch.breaking_risk} breaking risk), and no contractual clock is running, so this goes to a person rather than a ` +
    `pipeline. ${GROUNDING}`
  );
}

export async function runArbiter(ctx: AgentContext, input: ArbiterInput): Promise<ArbiterVerdict> {
  const deterministic = deriveArbiter(input);
  return resolveVerdict<ArbiterVerdict>(
    ctx,
    'arbiter',
    deterministic,
    () => ({
      system:
        `${SYSTEM_PREFIX} You are the Arbiter. Reconcile three verdicts into one decision: auto, human or suppress. Zero ` +
        `dependency paths means suppress. An obligated customer always means human — a customer notification can never be ` +
        `automatic. Reachable with a safe bump and no obligation means auto. If two agents genuinely disagree, set conflict ` +
        `true, name both, escalate, and explain the tradeoff in one honest sentence. Schema: {"agent":"arbiter",` +
        `"decision":"auto"|"human"|"suppress","conflict":boolean,"conflict_between":string[],"actions":string[],` +
        `"confidence":number 0..1,"rationale":string}.`,
      user: JSON.stringify(
        {
          advisory: input.grounded.advisory,
          hop_paths: input.grounded.hopPaths,
          precedents: input.grounded.precedents,
          reachability: input.reachability,
          patch: input.patch,
          obligation: input.obligation,
        },
        null,
        2,
      ),
    }),
    // governance, not judgement: the model may not remove the conflict, change the
    // decision away from a required escalation, or invent an action list
    {
      agent: 'arbiter',
      decision: deterministic.decision,
      conflict: deterministic.conflict,
      conflict_between: deterministic.conflict_between,
      actions: deterministic.actions,
    },
  );
}
