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

// ─── trace geometry ─────────────────────────────────────────────────────────
//
// A fixture chain is 7 nodes. Real deps.dev data yields 10 and can go further,
// because the chain carries the repo, service, customer and clause as well as
// the dependency edges. The trace has to stay inside its panel and stay legible
// at any of those lengths, so the geometry is computed, never hard-coded.

export const VIEW_W = 1000;
export const VIEW_H = 190;
export const CENTER_Y = 92;
const EDGE_PAD = 58;
/** a two-ring suppression must not stretch across the whole instrument */
const MAX_PITCH = 132;
/** below this pitch, labels alternate between two rows so they cannot collide */
const STAGGER_BELOW = 120;
/** IBM Plex Mono advance width as a fraction of font size */
const MONO_ADVANCE = 0.6;

export interface Ring {
  index: number;
  x: number;
  /** where this ring's caption sits — staggered rows on dense traces */
  labelX: number;
  labelY: number;
  lowerRow: boolean;
}

export interface TraceLayout {
  width: number;
  height: number;
  cy: number;
  pitch: number;
  radius: number;
  fontSize: number;
  stagger: boolean;
  /** captions longer than this get a middle ellipsis */
  maxChars: number;
  rings: Ring[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function layoutTrace(total: number): TraceLayout {
  const n = Math.max(0, Math.floor(total));
  const span = VIEW_W - EDGE_PAD * 2;
  const pitch = n > 1 ? Math.min(MAX_PITCH, span / (n - 1)) : 0;
  const radius = clamp(pitch === 0 ? 11 : pitch / 9, 6.5, 11);
  const fontSize = clamp(pitch === 0 ? 12 : pitch / 8.6, 8, 12);
  const stagger = pitch > 0 && pitch < STAGGER_BELOW;

  // a staggered caption owns roughly two pitches of horizontal room
  const room = pitch * (stagger ? 1.92 : 0.94);
  const maxChars = Math.max(6, Math.floor(room / (MONO_ADVANCE * fontSize)));

  const rings: Ring[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = EDGE_PAD + i * pitch;
    const lowerRow = stagger && i % 2 === 1;
    // keep captions off the panel edges — they may never reach the next column
    const halfLabel = (maxChars * MONO_ADVANCE * fontSize) / 2;
    rings.push({
      index: i,
      x,
      labelX: clamp(x, Math.min(halfLabel, VIEW_W / 2), VIEW_W - Math.min(halfLabel, VIEW_W / 2)),
      labelY: CENTER_Y + (lowerRow ? 58 : 38),
      lowerRow,
    });
  }

  return { width: VIEW_W, height: VIEW_H, cy: CENTER_Y, pitch, radius, fontSize, stagger, maxChars, rings };
}

/** middle ellipsis — keeps the scope and the tail of `@jest/reporters` */
export function fitLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) return label;
  if (maxChars <= 3) return label.slice(0, Math.max(1, maxChars));
  const keep = maxChars - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${label.slice(0, head)}…${label.slice(label.length - tail)}`;
}

/**
 * Ring ordinals are only truthful when the chain is exactly
 * `package + hops + clause`. Real chains carry repo/service/customer nodes too,
 * so numbering every ring would contradict the hop count next to it.
 */
export function ordinalsAreHops(chainLength: number, hops: number): boolean {
  return chainLength > 0 && hops > 0 && chainLength - 2 === hops;
}
