/**
 * HOPPER — @hopper/agents gate.
 *
 * The definition of done for the Guild slice. Exits 0 only if every claim below
 * is proved against real code paths. Run: npx tsx packages/agents/src/cli/gate.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_APPROVER,
  isoPlusHours,
  type AgentBusEvent,
  type AgentRunResult,
} from '@hopper/contracts';

import { createAgents } from '../index.js';
import { StubGraph } from '../testing/graph-stub.js';
import { StubBus } from '../testing/bus-stub.js';
import {
  autoInput,
  beat1Input,
  beat3Input,
  suppressedInput,
  SENTINEL_GITHUB_TOKEN,
} from '../testing/fixtures.js';
import {
  validateArbiter,
  validateObligation,
  validatePatch,
  validateReachability,
} from '../validate.js';

// ─── harness ────────────────────────────────────────────────────────────────

let failures = 0;
const lines: string[] = [];

function say(s = ''): void {
  lines.push(s);
  console.log(s);
}

function rule(): void {
  say('─'.repeat(78));
}

function assert(ok: boolean, claim: string): void {
  if (!ok) failures += 1;
  say(`  ${ok ? 'PASS' : 'FAIL'}  ${claim}`);
}

function section(n: number, title: string): void {
  say('');
  say(`[${n}/9] ${title}`);
}

function block(label: string, body: string): void {
  say('');
  say(`  ${label}`);
  for (const l of body.split('\n')) say(`    ${l}`);
}

function verdictLine(v: Record<string, unknown>): string {
  return JSON.stringify(v, null, 2);
}

function phases(t: AgentBusEvent[]): string[] {
  return t.map((e) => `${e.agent}/${e.phase}`);
}

// ─── run ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  say('HOPPER · @hopper/agents · Guild control plane gate');
  rule();
  say(`mock          : true (deterministic, offline)`);
  say(`guild sdk     : @guild-ai/sdk is not published (npm 404) — local control plane`);
  say(`anthropic sdk : loaded only when MOCK=false and ANTHROPIC_API_KEY is set`);
  rule();

  const graph = new StubGraph();
  const bus = new StubBus();
  const agents = createAgents({
    mock: true,
    graph,
    bus,
    credentials: { GITHUB_TOKEN: SENTINEL_GITHUB_TOKEN, SLACK_WEBHOOK: 'https://hooks.invalid/T000/B000/xxxxSENTINELxxxx' },
  });

  const beat1 = await agents.run(beat1Input());
  const hero = await agents.run(beat3Input()); // fresh broke_staging precedent
  const supp = await agents.run(suppressedInput());
  const auto = await agents.run(autoInput());

  // ── 1. strict schema validity ────────────────────────────────────────────
  section(1, 'all four agents return contract-valid verdicts');
  for (const [name, r] of [
    ['beat 1 · brace-expansion', beat1],
    ['hero  · minimatch', hero],
    ['beat 2 · @angular/compiler', supp],
    ['auto  · internal', auto],
  ] as Array<[string, AgentRunResult]>) {
    const results = [
      validateReachability(r.reachability),
      validatePatch(r.patch),
      validateObligation(r.obligation),
      validateArbiter(r.arbiter),
    ];
    const bad = results.flatMap((x) => (x.ok ? [] : x.errors));
    assert(bad.length === 0, `${name}: 4/4 verdicts pass strict validation${bad.length ? ` — ${bad.join('; ')}` : ''}`);
  }

  block('hero · G1 reachability', verdictLine(hero.reachability as unknown as Record<string, unknown>));
  block('hero · G2 patch-engineer', verdictLine(hero.patch as unknown as Record<string, unknown>));
  block('hero · G3 obligation-officer', verdictLine(hero.obligation as unknown as Record<string, unknown>));
  block('hero · G4 arbiter', verdictLine(hero.arbiter as unknown as Record<string, unknown>));

  // ── 2. staged disagreement ───────────────────────────────────────────────
  section(2, 'G5 staged disagreement — conflict arises from precedent recency');
  assert(hero.arbiter.conflict === true, 'arbiter.conflict === true');
  assert(hero.conflict === true, 'run result surfaces conflict === true');
  assert(
    hero.arbiter.conflict_between.includes('reachability') &&
      hero.arbiter.conflict_between.includes('patch-engineer'),
    `conflict_between names both parties: [${hero.arbiter.conflict_between.join(', ')}]`,
  );
  assert(hero.arbiter.decision === 'human', `arbiter escalates to human (decision=${hero.arbiter.decision})`);
  assert(hero.reachability.reachable === true, 'reachability says the symbol is live');
  assert(hero.patch.safe_bump === false && hero.patch.breaking_risk === 'high', 'patch engineer refuses the bump at high risk');
  assert(hero.patch.precedent_ids.length > 0, `patch verdict cites precedent ${hero.patch.precedent_ids.join(', ')}`);
  assert(
    /\b90 seconds ago\b/.test(hero.patch.rationale) && /staging/i.test(hero.patch.rationale),
    'patch rationale states plainly that the bump was 90 seconds ago and staging broke',
  );
  assert(
    beat1.arbiter.conflict === false,
    'no conflict when the precedent is old and successful (beat 1) — not a hardcoded advisory branch',
  );
  block('conflict sentence', hero.arbiter.rationale);

  // ── 3. suppression ───────────────────────────────────────────────────────
  section(3, 'zero hop paths — suppression, no approval');
  assert(supp.reachability.reachable === false, 'reachability reachable === false');
  assert(supp.reachability.confidence >= 0.9, `high confidence on the absence proof (${supp.reachability.confidence})`);
  assert(supp.arbiter.decision === 'suppress', `arbiter decision === suppress`);
  assert(supp.arbiter.actions.length === 0, 'no actions proposed');
  assert(supp.approvals.length === 0, 'no approval requested');
  block('suppression rationale', supp.reachability.rationale);

  // ── 4. obligation arithmetic and notice draft ────────────────────────────
  section(4, 'G3 obligation — deadline arithmetic and drafted notice');
  const ob = beat1.obligation;
  const adv = beat1Input().advisory;
  const clause = ob.clauses[0];
  assert(ob.obligated === true, 'obligated === true');
  assert(!!clause, 'at least one clause resolved from the contract subgraph');
  const expected = isoPlusHours(clause.hours, new Date(adv.published_at));
  assert(clause.deadline_utc === expected, `deadline_utc === published_at + ${clause.hours}h (${expected})`);
  assert(ob.deadline_utc === expected, 'verdict deadline_utc is the tightest clause window');
  assert(ob.notice_draft.trim().length > 0, 'notice_draft is non-empty');
  assert(ob.notice_draft.includes(clause.customer), `notice names the customer (${clause.customer})`);
  assert(ob.notice_draft.includes(clause.clause_ref), `notice names the clause (${clause.clause_ref})`);
  assert(ob.notice_draft.includes(expected), 'notice carries the real ISO deadline');
  assert(!!adv.cve_id && ob.notice_draft.includes(adv.cve_id), `notice names the CVE (${adv.cve_id})`);
  assert(
    ob.clauses.every((c, i) => i === 0 || c.deadline_utc >= ob.clauses[i - 1].deadline_utc),
    'clauses sorted by tightest window first',
  );
  block('drafted customer notice', ob.notice_draft);

  // ── 5. HITL ──────────────────────────────────────────────────────────────
  section(5, 'G6 human-in-the-loop — no token without an approval');
  const pend = agents.pendingApprovals();
  const notify = pend.find((a) => a.action === 'notify_customer' && a.ghsa_id === beat1.ghsa_id);
  assert(!!notify, 'notify_customer action created an approval request');
  if (!notify) throw new Error('gate cannot continue without the approval request');
  assert(notify.status === 'pending', `status === pending`);
  assert(agents.approval(notify.id)?.token === undefined, 'approval(id).token is undefined while pending');

  // tampering with the returned copy must not mint a token in the store
  (notify as { token?: string }).token = 'forged';
  assert(agents.approval(notify.id)?.token === undefined, 'store returns copies — a forged token on the caller copy does not persist');

  const approved = await agents.approve(notify.id, DEFAULT_APPROVER);
  assert(approved.status === 'approved', 'after approve(): status === approved');
  assert(approved.approved_by === DEFAULT_APPROVER, `approved_by === ${DEFAULT_APPROVER}`);
  assert(!!approved.decided_at, 'decided_at stamped');
  assert(typeof approved.token === 'string' && approved.token.length > 0, `token minted only now (${approved.token})`);

  const heroNotify = agents.pendingApprovals().find((a) => a.ghsa_id === hero.ghsa_id && a.action === 'notify_customer');
  assert(!!heroNotify, 'second approval available to reject');
  if (heroNotify) {
    const rejected = await agents.reject(heroNotify.id, DEFAULT_APPROVER);
    assert(rejected.status === 'rejected', 'after reject(): status === rejected');
    assert(rejected.token === undefined, 'no token minted on rejection');
    assert(agents.approval(heroNotify.id)?.token === undefined, 'and none appears in the store afterwards');
    let threw = false;
    try {
      await agents.approve(heroNotify.id, DEFAULT_APPROVER);
    } catch {
      threw = true;
    }
    assert(threw, 'a decided request cannot be re-approved into a token');
  }

  const mintSites = auditTokenMintSites();
  assert(
    mintSites.offRegion.length === 0,
    `static audit: every token write lives inside the guarded mint region of guild.ts (${mintSites.inRegion.length} write(s), 0 elsewhere)`,
  );
  if (mintSites.offRegion.length > 0) {
    for (const s of mintSites.offRegion) say(`        unguarded token write: ${s}`);
  }
  assert(mintSites.regionInsideApprove, 'the mint region is lexically inside Approvals.approve()');

  // ── 6. credential containment ────────────────────────────────────────────
  section(6, 'G7 credentials — values never enter agent context, transcript or verdict');
  const serialised = JSON.stringify([beat1, hero, supp, auto]);
  assert(!serialised.includes(SENTINEL_GITHUB_TOKEN), 'sentinel absent from every AgentRunResult serialisation');
  const allTranscripts = JSON.stringify([
    agents.transcript(beat1.ghsa_id),
    agents.transcript(hero.ghsa_id),
    agents.transcript(supp.ghsa_id),
    agents.transcript(auto.ghsa_id),
  ]);
  assert(!allTranscripts.includes(SENTINEL_GITHUB_TOKEN), 'sentinel absent from every transcript');
  const traces = JSON.stringify(
    await Promise.all([beat1, hero, supp, auto].map((r) => agents.sessionTrace(r.session_id))),
  );
  assert(!traces.includes(SENTINEL_GITHUB_TOKEN), 'sentinel absent from every session trace');
  assert(!JSON.stringify(graph.verdicts).includes(SENTINEL_GITHUB_TOKEN), 'sentinel absent from graph dual-writes');
  assert(!JSON.stringify(bus.published).includes(SENTINEL_GITHUB_TOKEN), 'sentinel absent from the agent-bus topic');
  assert(!JSON.stringify(agents.pendingApprovals()).includes(SENTINEL_GITHUB_TOKEN), 'sentinel absent from approval bodies');
  assert((await agents.credential('GITHUB_TOKEN')) === SENTINEL_GITHUB_TOKEN, 'credential("GITHUB_TOKEN") still resolves the real value');
  assert((await agents.credential('NOPE')) === null, 'unknown credential resolves to null');
  assert(
    beat1.patch.rationale.includes('GITHUB_TOKEN') || bus.published.some((e) => e.message.includes('GITHUB_TOKEN')),
    'the run genuinely touched GITHUB_TOKEN by name (presence, never value)',
  );

  // ── 7. session trace ─────────────────────────────────────────────────────
  section(7, 'G8 session traces are readable back out');
  const trace = await agents.sessionTrace(hero.session_id);
  assert(trace.length >= 8, `sessionTrace() returns ${trace.length} events (>= 8)`);
  const order = phases(trace);
  const expectedOrder = [
    'reachability/started',
    'reachability/verdict',
    'patch-engineer/started',
    'patch-engineer/verdict',
    'obligation-officer/started',
    'obligation-officer/verdict',
    'arbiter/started',
    'arbiter/conflict',
    'arbiter/verdict',
    'arbiter/resolved',
  ];
  assert(order.join(' → ') === expectedOrder.join(' → '), 'events are ordered: ' + order.join(' → '));
  assert(trace.every((e) => e.session_id === hero.session_id), 'every event carries its session id');
  assert((await agents.sessionTrace('no-such-session')).length === 0, 'unknown session id returns an empty trace, not a throw');

  // ── 8. dual write ────────────────────────────────────────────────────────
  section(8, 'G8 dual-write — every verdict also lands in the graph');
  const heroVerdicts = graph.verdicts.filter((v) => v.ghsa_id === hero.ghsa_id);
  assert(heroVerdicts.length === 4, `recordVerdict() called ${heroVerdicts.length} times for the hero advisory`);
  for (const a of ['reachability', 'patch-engineer', 'obligation-officer', 'arbiter']) {
    const v = heroVerdicts.find((x) => x.agent === a);
    assert(!!v, `  ${a} → AgentVerdict{verdict=${v?.verdict ?? '-'}, confidence=${v?.confidence ?? '-'}}`);
  }
  assert(graph.verdicts.length === 16, `16 verdicts dual-written across 4 runs (${graph.verdicts.length})`);
  assert(
    bus.published.filter((e) => e.ghsa_id === hero.ghsa_id).length === trace.length,
    'the agent-bus topic received exactly the session trace',
  );

  // ── 9. determinism ───────────────────────────────────────────────────────
  section(9, 'determinism in MOCK');
  const solo = createAgents({ mock: true });
  const a1 = await solo.run(beat3Input());
  const a2 = await solo.run(beat3Input());
  const strip = (r: AgentRunResult) =>
    JSON.stringify({ r: r.reachability, p: r.patch, o: r.obligation, a: r.arbiter });
  assert(strip(a1) === strip(a2), 'identical input produces byte-identical verdicts');
  assert(a1.session_id !== a2.session_id, 'but each run still gets its own session id');
  assert(
    strip(a1) === strip({ ...hero } as AgentRunResult),
    'and the standalone instance agrees with the graph/bus-injected instance',
  );

  // ── verdict ──────────────────────────────────────────────────────────────
  say('');
  rule();
  if (failures === 0) {
    say('GATE PASS · 9/9');
    say('  four graph-grounded agents, strict schemas, staged disagreement from data,');
    say('  Guild-compatible sessions + credentials + HITL approvals, dual-write to graph.');
    rule();
    process.exit(0);
  } else {
    say(`GATE FAIL · ${failures} assertion(s) failed`);
    rule();
    process.exit(1);
  }
}

// ─── static audit: no token can exist without an approval ───────────────────

/**
 * Reads our own source and proves that the string `token` is only ever *written*
 * inside the guarded region of Approvals.approve(). A runtime test can only show
 * that the paths we thought of do not mint tokens; this shows no other path exists.
 */
function auditTokenMintSites(): {
  inRegion: string[];
  offRegion: string[];
  regionInsideApprove: boolean;
} {
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'cli' || entry === 'testing') continue;
        walk(full);
      } else if (entry.endsWith('.ts')) {
        files.push(full);
      }
    }
  };
  walk(srcRoot);

  const WRITE = /(?<![\w_])token\s*[:=](?!=)/;
  const inRegion: string[] = [];
  const offRegion: string[] = [];
  let regionInsideApprove = false;

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const src = text.split('\n');
    const start = src.findIndex((l) => l.includes('TOKEN MINT REGION · BEGIN'));
    const end = src.findIndex((l) => l.includes('TOKEN MINT REGION · END'));
    if (start >= 0 && end > start) {
      const before = src.slice(0, start).join('\n');
      const lastApprove = before.lastIndexOf('approve(');
      const lastClose = before.lastIndexOf('\n  }');
      regionInsideApprove = lastApprove > lastClose;
    }
    src.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      if (!WRITE.test(code)) return;
      // type declarations are not writes
      if (/token(\?)?\s*:\s*(string|undefined|boolean|number)/.test(code)) return;
      const where = `${path.relative(srcRoot, file)}:${i + 1}`;
      if (start >= 0 && i > start && i < end) inRegion.push(where);
      else offRegion.push(where);
    });
  }
  return { inRegion, offRegion, regionInsideApprove };
}

main().catch((err) => {
  console.error('');
  console.error('GATE ERROR');
  console.error(err);
  process.exit(1);
});
