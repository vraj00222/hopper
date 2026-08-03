/**
 * L2 — the reachability signal.
 *
 * Which symbols actually ran, in which service, over the last N minutes. This
 * is what turns "95% of your dependencies are transitive" into "9.5% of them
 * ever execute". The demo depends on exactly two facts:
 *
 *   brace-expansion#expand  ran in the hero services   -> reachable  = TRUE
 *   @angular/compiler       ran nowhere                -> reachable  = FALSE
 *
 * Everything else is plausible background so the panel is not a two-row table.
 */
import { HERO_PACKAGE, HERO_SERVICE, SUPPRESSED_PACKAGE, nowIso } from '@hopper/contracts';
import type { EventBusPort, TelemetryEvent } from '@hopper/contracts';

export const WINDOW_SECONDS = 900; // 15 minutes

interface Site {
  service: string;
  package: string;
  symbol: string;
  /** calls per window, before jitter */
  base: number;
}

/**
 * The call sites we simulate. `@angular/compiler` is deliberately absent — its
 * absence is the evidence for beat 2, so it must never appear here.
 */
export const CALL_SITES: readonly Site[] = [
  { service: HERO_SERVICE, package: HERO_PACKAGE, symbol: 'expand', base: 1840 },
  { service: 'ci-runner', package: HERO_PACKAGE, symbol: 'expand', base: 962 },
  { service: 'artifact-store', package: HERO_PACKAGE, symbol: 'expand', base: 128 },
  { service: HERO_SERVICE, package: HERO_PACKAGE, symbol: 'parseCommaParts', base: 610 },
  { service: HERO_SERVICE, package: 'minimatch', symbol: 'minimatch', base: 2210 },
  { service: 'ci-runner', package: 'minimatch', symbol: 'braceExpand', base: 1105 },
  { service: HERO_SERVICE, package: 'glob', symbol: 'globSync', base: 740 },
  { service: 'ci-runner', package: 'glob', symbol: 'globSync', base: 431 },
  { service: HERO_SERVICE, package: 'jest', symbol: 'runCLI', base: 96 },
  { service: 'web-edge', package: 'express', symbol: 'handle', base: 15_400 },
  { service: 'web-edge', package: 'axios', symbol: 'request', base: 8_120 },
  { service: 'billing-api', package: 'axios', symbol: 'request', base: 3_045 },
  { service: 'billing-api', package: 'express', symbol: 'handle', base: 6_800 },
  { service: 'ci-runner', package: 'webpack', symbol: 'compile', base: 212 },
  { service: 'ci-runner', package: 'eslint', symbol: 'lintFiles', base: 388 },
] as const;

/** packages we know about but that never execute — the suppression evidence */
export const DARK_PACKAGES: readonly string[] = [SUPPRESSED_PACKAGE, '@angular/core', 'lodash.template'];

export class TelemetrySimulator {
  private readonly latest = new Map<string, TelemetryEvent[]>();
  private timer: NodeJS.Timeout | null = null;
  private tick = 0;

  constructor(private readonly bus: EventBusPort) {}

  /** one observation window, jittered so the panel is not static */
  sample(): TelemetryEvent[] {
    this.tick += 1;
    const observed_at = nowIso();
    const events = CALL_SITES.map<TelemetryEvent>((s, i) => ({
      kind: 'telemetry',
      service: s.service,
      package: s.package,
      symbol: s.symbol,
      calls: jitter(s.base, this.tick * 31 + i * 7),
      window_seconds: WINDOW_SECONDS,
      observed_at,
    }));

    this.latest.clear();
    for (const e of events) {
      const list = this.latest.get(e.package) ?? [];
      list.push(e);
      this.latest.set(e.package, list);
    }
    return events;
  }

  async emit(): Promise<TelemetryEvent[]> {
    const events = this.sample();
    for (const e of events) await this.bus.publish('telemetry', e);
    return events;
  }

  start(everyMs = 15_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.emit();
    }, everyMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** empty array means "never observed" — that is the suppression proof */
  forPackage(packageName: string): TelemetryEvent[] {
    if (this.latest.size === 0) this.sample();
    return (this.latest.get(packageName) ?? []).map((e) => ({ ...e }));
  }
}

/** deterministic +/-18% wobble — no Math.random, so replays diff cleanly */
function jitter(base: number, salt: number): number {
  const x = Math.sin(salt * 12.9898) * 43758.5453;
  const frac = x - Math.floor(x);
  return Math.max(1, Math.round(base * (0.82 + 0.36 * frac)));
}
