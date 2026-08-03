/**
 * npm run pull-live
 *
 * Pulls real advisories (github, cascading to OSV across SEED_ROOTS plus the
 * brace-expansion -> minimatch -> glob chain), merges CISA KEV, and writes:
 *
 *   fixtures/live.json    Advisory[]        — what the graph gets seeded from
 *   fixtures/replay.json  EventEnvelope[]   — the whole demo arc, no network
 *   fixtures/kev.json     KevCatalog        — 1,600+ confirmed-exploited CVEs
 *
 * Then prints what it pulled, from where, and how old the newest one is.
 */
import {
  HERO_ADVISORY,
  HERO_CLAUSE,
  HERO_CUSTOMER,
  HERO_GHSA,
  HERO_PACKAGE,
  HERO_WINDOW_HOURS,
  PRECEDENT_ADVISORY,
  SUPPRESSED_ADVISORY,
  isoPlusHours,
  id as mkId,
} from '@hopper/contracts';
import type {
  Advisory,
  AdvisoryEvent,
  ClockTick,
  EventEnvelope,
  HopperEvent,
  KevDeltaEvent,
  TelemetryEvent,
  Topic,
} from '@hopper/contracts';

import { createBus } from '../index.js';
import { HopperIngest, OSV_PACKAGES, syntheticAdvisory } from '../ingest.js';
import { TelemetrySimulator } from '../telemetry.js';
import { LIVE_FIXTURE, REPLAY_FIXTURE, KEV_FIXTURE, fmtAge, writeJson } from '../paths.js';
import { validateEnvelope } from '../validate.js';

const RULE = '─'.repeat(72);

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function rpad(n: number | string, width: number): string {
  const s = String(n);
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

async function main(): Promise<void> {
  const forcedMock = process.env.MOCK === 'true' || process.env.MOCK === '1';
  const limit = Number(process.env.PULL_LIMIT ?? 50);

  const bus = createBus({ mock: true }); // fixture authoring never needs a remote bus
  await bus.connect();
  const ingest = new HopperIngest(bus, { mock: forcedMock });

  console.log('HOPPER · pull-live');
  console.log(RULE);
  console.log(`mode         ${forcedMock ? 'MOCK=true (offline)' : 'live'}`);
  console.log(`packages     ${OSV_PACKAGES.join(', ')}`);
  console.log(RULE);

  const report = await ingest.pullLiveReport({ limit });
  for (const note of report.notes) console.log(`  ${note}`);

  const advisories = report.advisories;
  const kev = await ingest.kevCatalog();

  // ── fixtures/live.json ───────────────────────────────────────────────────
  const livePath = writeJson(LIVE_FIXTURE, advisories);

  // ── fixtures/replay.json ─────────────────────────────────────────────────
  const replay = buildReplay(advisories);
  const replayPath = writeJson(REPLAY_FIXTURE, replay);
  const invalid = replay.filter((e) => !validateEnvelope(e).ok);

  const span =
    replay.length > 1
      ? (Date.parse(replay[replay.length - 1].ts) - Date.parse(replay[0].ts)) / 1000
      : 0;
  const byTopic = new Map<Topic, number>();
  for (const e of replay) byTopic.set(e.topic, (byTopic.get(e.topic) ?? 0) + 1);

  // ── the institutional summary ────────────────────────────────────────────
  console.log(RULE);
  const bySource = Object.entries(report.bySource)
    .map(([s, n]) => `${s}=${n}`)
    .join('  ');
  console.log(`advisories   ${rpad(advisories.length, 5)}   ${bySource}   primary source: ${report.primary}`);
  console.log(`in KEV       ${rpad(report.kev_matches, 5)}   of ${kev.cves.length} confirmed-exploited CVEs (catalog ${kev.catalogVersion}, ${kev.origin})`);
  if (report.newest) {
    const newest = advisories.find((a) => a.published_at === report.newest);
    console.log(
      `newest       ${rpad(fmtAge(report.newest), 5)}   ${newest?.ghsa_id ?? ''} ${newest?.package_name ?? ''} — published ${report.newest}`,
    );
  }
  const sev = new Map<string, number>();
  for (const a of advisories) sev.set(a.severity, (sev.get(a.severity) ?? 0) + 1);
  console.log(
    `severity     ${['CRITICAL', 'HIGH', 'MODERATE', 'LOW']
      .map((s) => `${s.toLowerCase()}=${sev.get(s) ?? 0}`)
      .join('  ')}`,
  );
  const heroLive = advisories.find((a) => a.package_name === HERO_PACKAGE);
  console.log(
    `hero chain   ${heroLive ? `${heroLive.ghsa_id} ${HERO_PACKAGE} ${heroLive.severity} cvss ${heroLive.cvss}` : `${HERO_PACKAGE} not in this pull (demo advisory still seeded)`}`,
  );
  console.log(RULE);
  console.log(`wrote        ${pad(LIVE_FIXTURE, 22)} ${rpad(advisories.length, 5)} advisories`);
  console.log(
    `wrote        ${pad(REPLAY_FIXTURE, 22)} ${rpad(replay.length, 5)} events over ${span.toFixed(1)}s   ${[...byTopic]
      .map(([t, n]) => `${t}=${n}`)
      .join(' ')}`,
  );
  console.log(`wrote        ${pad(KEV_FIXTURE, 22)} ${rpad(kev.cves.length, 5)} CVEs`);
  console.log(`validated    ${replay.length - invalid.length}/${replay.length} envelopes pass the contract`);
  for (const e of invalid.slice(0, 3)) console.log(`  INVALID ${e.topic} ${validateEnvelope(e).errors.join('; ')}`);
  console.log(RULE);
  console.log(`paths        ${livePath}`);
  console.log(`             ${replayPath}`);

  await ingest.stop();
  await bus.close();
  process.exitCode = invalid.length === 0 && advisories.length > 0 ? 0 : 1;
}

/**
 * The full demo arc as a timestamped envelope list:
 *   beat 1  the hit        hero advisory + reachability telemetry + clock
 *   beat 2  the restraint  suppressed advisory (no telemetry — that is the point)
 *   beat 3  memory         precedent advisory
 *   then    the funnel     50 advisories over 10 seconds
 */
function buildReplay(live: Advisory[]): EventEnvelope<HopperEvent>[] {
  const out: EventEnvelope<HopperEvent>[] = [];
  const t0 = Date.now();
  let seq = 0;

  const push = (topic: Topic, offsetMs: number, payload: HopperEvent): void => {
    out.push({
      id: mkId('evt'),
      topic,
      ts: new Date(t0 + offsetMs).toISOString(),
      seq,
      payload,
    });
    seq += 1;
  };

  const advisoryEvent = (a: Advisory, offsetMs: number): AdvisoryEvent => ({
    kind: 'advisory',
    advisory: a,
    received_at: new Date(t0 + offsetMs).toISOString(),
  });

  // beat 1 — the hit
  push('advisories', 0, advisoryEvent(HERO_ADVISORY, 0));

  // L2 — the reachability signal, hero package first
  const sim = new TelemetrySimulator(createBus({ mock: true }));
  const telemetry: TelemetryEvent[] = sim.sample();
  const heroFirst = [
    ...telemetry.filter((t) => t.package === HERO_PACKAGE),
    ...telemetry.filter((t) => t.package !== HERO_PACKAGE),
  ];
  heroFirst.forEach((t, i) => push('telemetry', 400 + i * 45, t));

  // L3 — the clock the room watches
  const clockStart = 1400;
  const deadline = isoPlusHours(HERO_WINDOW_HOURS, new Date(t0 + clockStart));
  const total = HERO_WINDOW_HOURS * 3600;
  for (let i = 0; i < 6; i += 1) {
    const tick: ClockTick = {
      kind: 'clock',
      customer: HERO_CUSTOMER,
      ghsa_id: HERO_GHSA,
      deadline_utc: deadline,
      remaining_seconds: total - i,
      window_hours: HERO_WINDOW_HOURS,
      clause_ref: HERO_CLAUSE,
      state: 'running',
    };
    push('clock', clockStart + i * 1000, tick);
  }

  // L4 — the hero CVE lands in KEV mid-arc. Same bug, new world.
  const kevDelta: KevDeltaEvent = {
    kind: 'kev-delta',
    cve_id: HERO_ADVISORY.cve_id ?? 'CVE-2026-69152',
    ghsa_id: HERO_GHSA,
    added_at: new Date(t0 + 7200).toISOString(),
    known_ransomware: false,
    action: 'escalate',
  };
  push('kev-delta', 7200, kevDelta);

  // beat 2 — the restraint. No telemetry for @angular/compiler, deliberately.
  push('advisories', 8200, advisoryEvent(SUPPRESSED_ADVISORY, 8200));

  // beat 3 — memory
  push('advisories', 9600, advisoryEvent(PRECEDENT_ADVISORY, 9600));

  // the funnel — 50 advisories in 10 seconds, 2 survive
  const burst: Advisory[] = [];
  for (let i = 0; i < 50; i += 1) burst.push(syntheticAdvisory(i));
  // seed a few real ones from this pull so the burst is not entirely synthetic
  live
    .filter((a) => !DEMO_IDS.has(a.ghsa_id))
    .slice(0, 6)
    .forEach((a, i) => {
      burst[i * 8] = a;
    });
  burst.forEach((a, i) => {
    const at = 11_000 + Math.round((i * 10_000) / burst.length);
    push('advisories', at, advisoryEvent(a, at));
  });

  return out;
}

const DEMO_IDS = new Set([
  HERO_ADVISORY.ghsa_id,
  SUPPRESSED_ADVISORY.ghsa_id,
  PRECEDENT_ADVISORY.ghsa_id,
]);

main().catch((err) => {
  console.error('pull-live failed');
  console.error(err);
  process.exit(1);
});
