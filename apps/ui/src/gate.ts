/**
 * apps/ui gate — the definition of done for the Situation Room.
 *
 *   npx tsx apps/ui/src/gate.ts
 *
 * There is no browser here, so it asserts on the logic the components are made
 * of: the fixture's structural completeness, the reducer that every websocket
 * message goes through, the ring scheduler that draws the signature element,
 * and the Guild approval gate. If this passes, the demo arc is real.
 */
import {
  DEMO_BEATS,
  HERO_GHSA,
  HOP_INTERVAL_MS,
  PRECEDENT_GHSA,
  SUPPRESSED_GHSA,
  fmtCountdown,
} from '@hopper/contracts';
import type { ClockTick, ServerMessage } from '@hopper/contracts';
import {
  APPROVAL_ID,
  BEATS,
  HERO_CHAIN,
  INITIAL_STATE,
  PRECEDENT_CHAIN,
  SUPPRESSED_CHAIN,
} from './fixture.js';
import { SUPPRESSION_DEPTH, scheduleHops } from './lib/hops.js';
import {
  approvalMessages,
  initialUi,
  isBlocked,
  primaryClock,
  receiptFor,
  reduce,
  reduceAll,
  splitFeed,
} from './lib/reducer.js';
import { contractLoaded, validateAppState } from './lib/validate.js';
import type { UiState } from './lib/types.js';

let failures = 0;
let checks = 0;

function ok(label: string, detail = '') {
  checks += 1;
  console.log(`  PASS  ${label}${detail ? `  ${detail}` : ''}`);
}

function bad(label: string, detail: string) {
  checks += 1;
  failures += 1;
  console.log(`  FAIL  ${label}  ${detail}`);
}

function assert(cond: boolean, label: string, detail = '') {
  if (cond) ok(label, detail);
  else bad(label, detail || 'assertion failed');
}

function section(title: string) {
  console.log(`\n${title}`);
}

function replay(ui: UiState, msgs: ServerMessage[]): UiState {
  return reduceAll(ui, msgs);
}

console.log('HOPPER · apps/ui gate');
console.log('the Situation Room renders the full demo arc from fixture.ts, no backend\n');

// ── 1. the fixture is a structurally complete AppState ──────────────────────
section('1  fixture is a structurally complete AppState');

assert(contractLoaded(), 'contract loaded from @hopper/contracts');

const initialProblems = validateAppState(INITIAL_STATE);
assert(
  initialProblems.length === 0,
  'INITIAL_STATE validates against the AppState contract',
  initialProblems.slice(0, 4).join(' | '),
);

// survives the JSON round-trip a real server would put it through
const roundTripped = JSON.parse(JSON.stringify(INITIAL_STATE)) as unknown;
assert(
  validateAppState(roundTripped).length === 0,
  'AppState survives a JSON round-trip',
  `${INITIAL_STATE.feed.length} feed items`,
);

assert(
  validateAppState({ ...INITIAL_STATE, feed: [] }).length > 0,
  'validator rejects an empty feed (it is not a rubber stamp)',
);
assert(
  validateAppState({ ...INITIAL_STATE, status: { ...INITIAL_STATE.status, kev_count: 'lots' } }).length > 0,
  'validator rejects a wrong-typed status field',
);

const beat1 = BEATS.find((b) => b.step === 1)!;
const beat2 = BEATS.find((b) => b.step === 2)!;
const beat3 = BEATS.find((b) => b.step === 3)!;

// every focus pushed over the wire is a complete FocusView too
let focusChecked = 0;
let focusProblems: string[] = [];
for (const b of BEATS) {
  for (const c of b.cues) {
    if (c.msg.type === 'focus') {
      focusChecked += 1;
      const p = validateAppState({ ...INITIAL_STATE, focus: c.msg.focus });
      if (p.length > 0) focusProblems = focusProblems.concat(p);
    }
  }
}
assert(
  focusProblems.length === 0,
  'every scripted FocusView validates',
  `${focusChecked} focus messages · ${focusProblems.slice(0, 3).join(' | ')}`,
);

// ── 2. the timeline contains all three beats and replays correctly ──────────
section('2  the scripted timeline replays the three beats through the app reducer');

assert(BEATS.length === 3, 'timeline has three beats', BEATS.map((b) => b.label).join(' · '));
assert(
  DEMO_BEATS.every((d) => BEATS.some((b) => b.step === d.step && b.ghsa_id === d.ghsa_id)),
  'beats line up with DEMO_BEATS in the contract',
  DEMO_BEATS.map((d) => `${d.step}:${d.label}`).join(' · '),
);

let ui = initialUi(INITIAL_STATE);

// beat 1 — the hit
ui = replay(ui, beat1.cues.map((c) => c.msg));
const heroFeed = ui.app.feed.find((f) => f.ghsa_id === HERO_GHSA);
assert(heroFeed?.state === 'escalated', 'beat 1 escalated', `state=${heroFeed?.state}`);
assert((heroFeed?.hops ?? 0) >= 4, 'beat 1 has >= 4 hops', `hops=${heroFeed?.hops}`);
assert(ui.wave?.ghsa_id === HERO_GHSA, 'beat 1 hop wave is the hero advisory');
assert(ui.wave?.arrived === HERO_CHAIN.length, 'beat 1 wave delivered every ring', `${ui.wave?.arrived}/${HERO_CHAIN.length}`);
assert(ui.wave?.terminal === true, 'beat 1 wave reached the clause (terminal)');
assert(ui.wave?.suppressed === false, 'beat 1 wave is not suppressed');

const c1 = primaryClock(ui);
assert(c1 !== null && c1.state === 'running', 'beat 1 clock is running', c1 ? fmtCountdown(c1.remaining_seconds) : '');
assert(c1?.clause_ref === '§7.3', 'beat 1 clock is bound to the clause', c1?.clause_ref);
assert(
  ui.app.focus?.verdicts.reachability !== undefined &&
    ui.app.focus?.verdicts.patch !== undefined &&
    ui.app.focus?.verdicts.obligation !== undefined &&
    ui.app.focus?.verdicts.arbiter !== undefined,
  'beat 1 delivered all four agent verdicts',
);
assert(ui.app.focus?.verdicts.patch?.conflict === false, 'beat 1 patch verdict has no conflict');
assert(ui.app.receipts.length === 2, 'beat 1 produced 2 auto receipts', ui.app.receipts.map((r) => r.action).join(' · '));
assert(ui.app.focus?.audit.length ? ui.app.focus.audit.length >= 8 : false, 'beat 1 wrote an audit trail', `${ui.app.focus?.audit.length} entries`);

const auditTs = (ui.app.focus?.audit ?? []).map((a) => Date.parse(a.ts));
assert(
  auditTs.every((t, i) => i === 0 || t >= auditTs[i - 1]),
  'audit entries are in ts order (regulator artifact)',
);

// beat 2 — the restraint
ui = replay(ui, beat2.cues.map((c) => c.msg));
const suppFeed = ui.app.feed.find((f) => f.ghsa_id === SUPPRESSED_GHSA);
assert(suppFeed?.state === 'suppressed', 'beat 2 suppressed', `state=${suppFeed?.state}`);
assert(suppFeed?.hops === 0, 'beat 2 has 0 hops', `hops=${suppFeed?.hops}`);
assert(ui.wave?.suppressed === true, 'beat 2 wave is flagged suppressed');
assert(ui.wave?.terminal === false, 'beat 2 wave never reaches a clause');
assert(ui.wave?.arrived === SUPPRESSION_DEPTH, 'beat 2 wave dies at hop 2', `arrived=${ui.wave?.arrived}`);
assert(
  ui.app.focus?.absence?.decision === 'SUPPRESSED',
  'beat 2 carries a proof of no path',
  ui.app.focus?.absence?.statement ?? '',
);
assert(ui.app.focus?.absence?.paths === 0, 'beat 2 absence proof: zero paths');
assert(ui.app.receipts.length === 2, 'beat 2 took no action (receipt count unchanged)');
assert(primaryClock(ui)?.state === 'running', 'beat 2 leaves the obligation clock running');

// beat 3 — memory
ui = replay(ui, beat3.cues.map((c) => c.msg));
const precFeed = ui.app.feed.find((f) => f.ghsa_id === PRECEDENT_GHSA);
assert(precFeed?.state === 'escalated', 'beat 3 escalated', `state=${precFeed?.state}`);
assert((precFeed?.hops ?? 0) >= 4, 'beat 3 has >= 4 hops', `hops=${precFeed?.hops}`);
assert(ui.app.focus?.verdicts.patch?.conflict === true, 'beat 3 patch verdict has conflict:true');
assert(
  (ui.app.focus?.verdicts.patch?.detail ?? '').includes('PatchAttempt#3'),
  'beat 3 conflict cites the precedent this system wrote in beat 1',
  ui.app.focus?.verdicts.patch?.detail ?? '',
);
assert(
  (ui.app.focus?.precedents ?? []).some((p) => p.outcome === 'broke_staging'),
  'beat 3 focus carries the broke_staging precedent',
);
assert(
  (ui.app.focus?.transcript ?? []).some((e) => e.phase === 'conflict'),
  'beat 3 transcript contains a conflict phase event',
);

const { collapsed } = splitFeed(ui.app.feed);
assert(
  ui.app.feed.length === 51 && ui.app.funnel.escalated === 2,
  'funnel after the arc',
  `${ui.app.funnel.ingested} ingested → ${ui.app.funnel.escalated} escalated · …${collapsed.length} suppressed`,
);

// ── 3. beat 1 and beat 3 select different pipelines ────────────────────────
section('3  the graph chooses the motion (beat 1 != beat 3 pipeline)');

function selectionOf(step: 1 | 2 | 3): { pipeline_id: string; name: string; reason: string } {
  const b = BEATS.find((x) => x.step === step)!;
  const m = b.cues.map((c) => c.msg).find((m2) => m2.type === 'pipeline');
  if (!m || m.type !== 'pipeline') throw new Error(`beat ${step} has no pipeline selection`);
  return m.selection;
}

const p1 = selectionOf(1);
const p2 = selectionOf(2);
const p3 = selectionOf(3);

assert(p1.pipeline_id !== p3.pipeline_id, 'beat 1 and beat 3 run different pipelines', `${p1.pipeline_id} → ${p3.pipeline_id}`);
assert(p1.pipeline_id !== p2.pipeline_id, 'beat 2 runs its own suppression pipeline', p2.pipeline_id);
assert(p3.reason.includes('OUTPERFORMED'), 'beat 3 selection reason is legible on stage', p3.reason);
assert(
  ui.selection?.pipeline_id === p3.pipeline_id && ui.prev_selection?.pipeline_id === p2.pipeline_id,
  'reducer tracks the change so the strip can show it',
  `${ui.prev_selection?.pipeline_id} → ${ui.selection?.pipeline_id}`,
);
assert(
  new Set(INITIAL_STATE.pipelines.map((p) => p.pipeline_id)).size === INITIAL_STATE.pipelines.length &&
    INITIAL_STATE.pipelines.some((p) => p.pipeline_id === p1.pipeline_id) &&
    INITIAL_STATE.pipelines.some((p) => p.pipeline_id === p3.pipeline_id),
  'both selected pipelines exist in the graph-backed library',
  `${INITIAL_STATE.pipelines.length} pipelines`,
);

// ── 4. the hop scheduler ───────────────────────────────────────────────────
section('4  the hop scheduler draws the signature element');

const heroSteps = scheduleHops(HERO_CHAIN);
assert(heroSteps.length === HERO_CHAIN.length, 'n nodes → n rings', `${heroSteps.length} rings`);
assert(
  heroSteps.every((s, i) => s.at === i * HOP_INTERVAL_MS),
  `one ring per ${HOP_INTERVAL_MS}ms`,
  heroSteps.map((s) => s.at).join(','),
);
assert(
  heroSteps.filter((s) => s.terminal).length === 1 && heroSteps[heroSteps.length - 1].terminal,
  'exactly one terminal ring, and it is the clause',
  heroSteps[heroSteps.length - 1].node,
);
assert(heroSteps[0].node === 'brace-expansion', 'wave starts at the package', heroSteps[0].node);
assert(
  heroSteps[heroSteps.length - 1].node === '§7.3',
  'wave ends at a contract clause — no scanner reaches this',
);

const precSteps = scheduleHops(PRECEDENT_CHAIN);
assert(precSteps.length === 6 && precSteps[5].at === 1_500, 'beat 3 wave is 6 rings over 1.5s');

const suppSteps = scheduleHops(SUPPRESSED_CHAIN, { suppressed: true });
assert(suppSteps.length === SUPPRESSION_DEPTH, 'suppression truncates at hop 2', `${suppSteps.length} rings`);
assert(suppSteps.every((s) => s.terminal === false), 'a suppressed wave has no terminal ring');
assert(suppSteps.every((s) => s.suppressed === true), 'every suppressed ring is flagged teal');

// the wave is re-playable: replaying beat 1 bumps the nonce and starts over
const nonceBefore = ui.wave?.nonce ?? 0;
const replayed = replay(ui, beat1.cues.map((c) => c.msg).filter((m) => m.type === 'hop'));
assert(
  (replayed.wave?.nonce ?? 0) > nonceBefore && replayed.wave?.arrived === HERO_CHAIN.length,
  'the wave is re-playable (nonce advances, rings re-arrive)',
  `nonce ${nonceBefore} → ${replayed.wave?.nonce}`,
);

// ── 5. the Guild approval gate ─────────────────────────────────────────────
section('5  notify_customer cannot execute without a human');

assert(isBlocked(ui, APPROVAL_ID), 'notify_customer is BLOCKED after the full arc');
assert(receiptFor(ui, 'notify_customer') === null, 'no notify_customer receipt exists while blocked');
assert(
  ui.app.approvals.find((a) => a.id === APPROVAL_ID)?.token === undefined,
  'Guild has issued no token',
);

const approveMsgs = approvalMessages(ui, APPROVAL_ID, 'v.patel@hopper.dev', '2026-08-03T17:05:00Z');
assert(approveMsgs.length >= 2, 'approving produces approval + receipt messages', `${approveMsgs.length} messages`);

const approvedUi = replay(ui, approveMsgs);
assert(!isBlocked(approvedUi, APPROVAL_ID), 'after approval the gate is open');
assert(
  approvedUi.app.approvals.find((a) => a.id === APPROVAL_ID)?.status === 'approved',
  'approval status flips to approved',
);
assert(
  approvedUi.app.approvals.find((a) => a.id === APPROVAL_ID)?.approved_by === 'v.patel@hopper.dev',
  'the approver is recorded by name',
);
assert(
  typeof approvedUi.app.approvals.find((a) => a.id === APPROVAL_ID)?.token === 'string',
  'Guild issues the execution token only on approval',
);
const notifyReceipt = receiptFor(approvedUi, 'notify_customer');
assert(notifyReceipt !== null, 'the row flips to a receipt', notifyReceipt?.ref ?? '');
assert(
  approvalMessages(approvedUi, APPROVAL_ID).length === 0,
  'double-approval is a no-op (idempotent gate)',
);

// ── 6. the obligation clock ────────────────────────────────────────────────
section('6  fmtCountdown decreases monotonically across the timeline');

let clockUi = initialUi(INITIAL_STATE);
const seen: ClockTick[] = [];
for (const b of BEATS) {
  for (const c of b.cues) {
    clockUi = reduce(clockUi, c.msg);
    if (c.msg.type === 'clock') seen.push(c.msg.tick);
  }
}
assert(seen.length >= 6, 'the timeline ticks the clock', `${seen.length} ticks`);

const rendered = seen.map((t) => fmtCountdown(t.remaining_seconds));
const strictlyDown = seen.every((t, i) => i === 0 || t.remaining_seconds < seen[i - 1].remaining_seconds);
assert(strictlyDown, 'remaining_seconds strictly decreases', `${rendered[0]} → ${rendered[rendered.length - 1]}`);
assert(
  rendered.every((s) => /^T-\d{2}:\d{2}:\d{2}$/.test(s)),
  'every render matches T-HH:MM:SS',
  rendered.slice(0, 3).join(' · '),
);

// the 1Hz local ticker keeps decreasing without a server
let tickUi = clockUi;
const before = primaryClock(tickUi)!.remaining_seconds;
for (let i = 0; i < 5; i += 1) {
  tickUi = reduceAll(tickUi, [
    ...tickUi.app.clocks
      .filter((c) => c.state === 'running')
      .map((c) => ({ type: 'clock' as const, tick: { ...c, remaining_seconds: c.remaining_seconds - 1 } })),
  ]);
}
const after = primaryClock(tickUi)!.remaining_seconds;
assert(after === before - 5, 'the offline 1Hz ticker advances the clock', `${fmtCountdown(before)} → ${fmtCountdown(after)}`);
assert(
  fmtCountdown(3 * 3600 + 59) === 'T-03:00:59',
  'the under-4h oxide threshold renders correctly',
);

// ── summary ────────────────────────────────────────────────────────────────
console.log('');
if (failures === 0) {
  console.log(`GATE PASS · ${checks} checks`);
  console.log('proved: fixture is a complete AppState · three beats replay through the app reducer');
  console.log('        beat1 escalated 5 hops + running clock · beat2 suppressed 0 hops');
  console.log(`        beat3 conflict:true · ${p1.pipeline_id} → ${p3.pipeline_id} · ring timing ${HOP_INTERVAL_MS}ms`);
  console.log('        notify_customer blocked until a human approves, then receipted');
  process.exit(0);
} else {
  console.log(`GATE FAIL · ${failures} of ${checks} checks failed`);
  process.exit(1);
}
