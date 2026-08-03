/**
 * The hop scheduler. One ring per HOP_INTERVAL_MS (300ms).
 *
 * This is the only place that decides ring timing, and the fixture timeline is
 * *built* from it — so the gate testing this function is testing what the demo
 * actually plays.
 */
import { HOP_INTERVAL_MS } from '@hopper/contracts';
import type { ServerMessage } from '@hopper/contracts';

export interface HopStep {
  index: number;
  node: string;
  /** ms offset from the start of the wave */
  at: number;
  /** true only for the last ring of a path that actually reaches a clause */
  terminal: boolean;
  suppressed: boolean;
}

/**
 * Suppression: the wave dies at hop 2. Ring 0 is the package itself, ring 1 is
 * the probe outward, and there is nothing there — so we stop.
 */
export const SUPPRESSION_DEPTH = 2;

export function scheduleHops(
  chain: string[],
  opts: { suppressed?: boolean } = {},
): HopStep[] {
  const suppressed = opts.suppressed === true;
  const nodes = suppressed ? chain.slice(0, SUPPRESSION_DEPTH) : chain;
  return nodes.map((node, index) => ({
    index,
    node,
    at: index * HOP_INTERVAL_MS,
    terminal: !suppressed && index === nodes.length - 1,
    suppressed,
  }));
}

/** the scheduled steps rendered as the wire messages the reducer consumes */
export function hopMessages(
  ghsa_id: string,
  chain: string[],
  opts: { suppressed?: boolean; offset?: number } = {},
): Array<{ at: number; msg: ServerMessage }> {
  const steps = scheduleHops(chain, opts);
  const offset = opts.offset ?? 0;
  return steps.map((s) => ({
    at: offset + s.at,
    msg: {
      type: 'hop',
      ghsa_id,
      hop: s.index,
      total: steps.length,
      node: s.node,
      terminal: s.terminal,
      suppressed: s.suppressed,
    } satisfies ServerMessage,
  }));
}

/** total wall time of a wave, for sequencing the beat around it */
export function waveDuration(chain: string[], suppressed = false): number {
  const steps = scheduleHops(chain, { suppressed });
  return steps.length === 0 ? 0 : (steps.length - 1) * HOP_INTERVAL_MS;
}
