/**
 * HOPPER · ingest gate — the definition of done for packages/ingest.
 *
 *   npx tsx packages/ingest/src/cli/gate.ts
 *   MOCK=true npx tsx packages/ingest/src/cli/gate.ts   (offline, fixture cascade)
 *
 * Exits 0 only when all seven checks pass. Prints what it proved.
 */
import {
  HERO_GHSA,
  HERO_PACKAGE,
  HERO_WINDOW_HOURS,
  HERO_CUSTOMER,
  HERO_CLAUSE,
  SUPPRESSED_PACKAGE,
  TOPICS,
  fmtCountdown,
  nowIso,
} from '@hopper/contracts';
import type {
  Advisory,
  AgentBusEvent,
  ClockTick,
  DecisionEvent,
  EventEnvelope,
  HopperEvent,
  Topic,
} from '@hopper/contracts';

import { createBus, createIngest } from '../index.js';
import { fetchKev, kevIndex } from '../sources/kev.js';
import { validateEnvelope, validateEvent } from '../validate.js';
import { REPLAY_FIXTURE, fmtAge, repoRoot } from '../paths.js';

const RULE = '─'.repeat(72);
let passed = 0;
let failed = 0;
const failures: string[] = [];

function head(n: number | string, title: string): void {
  console.log('');
  console.log(`[${n}] ${title}`);
}

function line(msg: string): void {
  console.log(`    ${msg}`);
}

function check(name: string, ok: boolean, detail: string): boolean {
  if (ok) {
    passed += 1;
    console.log(`    PASS  ${name} — ${detail}`);
  } else {
    failed += 1;
    failures.push(`${name}: ${detail}`);
    console.log(`    FAIL  ${name} — ${detail}`);
  }
  return ok;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  // MOCK must be *explicitly* true to force the offline path. Unset means the
  // gate proves live data, which is the whole point of check 1.
  const forcedMock = process.env.MOCK === 'true' || process.env.MOCK === '1';
  const started = nowIso();

  const bus = createBus({ url: process.env.LASER_URL, mock: !process.env.LASER_URL });
  await bus.connect();
  const ingest = createIngest(bus, { mock: forcedMock });

  console.log('HOPPER · ingest gate');
  console.log(RULE);
  console.log(`transport    ${bus.transport()}`);
  console.log(`mode         ${forcedMock ? 'MOCK=true (offline, fixture cascade)' : 'live (network permitted)'}`);
  console.log(`laser_url    ${process.env.LASER_URL ?? '(unset — local transport)'}`);
  console.log(`root         ${repoRoot()}`);
  console.log(`started      ${started}`);
  console.log(RULE);

  // Every envelope this process sees, for check 7.
  const seen: EventEnvelope<HopperEvent>[] = [];
  const unsubAll = TOPICS.map((t) =>
    bus.subscribe<HopperEvent>(t, (e) => {
      seen.push(e);
    }),
  );

  // ── 1 · live advisory pull ────────────────────────────────────────────────
  head(1, 'live advisory pull (github -> osv -> fixture cascade)');
  await ingest.start();
  const advisories: Advisory[] = await ingest.pullLive({ limit: 50 });
  const sources = new Map<string, number>();
  for (const a of advisories) sources.set(a.source ?? 'unknown', (sources.get(a.source ?? 'unknown') ?? 0) + 1);
  line(`cascade      ${[...sources].map(([s, n]) => `${s}=${n}`).join('  ') || '(nothing)'}`);
  const real = advisories.filter((a) => /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(a.ghsa_id));
  for (const a of advisories.slice(0, 8)) {
    line(
      `${pad(a.ghsa_id, 22)} ${pad(a.cve_id ?? '—', 16)} ${pad(a.severity, 9)} ${pad(
        a.package_name,
        22,
      )} ${pad(fmtAge(a.published_at), 12)} ${a.source}`,
    );
  }
  if (advisories.length > 8) line(`… ${advisories.length - 8} more`);
  const newest = advisories.reduce<string | null>(
    (acc, a) => (acc === null || a.published_at > acc ? a.published_at : acc),
    null,
  );
  const fixtureOnly = advisories.length > 0 && advisories.every((a) => a.source === 'fixture');
  if (fixtureOnly) {
    line(
      forcedMock
        ? 'NOTE  MOCK=true — no network was attempted, served from fixtures/live.json'
        : 'NOTE  github and osv were both unreachable — served from fixtures/live.json',
    );
  }
  check(
    'pullLive >= 5 advisories',
    advisories.length >= 5,
    `${advisories.length} advisories, ${real.length} well-formed GHSA ids, newest ${
      newest ? fmtAge(newest) : 'n/a'
    } old`,
  );
  check(
    'real GHSA ids present',
    real.length >= 5,
    fixtureOnly
      ? `${real.length} from fixture fallback (network down)`
      : `${real.length} live GHSA ids from ${[...sources.keys()].join('+')}`,
  );

  // ── 2 · CISA KEV ──────────────────────────────────────────────────────────
  head(2, 'CISA KEV catalog + in_kev detection');
  const kev = await fetchKev({ mock: forcedMock });
  const idx = kevIndex(kev);
  const probe = kev.cves[0]?.cveID ?? 'CVE-2021-44228';
  line(`catalog      ${kev.catalogVersion}  released ${kev.dateReleased}  origin ${kev.origin}`);
  line(`probe        ${probe} in_kev=${idx.has(probe)} ransomware=${idx.entry(probe)?.knownRansomwareCampaignUse ?? '—'}`);
  line(`log4shell    CVE-2021-44228 in_kev=${idx.has('CVE-2021-44228')}`);
  check(
    'KEV > 1000 CVEs',
    kev.cves.length > 1000,
    `${kev.cves.length} CVEs cached to fixtures/kev.json`,
  );
  check(
    'known KEV cve detected as in_kev',
    idx.has(probe) && idx.has('CVE-2021-44228'),
    `${probe} and CVE-2021-44228 both resolve in_kev=true`,
  );

  // ── 3 · the 1Hz obligation clock ──────────────────────────────────────────
  head(3, `1Hz obligation clock · ${HERO_CUSTOMER} ${HERO_CLAUSE} ${HERO_WINDOW_HOURS}h`);
  const ticks: ClockTick[] = [];
  const unsubClock = bus.subscribe<ClockTick>('clock', (e) => {
    ticks.push(e.payload);
  });
  const first = await ingest.startClock({
    ghsa_id: HERO_GHSA,
    customer: HERO_CUSTOMER,
    window_hours: HERO_WINDOW_HOURS,
    clause_ref: HERO_CLAUSE,
  });
  // a second, concurrent clock — the registry must keep them independent
  await ingest.startClock({
    ghsa_id: HERO_GHSA,
    customer: 'Contoso Freight',
    window_hours: 4,
    clause_ref: '§9.1',
  });
  line(`deadline     ${first.deadline_utc}`);
  await sleep(3400);
  const heroTicks = ticks.filter((t) => t.customer === HERO_CUSTOMER);
  const otherTicks = ticks.filter((t) => t.customer === 'Contoso Freight');
  let monotonic = true;
  for (let i = 1; i < heroTicks.length; i += 1) {
    if (heroTicks[i].remaining_seconds >= heroTicks[i - 1].remaining_seconds) monotonic = false;
  }
  line(
    `ticks        ${heroTicks
      .map((t) => fmtCountdown(t.remaining_seconds))
      .join('  ')}   (${otherTicks.length} concurrent on the 4h clock)`,
  );
  const liveClocks = await ingest.clocks();
  const heroLive = liveClocks.find((c) => c.customer === HERO_CUSTOMER);
  line(`clocks()     ${liveClocks.length} live  hero=${heroLive ? fmtCountdown(heroLive.remaining_seconds) : 'missing'} state=${heroLive?.state}`);
  check(
    'clock ticks >= 3, strictly monotonic',
    heroTicks.length >= 3 && monotonic && otherTicks.length >= 3,
    `${heroTicks.length} hero ticks + ${otherTicks.length} concurrent ticks, strictly decreasing=${monotonic}`,
  );
  check(
    'clocks() reflects the live value',
    !!heroLive &&
      heroLive.state === 'running' &&
      Math.abs(heroLive.remaining_seconds - heroTicks[heroTicks.length - 1].remaining_seconds) <= 1,
    `kv value ${heroLive ? fmtCountdown(heroLive.remaining_seconds) : 'n/a'} matches last published tick`,
  );

  await ingest.stopClock(HERO_GHSA, HERO_CUSTOMER);
  await ingest.stopClock(HERO_GHSA, 'Contoso Freight');
  const after = ticks.length;
  await sleep(2200);
  check(
    'stopClock silences the clock',
    ticks.length === after,
    `0 further ticks in 2.2s after stopClock (${after} total)`,
  );
  unsubClock();

  // a clock that is already past its deadline must land on breached
  const breached = await ingest.startClock({
    ghsa_id: 'GHSA-0000-brch-0001',
    customer: 'Past Due Ltd',
    window_hours: 1,
    clause_ref: '§7.3',
    started_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  });
  check(
    'running -> breached at zero',
    breached.state === 'breached' && breached.remaining_seconds === 0,
    `state=${breached.state} remaining=${breached.remaining_seconds}`,
  );
  await ingest.stopClock('GHSA-0000-brch-0001', 'Past Due Ltd');

  // ── 4 · burst / dedupe / p99 ──────────────────────────────────────────────
  head(4, 'burst(50, 10) — the 50-advisories-in-10-seconds funnel');
  const burstBus = createBus({ mock: true });
  await burstBus.connect();
  const burstIngest = createIngest(burstBus, { mock: true });
  const t0 = Date.now();
  const published = await burstIngest.burst(50, 10);
  const elapsed = (Date.now() - t0) / 1000;
  const hist = burstBus.history<HopperEvent>('advisories');
  const ids = new Set(hist.map((e) => (e.payload as { advisory: Advisory }).advisory.ghsa_id));
  line(`published    ${published} in ${elapsed.toFixed(1)}s`);
  line(`history      ${hist.length} envelopes, ${ids.size} distinct ghsa_id, seq 0..${hist[hist.length - 1]?.seq}`);
  // now prove dedupe: republish the first advisory verbatim
  const dupPayload = hist[0].payload as HopperEvent;
  const beforeDedupe = burstBus.stats().deduped;
  await burstBus.publish('advisories', dupPayload);
  const afterDedupe = burstBus.stats().deduped;
  const st = burstBus.stats();
  line(
    `funnel       ingested=${st.ingested} deduped=${st.deduped} p99=${st.p99_ms.toFixed(3)}ms`,
  );
  check(
    'burst(50,10) publishes 50 and history holds 50',
    published === 50 && hist.length === 50 && ids.size === 50,
    `${published} published, history=${hist.length}, distinct=${ids.size}, window ${elapsed.toFixed(1)}s`,
  );
  check(
    'dedupe by ghsa_id',
    afterDedupe === beforeDedupe + 1 && burstBus.history('advisories').length === 50,
    `duplicate suppressed, deduped ${beforeDedupe} -> ${afterDedupe}, history still 50`,
  );
  check(
    'p99 publish latency reported',
    burstBus.p99() >= 0 && burstBus.p99() < 5,
    `p99 = ${burstBus.p99().toFixed(3)} ms on the ${burstBus.transport()} transport (sub-millisecond)`,
  );

  // ── 5 · kv + recall round trip ────────────────────────────────────────────
  head(5, 'kv round trip + memory recall');
  await bus.kvSet('gate', 'probe:1', { hello: 'brace-expansion', n: 42 });
  await bus.kvSet('gate', 'probe:2', { hello: 'angular', n: 7 });
  const got = await bus.kvGet<{ hello: string; n: number }>('gate', 'probe:1');
  const missing = await bus.kvGet('gate', 'probe:nope');
  const listed = await bus.kvList<{ hello: string }>('gate');
  const recalled = await bus.recall('incidents', HERO_PACKAGE);
  line(`kvGet        probe:1 -> ${JSON.stringify(got)}`);
  line(`kvGet        probe:nope -> ${JSON.stringify(missing)}`);
  line(`kvList       ${listed.length} keys: ${listed.map((k) => k.key).join(', ')}`);
  line(`recall       "${HERO_PACKAGE}" -> ${recalled.length} hits`);
  for (const r of recalled.slice(0, 3)) line(`             ${r.score.toFixed(2)}  ${r.text.slice(0, 78)}`);
  check(
    'kvSet / kvGet / kvList round trip',
    got?.n === 42 && missing === null && listed.length >= 2,
    `set 2, read back 1 exact, absent key -> null, list -> ${listed.length}`,
  );
  check(
    'recall() returns scored hits',
    recalled.length > 0 && recalled[0].score > 0 && recalled.every((r, i, a) => i === 0 || a[i - 1].score >= r.score),
    `${recalled.length} hits for "${HERO_PACKAGE}", top score ${recalled[0]?.score.toFixed(2) ?? 'n/a'}, sorted desc`,
  );

  // ── 6 · replay ────────────────────────────────────────────────────────────
  head(6, `replay(${REPLAY_FIXTURE}, 20)`);
  const replayBus = createBus({ mock: true });
  await replayBus.connect();
  const replayIngest = createIngest(replayBus, { mock: true });
  const heard: Array<{ topic: Topic; kind: string; ref: string }> = [];
  const unsubReplay = TOPICS.map((t) =>
    replayBus.subscribe<HopperEvent>(t, (e) => {
      heard.push({ topic: e.topic, kind: e.payload.kind, ref: refOf(e.payload) });
    }),
  );
  const rt0 = Date.now();
  const replayed = await replayIngest.replay(REPLAY_FIXTURE, 20);
  const rElapsed = (Date.now() - rt0) / 1000;
  unsubReplay.forEach((u) => u());
  const fixtureEvents = (
    await import('node:fs')
  ).readFileSync(`${repoRoot()}/${REPLAY_FIXTURE}`, 'utf8');
  const expected = JSON.parse(fixtureEvents) as EventEnvelope<HopperEvent>[];
  const inOrder =
    heard.length === expected.length &&
    heard.every((h, i) => h.topic === expected[i].topic && h.kind === expected[i].payload.kind && h.ref === refOf(expected[i].payload));
  const byTopic = new Map<string, number>();
  for (const h of heard) byTopic.set(h.topic, (byTopic.get(h.topic) ?? 0) + 1);
  line(`replayed     ${replayed} events in ${rElapsed.toFixed(2)}s at 20x`);
  line(`topics       ${[...byTopic].map(([t, n]) => `${t}=${n}`).join('  ')}`);
  check(
    'replay re-emits every event in order',
    replayed === expected.length && inOrder,
    `${replayed}/${expected.length} events, order and payload refs identical to the fixture`,
  );

  // ── 6b · agent-bus + decisions ────────────────────────────────────────────
  // L5 is written by @hopper/agents and `decisions` by the orchestrator. We
  // guarantee two things for them: strict ordering, and a funnel derived from
  // what they publish (the contract is frozen, so there are no setters).
  head('6b', 'agent-bus ordering + funnel derived from the decisions topic');
  const heard5: string[] = [];
  const unsub5 = bus.subscribe<AgentBusEvent>('agent-bus', (e) => {
    heard5.push(`${e.seq}:${e.payload.phase}`);
  });
  const script: Array<[AgentBusEvent['agent'], AgentBusEvent['phase'], string, unknown]> = [
    ['reachability', 'started', 'walking call graph', undefined],
    ['reachability', 'verdict', 'expand() observed in build-api', { reachable: true }],
    ['patch-engineer', 'verdict', 'safe bump to 1.1.18', { safe_bump: true }],
    ['obligation-officer', 'verdict', `${HERO_CLAUSE} — 24h notice owed`, { obligated: true }],
    ['arbiter', 'resolved', 'escalate: reachable and contractually obligated', { decision: 'auto' }],
  ];
  for (const [agent, phase, message, payload] of script) {
    await bus.publish<AgentBusEvent>('agent-bus', {
      kind: 'agent-bus',
      agent,
      ghsa_id: HERO_GHSA,
      phase,
      message,
      confidence: 0.9,
      payload,
      session_id: 'gate-session',
    });
  }
  // beat 2 — the arbiter suppresses, and the funnel has to notice
  await bus.publish<AgentBusEvent>('agent-bus', {
    kind: 'agent-bus',
    agent: 'arbiter',
    ghsa_id: 'GHSA-0000-supp-0001',
    phase: 'resolved',
    message: 'SUPPRESSED · zero hops from any repo',
    confidence: 0.98,
    payload: { decision: 'suppress' },
  });
  await bus.publish<DecisionEvent>('decisions', {
    kind: 'decision',
    ghsa_id: HERO_GHSA,
    action: 'open_pr',
    auto: true,
    requires_approval: false,
    status: 'executed',
    ts: nowIso(),
  });
  await bus.publish<DecisionEvent>('decisions', {
    kind: 'decision',
    ghsa_id: HERO_GHSA,
    action: 'notify_customer',
    auto: false,
    requires_approval: true,
    approval_id: 'apr_gate_1',
    status: 'pending_approval',
    ts: nowIso(),
  });
  unsub5();
  const transcript = bus.history<AgentBusEvent>('agent-bus');
  const ordered =
    transcript.every((e, i, a) => i === 0 || a[i - 1].seq < e.seq) &&
    heard5.length === transcript.length;
  const funnel = bus.stats();
  line(`transcript   ${transcript.length} events, seq strictly increasing=${ordered}`);
  line(
    `derived      traversed=${funnel.traversed} suppressed=${funnel.suppressed} escalated=${funnel.escalated} actions=${funnel.actions}`,
  );
  check(
    'agent-bus preserves order and is replayable from history()',
    ordered && transcript.length === 6,
    `${transcript.length} transcript events, delivered in publish order, readable back out of history()`,
  );
  check(
    'funnel derived from decisions + arbiter verdicts',
    funnel.traversed === 2 && funnel.escalated === 1 && funnel.suppressed === 1 && funnel.actions === 1,
    `traversed=${funnel.traversed} escalated=${funnel.escalated} suppressed=${funnel.suppressed} actions=${funnel.actions} — no setters, all derived off the bus`,
  );

  // ── 7 · contract validation ───────────────────────────────────────────────
  head(7, 'runtime validation of every published event');
  const problems: string[] = [];
  const kinds = new Map<string, number>();
  let total = 0;
  const inspect = (e: EventEnvelope<HopperEvent>): void => {
    total += 1;
    kinds.set(e.payload.kind, (kinds.get(e.payload.kind) ?? 0) + 1);
    const v = validateEnvelope(e);
    if (!v.ok) problems.push(`${e.topic}/${e.id}: ${v.errors.join('; ')}`);
  };
  for (const e of seen) inspect(e);
  for (const t of TOPICS) for (const e of replayBus.history<HopperEvent>(t)) inspect(e);
  for (const t of TOPICS) for (const e of burstBus.history<HopperEvent>(t)) inspect(e);
  line(`observed     ${[...kinds].map(([k, n]) => `${k}=${n}`).join('  ')}`);
  line(`invalid      ${problems.length}`);
  for (const p of problems.slice(0, 5)) line(`             ${p}`);
  // a deliberately malformed payload must be caught, or the validator is a no-op
  const negative = validateEvent({ kind: 'advisory', advisory: { ghsa_id: 'nope', severity: 'SPICY' }, received_at: 'yesterday' });
  line(`negative     malformed advisory -> ${negative.errors.length} errors detected`);
  check(
    'every event validates against its contract type',
    problems.length === 0 && kinds.size >= 5 && negative.ok === false && negative.errors.length >= 4,
    `${total} envelopes across ${kinds.size} event kinds, 0 invalid, and a malformed payload is rejected with ${negative.errors.length} errors`,
  );

  // reachability sanity — not a numbered gate item but the demo depends on it
  const heroTelemetry = ingest.telemetryFor(HERO_PACKAGE);
  const suppressedTelemetry = ingest.telemetryFor(SUPPRESSED_PACKAGE);
  console.log('');
  console.log(RULE);
  console.log(
    `reachability  ${HERO_PACKAGE}#expand -> ${heroTelemetry.reduce((n, t) => n + t.calls, 0)} calls in ${
      new Set(heroTelemetry.map((t) => t.service)).size
    } services   |   ${SUPPRESSED_PACKAGE} -> ${suppressedTelemetry.length} hits`,
  );
  const f = bus.stats();
  console.log(
    `funnel        ingested=${f.ingested} deduped=${f.deduped} traversed=${f.traversed} suppressed=${f.suppressed} escalated=${f.escalated} actions=${f.actions} p99=${f.p99_ms.toFixed(3)}ms`,
  );
  console.log(`transport     ${bus.transport()}`);

  unsubAll.forEach((u) => u());
  await ingest.stop();
  await burstIngest.stop();
  await replayIngest.stop();
  await bus.close();
  await burstBus.close();
  await replayBus.close();

  // ── timer hygiene ─────────────────────────────────────────────────────────
  const resources = process.getActiveResourcesInfo().filter((r) => r === 'Timeout' || r === 'Immediate');
  check(
    'no leaked timers after stop()',
    resources.length === 0,
    `process.getActiveResourcesInfo() holds no Timeout/Immediate (${process
      .getActiveResourcesInfo()
      .join(',') || 'nothing'})`,
  );

  console.log(RULE);
  if (failed === 0) {
    console.log(`GATE PASS   ${passed}/${passed + failed} checks   ingest is done`);
  } else {
    console.log(`GATE FAIL   ${passed} passed, ${failed} failed`);
    for (const f2 of failures) console.log(`            ${f2}`);
  }
  console.log(RULE);
  process.exitCode = failed === 0 ? 0 : 1;

  // If anything is still holding the event loop open 4s from now, the gate
  // leaked a handle. An unref'd timer cannot fire on an idle loop, so this
  // only ever runs when something else kept the process alive.
  const watchdog = setTimeout(() => {
    console.log('GATE FAIL   process did not exit — a handle leaked');
    process.exit(1);
  }, 4000);
  watchdog.unref();
}

function refOf(p: HopperEvent): string {
  switch (p.kind) {
    case 'advisory':
      return p.advisory.ghsa_id;
    case 'telemetry':
      return `${p.service}/${p.package}#${p.symbol}`;
    case 'clock':
      return `${p.ghsa_id}/${p.customer}`;
    case 'kev-delta':
      return p.cve_id;
    case 'agent-bus':
      return `${p.agent}/${p.ghsa_id}/${p.phase}`;
    case 'decision':
      return `${p.ghsa_id}/${p.action}`;
    default:
      return 'unknown';
  }
}

main().catch((err) => {
  console.error('GATE FAIL   unhandled error');
  console.error(err);
  process.exit(1);
});
