/**
 * HOPPER — @hopper/meta gate.
 *
 * The definition of done for the meta layer. Exits 0 only if the graph really
 * does choose the motion: two advisory classes select different pipelines, and
 * the selection changes once outcomes are written back.
 *
 * Pass 1 runs against an in-memory GraphPort stub (hard requirement).
 * Pass 2 runs the identical assertions against the real FalkorDB on
 * localhost:6379 when it is reachable (skipped, not failed, when it is not).
 *
 *   npx tsx packages/meta/src/cli/gate.ts
 */
import type { AdvisoryClass, Advisory, GraphPort } from '@hopper/contracts';
import { HERO_ADVISORY, SUPPRESSED_ADVISORY, PRECEDENT_ADVISORY } from '@hopper/contracts';

import { createMeta } from '../index.js';
import { classify } from '../classify.js';
import { loadSpecs, PIPELINE_IDS } from '../specs.js';
import { validateSpec, OPS } from '../validate.js';
import { outperformedEdges } from '../outcome.js';
import { createMemoryGraph, createFailingGraph } from '../testing/memory-graph.js';
import { createFalkorGraph, falkorReachable, FALKOR_GRAPH } from '../testing/falkor-graph.js';

// ─── tiny assertion harness ─────────────────────────────────────────────────

let failures = 0;
let checks = 0;

function ok(cond: boolean, label: string, detail = ''): void {
  checks += 1;
  if (cond) {
    console.log(`  PASS  ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ''}`);
  }
}

function eq(actual: unknown, expected: unknown, label: string): void {
  ok(actual === expected, label, `got=${String(actual)} want=${String(expected)}`);
}

function head(n: string): void {
  console.log(`\n${n}`);
  console.log('-'.repeat(n.length));
}

function board(
  rows: Array<{ pipeline_id: string; name: string; success_rate: number; avg_latency: number; runs: number }>,
  indent = '        ',
): void {
  for (const [i, r] of rows.entries()) {
    console.log(
      `${indent}${i + 1}. ${r.name.padEnd(21)} ` +
        `${(r.success_rate * 100).toFixed(1).padStart(5)}%  ` +
        `${String(Math.round(r.avg_latency)).padStart(5)}ms  ` +
        `runs=${r.runs}`,
    );
  }
}

const advisoryFor = (a: Advisory) => a;

// ─── one full pass over a GraphPort ─────────────────────────────────────────

async function runPass(label: string, graph: GraphPort): Promise<void> {
  head(`PASS ${label}`);

  const meta = createMeta({ graph, mock: true });

  // 1 ── the three specs parse and validate structurally --------------------
  head(`[1] ${label} · pipeline specs parse and validate`);
  const specs = loadSpecs();
  eq(specs.length, 3, 'three .pipe.json specs loaded');
  eq(
    specs.map((s) => s.id).sort().join(','),
    [...PIPELINE_IDS].sort().join(','),
    'spec ids match the declared set',
  );
  for (const s of specs) {
    const v = validateSpec(s);
    ok(
      v.ok,
      `${s.name.padEnd(21)} structurally valid`,
      `nodes=${s.nodes.length} entry=${s.entry} handles=${(s.handles ?? []).length}` +
        (v.ok ? '' : ` errors=${v.errors.join('; ')}`),
    );
  }
  const allOps = new Set(specs.flatMap((s) => s.nodes.map((n) => n.op)));
  ok([...allOps].every((o) => (OPS as readonly string[]).includes(o)), 'no unknown op in any spec', `ops=${allOps.size}`);
  ok(
    specs.find((s) => s.id === 'pipe_deep_traversal')!.nodes.length >
      3 * specs.find((s) => s.id === 'pipe_fast_suppress')!.nodes.length,
    'deep-traversal is materially larger than fast-suppress',
    `${specs.find((s) => s.id === 'pipe_deep_traversal')!.nodes.length} vs ${
      specs.find((s) => s.id === 'pipe_fast_suppress')!.nodes.length
    } nodes`,
  );

  // 2 ── classifier ---------------------------------------------------------
  head(`[2] ${label} · classifier is deterministic and correct`);
  const deep = classify({ advisory: advisoryFor(HERO_ADVISORY), maxHops: 4, pathCount: 3, isChokepoint: false });
  const none = classify({ advisory: advisoryFor(SUPPRESSED_ADVISORY), maxHops: 0, pathCount: 0, isChokepoint: false });
  const direct = classify({ advisory: advisoryFor(PRECEDENT_ADVISORY), maxHops: 1, pathCount: 2, isChokepoint: false });
  const choke = classify({ advisory: advisoryFor(HERO_ADVISORY), maxHops: 4, pathCount: 3, isChokepoint: true });

  eq(deep.id, 'npm/high/deep', 'HIGH + 4 hops -> npm/high/deep');
  eq(none.id, 'npm/high/none', 'HIGH + 0 paths -> npm/high/none');
  eq(direct.id, 'npm/moderate/direct', 'MODERATE + 1 hop -> npm/moderate/direct');
  eq(choke.id, 'npm/critical/deep', 'chokepoint HIGH promotes to critical');
  eq(choke.severity_band, 'critical', 'chokepoint promotion sets severity_band');

  let stable = true;
  const canon = JSON.stringify(deep);
  for (let i = 0; i < 200; i += 1) {
    if (
      JSON.stringify(
        classify({ advisory: advisoryFor(HERO_ADVISORY), maxHops: 4, pathCount: 3, isChokepoint: false }),
      ) !== canon
    ) {
      stable = false;
    }
  }
  ok(stable, 'classify() deterministic over 200 identical calls');

  // 3 ── seeding is idempotent ---------------------------------------------
  head(`[3] ${label} · seedPipelines() is idempotent`);
  const seeded1 = await meta.seedPipelines();
  const count1 = await countPipelines(graph);
  const seeded2 = await meta.seedPipelines();
  const count2 = await countPipelines(graph);
  eq(seeded1.length, 3, 'first seed returns 3 specs');
  eq(seeded2.length, 3, 'second seed returns 3 specs');
  eq(count1, 3, 'graph holds exactly 3 Pipeline nodes after seed #1');
  eq(count2, 3, 'graph holds exactly 3 Pipeline nodes after seed #2');

  const seedBoard = await meta.leaderboard();
  console.log('        leaderboard at seed:');
  board(seedBoard);

  // 4 ── TWO CLASSES SELECT DIFFERENT PIPELINES -----------------------------
  head(`[4] ${label} · two advisory classes select different pipelines`);
  const selDeep = await meta.select(deep);
  const selNone = await meta.select(none);
  console.log(`        A  ${selDeep.reason}`);
  console.log(`        B  ${selNone.reason}`);
  eq(selDeep.selection.pipeline_id, 'pipe_deep_traversal', 'npm/high/deep  -> deep-traversal');
  eq(selNone.selection.pipeline_id, 'pipe_fast_suppress', 'npm/high/none  -> fast-suppress');
  ok(selDeep.selection.pipeline_id !== selNone.selection.pipeline_id, 'the two selections differ');
  ok(selDeep.spec.nodes.length > 0 && selNone.spec.nodes.length > 0, 'both selections carry a runnable spec');
  ok(validateSpec(selDeep.spec).ok && validateSpec(selNone.spec).ok, 'both returned specs validate');
  ok(/points ahead of/.test(selDeep.reason), 'reason names the margin over the runner-up');

  // 6a ─ OUTPERFORMED edge at seed (margin > 5 points) ----------------------
  head(`[6] ${label} · OUTPERFORMED edge written when margin exceeds 5 points`);
  const edgesAtSeed = await outperformedEdges(graph);
  for (const e of edgesAtSeed) console.log(`        (${e.from})-[:OUTPERFORMED {margin: ${e.margin}}]->(${e.to})`);
  ok(edgesAtSeed.length > 0, 'at least one OUTPERFORMED edge exists');
  ok(
    edgesAtSeed.every((e) => e.margin > 5),
    'every OUTPERFORMED edge has margin > 5 points',
  );
  ok(
    edgesAtSeed.some((e) => e.from === 'pipe_deep_traversal' && e.to === 'pipe_chokepoint_priority'),
    'deep-traversal OUTPERFORMED chokepoint-priority',
  );

  // 5 ── SUCCESS RATE CHANGES AFTER A RUN, AND SELECTION FLIPS --------------
  head(`[5] ${label} · success_rate changes after a run and selection flips`);
  const winner = selDeep.selection.pipeline_id;
  const before = (await meta.leaderboard()).find((r) => r.pipeline_id === winner)!;
  console.log('        leaderboard BEFORE:');
  board(await meta.leaderboard());

  await meta.recordOutcome(winner, false, 4200);
  const after1 = (await meta.leaderboard()).find((r) => r.pipeline_id === winner)!;
  console.log(
    `        one failure on ${winner}: success_rate ${(before.success_rate * 100).toFixed(1)}% -> ` +
      `${(after1.success_rate * 100).toFixed(1)}%  ` +
      `avg_latency ${Math.round(before.avg_latency)}ms -> ${Math.round(after1.avg_latency)}ms  ` +
      `runs ${before.runs} -> ${after1.runs}`,
  );
  ok(after1.success_rate < before.success_rate, 'success_rate dropped after a failed run');
  ok(after1.runs === before.runs + 1, 'runs incremented');
  ok(after1.avg_latency !== before.avg_latency, 'avg_latency moved (EWMA)');

  let flipped = await meta.select(deep);
  let extraFailures = 0;
  while (flipped.selection.pipeline_id === winner && extraFailures < 12) {
    await meta.recordOutcome(winner, false, 4200);
    extraFailures += 1;
    flipped = await meta.select(deep);
  }
  console.log(`        after ${1 + extraFailures} failed runs on ${winner}:`);
  console.log(`        ${flipped.reason}`);
  ok(flipped.selection.pipeline_id !== winner, 'npm/high/deep now selects a DIFFERENT pipeline');
  eq(flipped.selection.pipeline_id, 'pipe_chokepoint_priority', 'the overtaking pipeline is chokepoint-priority');
  ok(validateSpec(flipped.spec).ok, 'the new selection is a runnable spec');

  console.log('        leaderboard AFTER:');
  const afterBoard = await meta.leaderboard();
  board(afterBoard);
  eq(afterBoard[0].pipeline_id !== 'pipe_deep_traversal', true, 'deep-traversal is no longer top of the board');

  const edgesAfter = await outperformedEdges(graph);
  for (const e of edgesAfter) console.log(`        (${e.from})-[:OUTPERFORMED {margin: ${e.margin}}]->(${e.to})`);
  ok(
    edgesAfter.every((e) => e.margin > 5),
    'OUTPERFORMED edges still only exist above the 5-point threshold',
  );
  ok(
    !edgesAfter.some((e) => e.from === 'pipe_deep_traversal' && e.to === 'pipe_chokepoint_priority'),
    'the stale deep-traversal -> chokepoint-priority edge was retracted',
  );

  // a fresh select for the OTHER class is unaffected by the degradation
  const selNone2 = await meta.select(none);
  eq(selNone2.selection.pipeline_id, 'pipe_fast_suppress', 'npm/high/none still selects fast-suppress');

  // 7 ── fallback (b): widening --------------------------------------------
  head(`[7] ${label} · fallback (b) widens when no exact HANDLES edge exists`);
  const unseen: AdvisoryClass = {
    id: 'npm/moderate/shallow',
    ecosystem: 'npm',
    severity_band: 'moderate',
    depth_band: 'shallow',
  };
  const wide = await meta.select(unseen);
  console.log(`        ${wide.reason}`);
  ok(/widened/.test(wide.reason), 'reason names the widening');
  ok(wide.spec.nodes.length > 0 && validateSpec(wide.spec).ok, 'widened fallback returns a runnable spec');
  ok(
    wide.selection.pipeline_id !== 'pipe_fast_suppress',
    'widening never crosses the zero-path boundary onto a suppressor',
    `picked=${wide.selection.pipeline_id}`,
  );

  const alien: AdvisoryClass = {
    id: 'cargo/low/none',
    ecosystem: 'cargo',
    severity_band: 'low',
    depth_band: 'none',
  };
  const global = await meta.select(alien);
  console.log(`        ${global.reason}`);
  ok(global.spec.nodes.length > 0 && validateSpec(global.spec).ok, 'unknown ecosystem still returns a runnable spec');
  ok(/widened|global best/.test(global.reason), 'reason explains the last-resort match');
  eq(global.selection.pipeline_id, 'pipe_fast_suppress', 'a zero-path class still lands on a suppressor');

  console.log(`\n  ${label} pass complete`);
}

async function countPipelines(graph: GraphPort): Promise<number> {
  const rows = await graph.query<{ n: number }>(
    '// hopper.meta.count_pipelines\nMATCH (p:Pipeline) RETURN count(p) AS n',
  );
  return Number(rows[0]?.n ?? 0);
}

// ─── fallback (c): the graph is gone ────────────────────────────────────────

async function runOfflinePass(): Promise<void> {
  head('[8] fallback (c) · graph unreachable, local memory selection');
  const dead = createFailingGraph();
  const meta = createMeta({ graph: dead, mock: true });

  // seeding against a dead graph must not throw either
  const specs = await meta.seedPipelines();
  eq(specs.length, 3, 'seedPipelines() survives a dead graph');

  const deep = classify({ advisory: HERO_ADVISORY, maxHops: 4, pathCount: 3, isChokepoint: false });
  const none = classify({ advisory: SUPPRESSED_ADVISORY, maxHops: 0, pathCount: 0, isChokepoint: false });

  const a = await meta.select(deep);
  const b = await meta.select(none);
  console.log(`        A  ${a.reason}`);
  console.log(`        B  ${b.reason}`);
  ok(/graph unreachable/.test(a.reason), 'reason says the graph is unreachable');
  ok(/graph unreachable/.test(b.reason), 'reason says the graph is unreachable');
  eq(a.selection.pipeline_id, 'pipe_deep_traversal', 'local selection still routes npm/high/deep correctly');
  eq(b.selection.pipeline_id, 'pipe_fast_suppress', 'local selection still routes npm/high/none correctly');
  ok(validateSpec(a.spec).ok && validateSpec(b.spec).ok, 'both offline selections are runnable specs');

  // outcome write-back must not throw with no graph behind it
  let threw = false;
  try {
    await meta.recordOutcome('pipe_deep_traversal', false, 5000);
    await meta.leaderboard();
    await outperformedEdges(dead);
  } catch {
    threw = true;
  }
  ok(!threw, 'recordOutcome/leaderboard survive a dead graph');
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('HOPPER · @hopper/meta gate');
  console.log('the graph selects the pipeline; outcomes change the selection\n');

  const stub = createMemoryGraph();
  await stub.connect();
  await runPass('stub (in-memory GraphPort)', stub);
  await stub.close();

  await runOfflinePass();

  head('[9] second pass against the real FalkorDB');
  const reachable = await falkorReachable();
  if (!reachable) {
    console.log('  SKIP  FalkorDB on localhost:6379 not reachable - stub pass stands alone');
  } else {
    console.log(`  FalkorDB reachable on localhost:6379 · graph "${FALKOR_GRAPH}"`);
    const falkor = createFalkorGraph();
    await falkor.connect();
    await falkor.reset();
    await runPass(`falkordb ("${FALKOR_GRAPH}")`, falkor);
    await falkor.close();
  }

  head('RESULT');
  console.log(`  ${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.log(`  GATE FAILED · ${failures} failing checks`);
    process.exit(1);
  }
  console.log('  GATE PASSED');
  console.log('  proved: 3 portable JSON pipelines live in the graph as Pipeline nodes;');
  console.log('          the classifier is pure and deterministic;');
  console.log('          Q7 (success_rate DESC, avg_latency ASC) picks the pipeline;');
  console.log('          two advisory classes select different pipelines;');
  console.log('          a failed run moves success_rate and flips the selection;');
  console.log('          OUTPERFORMED edges track the margin above 5 points;');
  console.log('          widening and offline fallbacks always return a runnable spec.');
  process.exit(0);
}

main().catch((e) => {
  console.error('  GATE CRASHED', e);
  process.exit(1);
});
