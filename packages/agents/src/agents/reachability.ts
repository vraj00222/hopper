/**
 * G1 — Reachability Analyst.
 *
 * Dependency path + telemetry → {reachable, confidence, call_path}.
 *
 * `reachable` is true only when the vulnerable symbol was actually observed executing
 * inside a service that sits on a dependency path from the vulnerable package to a
 * customer. A package being present is not reachability; a symbol running in a service
 * nobody depends on is not reachability either. Both halves have to line up.
 */
import type { HopPath, ReachabilityVerdict, TelemetryEvent } from '@hopper/contracts';

import { clamp01, round2 } from '../validate.js';
import { SYSTEM_PREFIX } from '../llm.js';
import {
  arrow,
  describeAdvisory,
  GROUNDING,
  orderedPaths,
  resolveVerdict,
  type AgentContext,
  type GroundedInput,
} from './context.js';

/** confidence shaping — every constant is documented because a demo will be asked */
const BASE_REACHABLE = 0.62;
const VOLUME_CEILING = 0.25;
const VOLUME_SATURATION = 4000; // calls per window at which telemetry stops adding confidence
const SHAPE_CEILING = 0.15;
const SHAPE_DECAY = 0.02; // each additional hop is one more inference we did not observe
const CONFIDENCE_CEILING = 0.97;
const ABSENCE_CONFIDENCE = 0.97; // proving no path is the strongest claim a graph makes
const PRESENT_BUT_QUIET = 0.58; // on a path, never executed: real but unproven

/** the symbol named by the advisory, e.g. "expand()" in the summary */
export function vulnerableSymbol(summary: string, telemetry: TelemetryEvent[], pkg: string): string | null {
  const named = /([A-Za-z_$][\w$]*)\s*\(\s*\)/.exec(summary ?? '');
  if (named) return named[1];
  const forPackage = telemetry
    .filter((t) => t.package === pkg)
    .sort((a, b) => b.calls - a.calls || a.symbol.localeCompare(b.symbol));
  return forPackage[0]?.symbol ?? null;
}

export function onPathTelemetry(
  telemetry: TelemetryEvent[],
  paths: HopPath[],
  pkg: string,
  symbol: string | null,
): TelemetryEvent[] {
  const services = new Set(paths.map((p) => p.service));
  return telemetry.filter(
    (t) =>
      t.package === pkg &&
      services.has(t.service) &&
      (symbol === null || t.symbol === symbol) &&
      t.calls > 0,
  );
}

export function deriveReachability(g: GroundedInput): ReachabilityVerdict {
  const pkg = g.advisory.package_name;
  const paths = orderedPaths(g.hopPaths);
  const symbol = vulnerableSymbol(g.advisory.summary, g.telemetry, pkg);
  const hits = onPathTelemetry(g.telemetry, paths, pkg, symbol);
  const telemetry_hits = hits.reduce((n, t) => n + t.calls, 0);
  const liveServices = [...new Set(hits.map((t) => t.service))].sort();

  // no path at all — the strongest negative claim the graph can make
  if (paths.length === 0) {
    return {
      agent: 'reachability',
      reachable: false,
      confidence: ABSENCE_CONFIDENCE,
      call_path: [],
      telemetry_hits: 0,
      rationale:
        `${pkg} has zero dependency paths to any deployed service or customer, so ${describeAdvisory(g.advisory)} ` +
        `cannot reach production from here. Absence is provable in a graph rather than inferred, which is why this is stated at ` +
        `high confidence. ${GROUNDING}`,
    };
  }

  // prefer a path whose service is actually executing the symbol
  const chosen =
    paths.find((p) => liveServices.includes(p.service)) ?? paths[0];
  const entry = symbol ? `${chosen.chain[0] ?? pkg}:${symbol}()` : (chosen.chain[0] ?? pkg);
  const call_path = [entry, ...chosen.chain.slice(1)];

  if (telemetry_hits === 0) {
    return {
      agent: 'reachability',
      reachable: false,
      confidence: PRESENT_BUT_QUIET,
      call_path,
      telemetry_hits: 0,
      rationale:
        `${pkg} sits on ${paths.length} dependency path${paths.length === 1 ? '' : 's'} to a customer via ` +
        `${arrow(call_path)}, but ${symbol ? `${symbol}() has` : 'no vulnerable symbol has'} been observed executing in ` +
        `${[...new Set(paths.map((p) => p.service))].join(', ')}. Present is not reachable, so this is not called reachable ` +
        `on presence alone. ${GROUNDING}`,
    };
  }

  const volume = Math.min(VOLUME_CEILING, (telemetry_hits / VOLUME_SATURATION) * VOLUME_CEILING);
  const shape = Math.max(0, SHAPE_CEILING - SHAPE_DECAY * Math.max(0, chosen.hops - 1));
  const confidence = round2(clamp01(Math.min(CONFIDENCE_CEILING, BASE_REACHABLE + volume + shape)));
  const window = hits[0]?.window_seconds ?? 0;

  return {
    agent: 'reachability',
    reachable: true,
    confidence,
    call_path,
    telemetry_hits,
    rationale:
      `${symbol ? `${symbol}()` : pkg} executed ${telemetry_hits} times in ${liveServices.join(', ')} over the last ` +
      `${window}s, and ${liveServices.join(', ')} sits on a ${chosen.hops}-hop path from ${pkg} to ${chosen.customer} ` +
      `ending at ${chosen.clause_ref}: ${arrow(call_path)}. Confidence reflects call volume and a path of ${chosen.hops} hops. ` +
      `${GROUNDING}`,
  };
}

export async function runReachability(ctx: AgentContext): Promise<ReachabilityVerdict> {
  const deterministic = deriveReachability(ctx.grounded);
  return resolveVerdict<ReachabilityVerdict>(
    ctx,
    'reachability',
    deterministic,
    () => ({
      system:
        `${SYSTEM_PREFIX} You are the Reachability Analyst. Decide whether the vulnerable symbol can actually execute in ` +
        `production. Mark reachable true only when telemetry shows the symbol running inside a service that appears on a ` +
        `dependency path. Schema: {"agent":"reachability","reachable":boolean,"confidence":number 0..1,` +
        `"call_path":string[],"telemetry_hits":integer,"rationale":string}.`,
      user: JSON.stringify(
        {
          advisory: ctx.grounded.advisory,
          hop_paths: ctx.grounded.hopPaths,
          telemetry: ctx.grounded.telemetry,
          is_chokepoint: ctx.grounded.isChokepoint,
        },
        null,
        2,
      ),
    }),
    // arithmetic, not judgement: the model may not invent a call chain or a hit count
    { agent: 'reachability', call_path: deterministic.call_path, telemetry_hits: deterministic.telemetry_hits },
  );
}
