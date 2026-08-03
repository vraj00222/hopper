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

export function createBus(opts?: { url?: string; mock?: boolean }): EventBusPort {
  const url = opts?.url ?? process.env.LASER_URL;
  const mock = opts?.mock ?? isMock();
  // laserdata is used only when we have a URL *and* we are not in mock mode
  if (url && !mock) return new LaserDataBus(url);
  return new LocalBus();
}

export { createIngest, HopperIngest } from './ingest.js';
export type { IngestOptions, PullReport } from './ingest.js';

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
