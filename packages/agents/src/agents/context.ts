/**
 * What an agent is allowed to see, and the reasoning primitives they share.
 *
 * The context carries the grounded input and nothing else: the advisory, the hop paths
 * FalkorDB walked, the telemetry LaserData delivered, and the PatchAttempt precedents.
 * There is no credential field on this object by construction — an agent can ask
 * whether a credential exists, never what it is.
 */
import type {
  Advisory,
  AgentName,
  HopPath,
  Precedent,
  TelemetryEvent,
} from '@hopper/contracts';

import type { Llm } from '../llm.js';
import { assertVerdict, repair } from '../validate.js';

export interface GroundedInput {
  advisory: Advisory;
  hopPaths: HopPath[];
  telemetry: TelemetryEvent[];
  precedents: Precedent[];
  isChokepoint: boolean;
}

export interface AgentContext {
  readonly grounded: GroundedInput;
  readonly llm: Llm | null;
  /** presence only. There is no method on this interface that returns a value. */
  hasCredential(name: string): boolean;
  /** record something worth auditing that is not part of the verdict */
  note(message: string): void;
}

/** the line every agent stands on: no vector store, no retrieval, no ambient memory */
export const GROUNDING =
  'Context is the dependency subgraph, runtime telemetry and prior patch attempts only — no vector store, no retrieval.';

/** a failed bump older than this is history; newer than this is a live hazard */
export const FRESH_PRECEDENT_SECONDS = 600;

export const FAILED_OUTCOMES: Array<Precedent['outcome']> = ['broke_staging', 'rolled_back'];

/**
 * A citable id for a precedent. Q3 returns the PatchAttempt projection rather than the
 * node, so we lift an explicit id out of the notes when the graph wrote one and derive
 * a stable one from the bump itself otherwise. Either way it is deterministic.
 */
export function precedentCitation(p: Precedent): string {
  const explicit = /(?:PatchAttempt#\d+|pa[_-][A-Za-z0-9]+)/.exec(p.notes ?? '');
  if (explicit) return explicit[0];
  return `patch:${p.package}:${p.from_v}>${p.to_v}@${p.ts}`;
}

export function failedPrecedents(precedents: Precedent[]): Precedent[] {
  return precedents.filter((p) => FAILED_OUTCOMES.includes(p.outcome));
}

/**
 * The precedent that makes beat 3 work: a bump of this library that failed, recently
 * enough that repeating it now would repeat the failure. Recency and outcome are the
 * only inputs — there is no advisory id anywhere in this function.
 */
export function freshFailure(
  precedents: Precedent[],
  windowSeconds: number = FRESH_PRECEDENT_SECONDS,
): Precedent | null {
  const candidates = failedPrecedents(precedents)
    .filter((p) => Number.isFinite(p.age_seconds) && p.age_seconds >= 0 && p.age_seconds <= windowSeconds)
    .sort((a, b) => a.age_seconds - b.age_seconds || a.ts.localeCompare(b.ts));
  return candidates[0] ?? null;
}

export function successPrecedents(precedents: Precedent[]): Precedent[] {
  return precedents.filter((p) => p.outcome === 'success');
}

export function agoPhrase(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 120) return `${s} seconds ago`;
  if (s < 7200) return `${Math.round(s / 60)} minutes ago`;
  if (s < 172800) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** deterministic path ordering: tightest window, then fewest hops, then name */
export function orderedPaths(paths: HopPath[]): HopPath[] {
  return [...paths].sort(
    (a, b) =>
      a.notice_window - b.notice_window ||
      a.hops - b.hops ||
      a.customer.localeCompare(b.customer) ||
      a.clause_ref.localeCompare(b.clause_ref),
  );
}

export function arrow(parts: string[]): string {
  return parts.join(' → ');
}

export function describeAdvisory(a: Advisory): string {
  return `${a.ghsa_id}${a.cve_id ? ` (${a.cve_id})` : ''}`;
}

/**
 * Deterministic verdict first, model second. In MOCK the deterministic verdict is
 * validated and returned. With a model available we ask it for the same verdict, repair
 * its output against the deterministic one, re-pin the fields that are arithmetic
 * rather than judgement, and validate strictly. If any of that fails the deterministic
 * verdict stands and the failure is recorded in the session trace rather than swallowed.
 */
export async function resolveVerdict<T extends object>(
  ctx: AgentContext,
  agent: AgentName,
  deterministic: T,
  prompt: () => { system: string; user: string },
  pins: Partial<T> = {},
): Promise<T> {
  const baseline = assertVerdict<T>(agent, deterministic);
  if (!ctx.llm) return baseline;
  try {
    const { system, user } = prompt();
    const raw = await ctx.llm.json(agent, system, user);
    return repair(agent, raw, baseline, pins);
  } catch (err) {
    ctx.note(
      `${agent}: model path unusable (${(err as Error).message}); deterministic verdict stands`,
    );
    return baseline;
  }
}
