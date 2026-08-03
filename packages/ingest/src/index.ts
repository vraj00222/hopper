/**
 * @hopper/ingest — LaserData. EventBusPort + IngestPort.
 *
 *   const bus = createBus()             // local by default, complete on its own
 *   await bus.connect()
 *   const ingest = createIngest(bus)
 *   await ingest.start()
 *
 * Set LASER_URL and MOCK=false to put the same six topics on LaserData Cloud.
 * Any SDK failure logs once and falls back to the in-process transport, so the
 * demo never depends on a sponsor's uptime.
 */
import { isMock } from '@hopper/contracts';
import type { EventBusPort } from '@hopper/contracts';

import { LaserDataBus } from './bus/laserdata.js';
import { LocalBus } from './bus/local.js';
import { loadDotEnv, resolveLaserConfig } from './env.js';

export interface BusSelection {
  transport: 'laserdata' | 'local';
  /** why, in one line, safe to print — never contains a credential */
  reason: string;
  endpoint: string | null;
  stream: string;
  mock: boolean;
}

/**
 * What createBus() would pick, and why. Printed by the gate and the server
 * banner so a misconfigured endpoint is visible before anything depends on it.
 */
export function busSelection(opts?: { url?: string; mock?: boolean }): BusSelection {
  loadDotEnv();
  const cfg = resolveLaserConfig();
  const mock = opts?.mock ?? isMock();
  const url = opts?.url ?? cfg.connectionString;
  const endpoint = opts?.url ? null : cfg.endpoint;
  if (!url) return { transport: 'local', reason: cfg.reason, endpoint: null, stream: cfg.stream, mock };
  if (mock) {
    return {
      transport: 'local',
      reason: `endpoint configured (${endpoint ?? 'explicit url'}) but MOCK is on — local transport`,
      endpoint,
      stream: cfg.stream,
      mock,
    };
  }
  return {
    transport: 'laserdata',
    reason: opts?.url ? 'explicit url passed to createBus()' : cfg.reason,
    endpoint,
    stream: cfg.stream,
    mock,
  };
}

export function createBus(opts?: { url?: string; mock?: boolean }): EventBusPort {
  loadDotEnv();
  const cfg = resolveLaserConfig();
  const url = opts?.url ?? cfg.connectionString;
  const mock = opts?.mock ?? isMock();
  // laserdata is used only when we have an endpoint *and* we are not in mock mode
  if (url && !mock) return new LaserDataBus(url, cfg.stream);
  return new LocalBus();
}

export { createIngest, HopperIngest } from './ingest.js';
export type { IngestOptions, PullReport } from './ingest.js';
export {
  BURST_ABSENT_PACKAGES,
  BURST_SURVIVOR_PACKAGES,
  BURST_SURVIVORS,
  burstPlan,
  syntheticAdvisory,
} from './ingest.js';

export { loadDotEnv, resolveLaserConfig, redactEndpoint, DEFAULT_IGGY_PORT } from './env.js';
export type { LaserConfig } from './env.js';

export { LocalBus, busInternals, scoreText } from './bus/local.js';
export type { BusInternals } from './bus/local.js';
export { LaserDataBus } from './bus/laserdata.js';

export { ClockRegistry, CLOCK_NAMESPACE, clockKey } from './clock.js';
export type { ClockInput } from './clock.js';
export { TelemetrySimulator, CALL_SITES, DARK_PACKAGES, WINDOW_SECONDS } from './telemetry.js';

export { fetchGithubAdvisories } from './sources/github.js';
export type { SourceResult } from './sources/github.js';
export { queryOsv, queryOsvBatch } from './sources/osv.js';
export { fetchKev, kevIndex, diffKev } from './sources/kev.js';
export type { KevCatalog, KevEntry, KevIndex } from './sources/kev.js';
export { cvssFromVector, normaliseSeverity, bandForScore, scoreForBand } from './sources/cvss.js';

export { validateEvent, validateEnvelope, validateAdvisory, TOPIC_KIND } from './validate.js';
export type { Validation } from './validate.js';

export { LIVE_FIXTURE, REPLAY_FIXTURE, KEV_FIXTURE, repoRoot, fixturePath, fmtAge } from './paths.js';
