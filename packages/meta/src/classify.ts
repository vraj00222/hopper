/**
 * The classifier. Pure, deterministic, no I/O.
 *
 * An advisory's class is not a property of the advisory - it is a property of
 * the advisory *plus what the traversal found*. The same CVE is a different
 * problem at four hops than it is at zero, and the whole point of the meta
 * layer is that those two get different pipelines.
 */
import type { AdvisoryClass, AdvisoryClassInput } from '@hopper/contracts';
import { classId, depthBand, severityBand } from '@hopper/contracts';

type Band = AdvisoryClass['severity_band'];

const LADDER: Band[] = ['low', 'moderate', 'high', 'critical'];

/**
 * Chokepoint promotion.
 *
 * A chokepoint package sits between many dependents and the rest of the tree -
 * high betweenness, so one advisory on it has the blast radius of several. The
 * severity score in the advisory describes the vulnerability in isolation; it
 * knows nothing about the topology it landed in. The graph does. So a HIGH on a
 * chokepoint behaves like a CRITICAL and is promoted one rung up the ladder.
 * CRITICAL is the ceiling - nothing above it to promote into.
 */
function promote(band: Band): Band {
  const i = LADDER.indexOf(band);
  return LADDER[Math.min(i + 1, LADDER.length - 1)];
}

export function classify(input: AdvisoryClassInput): AdvisoryClass {
  const { advisory, maxHops, pathCount, isChokepoint } = input;

  const base = severityBand(advisory.severity);
  const severity_band = isChokepoint ? promote(base) : base;

  // depth comes from the actual traversal result, not from the advisory. Zero
  // paths classifies as 'none', which is what short-circuits to fast-suppress.
  const depth_band = depthBand(maxHops, pathCount);
  const ecosystem = advisory.ecosystem;

  return {
    id: classId(ecosystem, severity_band, depth_band),
    ecosystem,
    severity_band,
    depth_band,
  };
}
