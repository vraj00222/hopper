/**
 * @hopper/ingest — the producer side. Implements IngestPort.
 *
 * Six topics, one cascade, zero credentials:
 *   advisories  github -> osv -> fixtures/live.json
 *   telemetry   simulator (the reachability signal)
 *   clock       1Hz obligation countdown, state in kv
 *   kev-delta   CISA KEV poll, diffed
 *   agent-bus   owned by @hopper/agents; we guarantee ordering + replayability
 *   decisions   owned by the orchestrator; we fold it into the funnel
 */
import {
  HERO_ADVISORY,
  PRECEDENT_ADVISORY,
  SEED_ROOTS,
  SUPPRESSED_ADVISORY,
  isMock,
  nowIso,
  sleep,
} from '@hopper/contracts';
import type {
  Advisory,
  AdvisoryEvent,
  ClockTick,
  EventBusPort,
  EventEnvelope,
  HopperEvent,
  IngestPort,
  Severity,
  TelemetryEvent,
  Topic,
} from '@hopper/contracts';

import { busInternals } from './bus/local.js';
import { ClockRegistry, type ClockInput } from './clock.js';
import { LIVE_FIXTURE, fixturePath, readJson } from './paths.js';
import { fetchGithubAdvisories } from './sources/github.js';
import { diffKev, fetchKev, kevIndex, type KevCatalog, type KevIndex } from './sources/kev.js';
import { queryOsv } from './sources/osv.js';
import { TelemetrySimulator } from './telemetry.js';

import { readFileSync } from 'node:fs';

/** the packages the demo graph is seeded from, plus the transitive hero chain */
export const OSV_PACKAGES: readonly string[] = [
  ...SEED_ROOTS,
  'brace-expansion',
  'minimatch',
  'glob',
];

export const DEMO_ADVISORIES: readonly Advisory[] = [
  HERO_ADVISORY,
  SUPPRESSED_ADVISORY,
  PRECEDENT_ADVISORY,
];

export interface IngestOptions {
  mock?: boolean;
  onAdvisory?: (a: Advisory) => void;
}

export interface PullReport {
  advisories: Advisory[];
  primary: 'github' | 'osv' | 'fixture' | 'demo';
  bySource: Record<string, number>;
  kev_matches: number;
  kev_count: number;
  newest: string | null;
  notes: string[];
}

/**
 * The burst pool — and why it is what it is.
 *
 * The funnel demo says "50 advisories in 10 seconds, 2 survive". That number
 * has to be earned by the graph, not rigged by the generator, so the pool has
 * to reflect the real shape of the problem: an estate of six repos is untouched
 * by the overwhelming majority of CVEs published against npm. Suppression is
 * the product; a burst that mostly escalates is a burst that lies.
 *
 * Every name below is a real, well-known npm package that is genuinely ABSENT
 * from the seeded dependency closure (the 450 packages reachable from express,
 * next, webpack, jest, eslint and axios in fixtures/depsdev.json). They are
 * drawn from unrelated corners of the JS world — Angular, Vue, Svelte,
 * Electron, the ORMs, the CMSs, the game and dataviz stacks — precisely because
 * this estate does not use them. Verified by cross-checking the closure, and
 * the gate re-checks it so the property survives a later edit.
 *
 * `@angular/compiler` is deliberately excluded: it is the beat-2 suppression
 * case and owns its own advisory.
 */
export const BURST_ABSENT_PACKAGES = [
  '@angular/core',
  '@angular/router',
  '@angular/forms',
  '@angular/platform-browser',
  'vue',
  'vue-router',
  'pinia',
  'nuxt',
  'svelte',
  '@sveltejs/kit',
  'electron',
  'electron-builder',
  'gatsby',
  '@strapi/strapi',
  '@nestjs/core',
  '@nestjs/common',
  'prisma',
  '@prisma/client',
  'sequelize',
  'typeorm',
  'mongoose',
  'knex',
  'puppeteer',
  'playwright',
  'cypress',
  '@storybook/react',
  '@ionic/angular',
  'parse-server',
  'sails',
  '@feathersjs/feathers',
  '@loopback/core',
  '@adonisjs/core',
  '@redwoodjs/router',
  'ember-source',
  'backbone',
  'preact',
  'lit',
  'solid-js',
  'koa',
  'fastify',
  'socket.io',
  'ioredis',
  'bullmq',
  'nodemailer',
  'passport',
  'stripe',
  'firebase-admin',
  'three',
  'd3',
  'chart.js',
  'leaflet',
  'phaser',
  'moment',
  'luxon',
  'ramda',
  'rxjs',
  'mobx',
  'redux',
  '@apollo/client',
  'tailwindcss',
  'bootstrap',
  'handlebars',
  'contentful',
  'directus',
] as const;

/**
 * The handful that genuinely land. Both are inside the seeded closure AND have
 * telemetry hits in src/telemetry.ts, so they survive the hop walk and the
 * reachability check honestly rather than by construction.
 */
export const BURST_SURVIVOR_PACKAGES = ['glob', 'express'] as const;

/** "50 advisories in 10 seconds, 2 survive" — the number the demo says out loud */
export const BURST_SURVIVORS = 2;

const BURST_SEVERITIES: Severity[] = ['LOW', 'MODERATE', 'MODERATE', 'HIGH', 'HIGH', 'CRITICAL'];

/**
 * Which package each advisory in a burst of `n` is about. Survivors are spread
 * through the run rather than bunched at the front, so the funnel narrows on
 * screen instead of resolving in the first second.
 */
export function burstPlan(n: number, survivors: number = BURST_SURVIVORS): string[] {
  const wanted = Math.max(0, Math.min(survivors, n, BURST_SURVIVOR_PACKAGES.length));
  const plan: string[] = [];
  for (let i = 0; i < n; i += 1) {
    plan.push(BURST_ABSENT_PACKAGES[i % BURST_ABSENT_PACKAGES.length]);
  }
  for (let k = 0; k < wanted; k += 1) {
    const at = Math.min(n - 1, Math.round(((k + 1) * n) / (wanted + 1)));
    plan[at] = BURST_SURVIVOR_PACKAGES[k];
  }
  return plan;
}
const ID_ALPHABET = '23456789cfghjmpqrvwx';

let burstCounter = 0;

export class HopperIngest implements IngestPort {
  private readonly clocks_: ClockRegistry;
  private readonly telemetry: TelemetrySimulator;
  private readonly trackedCves = new Map<string, string>();
  private kev: KevCatalog | null = null;
  private kevIdx: KevIndex | null = null;
  private kevTimer: NodeJS.Timeout | null = null;
  private running = false;
  private lastPull: PullReport | null = null;

  constructor(
    private readonly bus: EventBusPort,
    private readonly opts: IngestOptions = {},
  ) {
    this.telemetry = new TelemetrySimulator(bus);
    this.clocks_ = new ClockRegistry(bus);
  }

  private get mock(): boolean {
    return this.opts.mock ?? isMock();
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.telemetry.emit();
    this.telemetry.start();
    // KEV load is best effort and must never block the demo starting
    void this.pollKev().catch(() => undefined);
    if (!this.mock) {
      this.kevTimer = setInterval(() => {
        void this.pollKev().catch(() => undefined);
      }, 300_000);
      this.kevTimer.unref();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.telemetry.stop();
    if (this.kevTimer) {
      clearInterval(this.kevTimer);
      this.kevTimer = null;
    }
    await this.clocks_.stopAll();
  }

  // ── L1 · advisories ──────────────────────────────────────────────────────

  async pullLive(opts?: { limit?: number; hours?: number }): Promise<Advisory[]> {
    const report = await this.pullLiveReport(opts);
    return report.advisories;
  }

  /** the same cascade, with the provenance the CLI prints */
  async pullLiveReport(opts?: { limit?: number; hours?: number }): Promise<PullReport> {
    const limit = opts?.limit ?? 50;
    const hours = opts?.hours ?? 72;
    const notes: string[] = [];
    let advisories: Advisory[] = [];
    let primary: PullReport['primary'] = 'fixture';

    if (!this.mock) {
      const gh = await fetchGithubAdvisories({ ecosystem: 'npm', limit, hours });
      notes.push(gh.note);
      if (gh.ok && gh.advisories.length > 0) {
        advisories = gh.advisories;
        primary = 'github';
      }

      if (advisories.length < 5) {
        const osv = await queryOsv(OSV_PACKAGES, 'npm');
        notes.push(osv.note);
        if (osv.ok && osv.advisories.length > 0) {
          advisories = mergeById(advisories, osv.advisories);
          if (primary !== 'github') primary = 'osv';
        }
      }
    } else {
      notes.push('MOCK=true — no network, fixture cascade only');
    }

    if (advisories.length === 0) {
      const fixture = readJson<Advisory[]>(LIVE_FIXTURE);
      if (fixture && fixture.length > 0) {
        // Stamped 'fixture' on purpose: source describes where *this* pull came
        // from, and a caller must never be told it got live data when it did
        // not. The original provenance is still on disk in fixtures/live.json.
        advisories = fixture.map((a) => ({ ...a, source: 'fixture' as const }));
        primary = 'fixture';
        notes.push(
          this.mock
            ? `MOCK=true — served ${advisories.length} advisories from ${LIVE_FIXTURE}`
            : `github and osv unreachable — served ${advisories.length} advisories from ${LIVE_FIXTURE}`,
        );
      }
    }

    if (advisories.length === 0) {
      advisories = DEMO_ADVISORIES.map((a) => ({ ...a }));
      primary = 'demo';
      notes.push('no fixture on disk — falling back to the three contract demo advisories');
    }

    // KEV merge
    const kev = await this.kevCatalog();
    const idx = this.kevIdx ?? kevIndex(kev);
    let matches = 0;
    for (const a of advisories) {
      a.in_kev = idx.has(a.cve_id);
      if (a.in_kev) matches += 1;
      if (a.cve_id) this.trackedCves.set(a.cve_id.toUpperCase(), a.ghsa_id);
    }

    advisories = mergeById([], advisories)
      .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
      .slice(0, limit);

    for (const a of advisories) {
      await this.publishAdvisory(a);
    }

    const bySource: Record<string, number> = {};
    for (const a of advisories) bySource[a.source ?? 'unknown'] = (bySource[a.source ?? 'unknown'] ?? 0) + 1;

    const report: PullReport = {
      advisories,
      primary,
      bySource,
      kev_matches: matches,
      kev_count: idx.size,
      newest: advisories.reduce<string | null>(
        (acc, a) => (acc === null || a.published_at > acc ? a.published_at : acc),
        null,
      ),
      notes,
    };
    this.lastPull = report;
    return report;
  }

  lastReport(): PullReport | null {
    return this.lastPull;
  }

  /**
   * `opts.survivors` overrides how many of the n advisories are about packages
   * this estate actually depends on. Defaults to BURST_SURVIVORS (2).
   */
  async burst(n: number, overSeconds: number, opts?: { survivors?: number }): Promise<number> {
    const plan = burstPlan(n, opts?.survivors ?? BURST_SURVIVORS);
    const gap = n > 1 ? Math.max(0, (overSeconds * 1000) / n) : 0;
    let published = 0;
    for (let i = 0; i < n; i += 1) {
      await this.publishAdvisory(syntheticAdvisory(i, plan[i]));
      published += 1;
      if (i < n - 1 && gap > 0) await sleep(gap);
    }
    return published;
  }

  // ── L3 · clocks ──────────────────────────────────────────────────────────

  async startClock(input: ClockInput): Promise<ClockTick> {
    return this.clocks_.start(input);
  }

  async stopClock(ghsaId: string, customer: string): Promise<void> {
    return this.clocks_.stop(ghsaId, customer);
  }

  async clocks(): Promise<ClockTick[]> {
    return this.clocks_.list();
  }

  // ── L2 · telemetry ───────────────────────────────────────────────────────

  telemetryFor(packageName: string): TelemetryEvent[] {
    return this.telemetry.forPackage(packageName);
  }

  // ── L4 · KEV ─────────────────────────────────────────────────────────────

  async pollKev(): Promise<number> {
    const next = await fetchKev({ mock: this.mock });
    const deltas = diffKev(this.kev, next, this.trackedCves);
    this.kev = next;
    this.kevIdx = kevIndex(next);
    // first load is a baseline, not 1,656 escalations
    const emit = this.lastPull === null && deltas.length > 50 ? [] : deltas;
    for (const d of emit) await this.bus.publish('kev-delta', d);
    return emit.length;
  }

  async kevCatalog(): Promise<KevCatalog> {
    if (!this.kev) {
      this.kev = await fetchKev({ mock: this.mock });
      this.kevIdx = kevIndex(this.kev);
    }
    return this.kev;
  }

  // ── replay ───────────────────────────────────────────────────────────────

  /**
   * Re-emit a fixture through the bus, preserving relative timing. Zero
   * network. Advisory dedupe is suspended for the duration so a replay of the
   * same arc lands every event, every time.
   */
  async replay(fixturePathRel: string, speed = 1): Promise<number> {
    const raw = readFileSync(fixturePath(fixturePathRel), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error(`${fixturePathRel} is not an EventEnvelope[]`);
    const events = parsed as EventEnvelope<HopperEvent>[];
    const rate = speed > 0 ? speed : 1;

    const internals = busInternals(this.bus);
    internals?.beginReplay();
    try {
      let previous: number | null = null;
      let count = 0;
      for (const e of events) {
        const at = Date.parse(e.ts);
        if (previous !== null && Number.isFinite(at)) {
          const wait = (at - previous) / rate;
          if (wait > 0) await sleep(Math.min(wait, 5_000));
        }
        if (Number.isFinite(at)) previous = at;
        await this.bus.publish(e.topic as Topic, e.payload);
        count += 1;
      }
      return count;
    } finally {
      internals?.endReplay();
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async publishAdvisory(a: Advisory): Promise<void> {
    const event: AdvisoryEvent = { kind: 'advisory', advisory: a, received_at: nowIso() };
    await this.bus.publish('advisories', event);
    if (a.cve_id) this.trackedCves.set(a.cve_id.toUpperCase(), a.ghsa_id);
    this.opts.onAdvisory?.(a);
  }
}

export function createIngest(bus: EventBusPort, opts?: IngestOptions): IngestPort {
  return new HopperIngest(bus, opts);
}

// ── synthetic advisories for the funnel demo ────────────────────────────────

/** GHSA-shaped, distinct across calls, obviously synthetic on inspection */
export function syntheticGhsaId(): string {
  burstCounter += 1;
  const seed = Date.now() * 1000 + burstCounter;
  const block = (offset: number): string => {
    let n = seed + offset * 7919;
    let out = '';
    for (let i = 0; i < 4; i += 1) {
      out += ID_ALPHABET[n % ID_ALPHABET.length];
      n = Math.floor(n / ID_ALPHABET.length) + 31;
    }
    return out;
  };
  return `GHSA-${block(1)}-${block(2)}-${block(3)}`;
}

export function syntheticAdvisory(i: number, packageName?: string): Advisory {
  const pkg = packageName ?? BURST_ABSENT_PACKAGES[i % BURST_ABSENT_PACKAGES.length];
  const severity = BURST_SEVERITIES[i % BURST_SEVERITIES.length];
  const major = 1 + (i % 7);
  const minor = i % 13;
  return {
    ghsa_id: syntheticGhsaId(),
    cve_id: `CVE-2026-${70_000 + ((i * 37) % 9_000)}`,
    severity,
    cvss: severity === 'CRITICAL' ? 9.8 : severity === 'HIGH' ? 7.5 : severity === 'MODERATE' ? 5.3 : 3.1,
    published_at: nowIso(),
    summary: `${pkg}: ${SYNTH_SUMMARIES[i % SYNTH_SUMMARIES.length]}`,
    in_kev: false,
    ecosystem: 'npm',
    package_name: pkg,
    vulnerable_range: `< ${major}.${minor}.${(i % 9) + 1}`,
    fixed_in: `${major}.${minor}.${(i % 9) + 1}`,
    source: 'synthetic',
  };
}

const SYNTH_SUMMARIES = [
  'prototype pollution via unsanitised merge',
  'regular expression denial of service in the parser',
  'path traversal when extracting archives',
  'improper certificate validation on redirect',
  'uncontrolled resource consumption under nested input',
  'information exposure through error messages',
  'incorrect authorization on the internal route',
] as const;

function mergeById(a: Advisory[], b: Advisory[]): Advisory[] {
  const out = new Map<string, Advisory>();
  for (const x of [...a, ...b]) if (!out.has(x.ghsa_id)) out.set(x.ghsa_id, x);
  return [...out.values()];
}
