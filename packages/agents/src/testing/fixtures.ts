/**
 * Gate fixtures. Four scenarios plus a credential-leak probe. Gate only — not exported
 * from src/index.ts. In production these arrive from Q1/Q3 and the telemetry topic.
 */
import {
  HERO_ADVISORY,
  PRECEDENT_ADVISORY,
  SUPPRESSED_ADVISORY,
  type AgentInput,
  type Advisory,
  type HopPath,
  type Precedent,
  type TelemetryEvent,
} from '@hopper/contracts';

/** a value that must never appear anywhere except the credential store */
export const SENTINEL_GITHUB_TOKEN = 'ghp_SENTINELVALUE123';

const NORTHWIND: HopPath = {
  customer: 'Northwind Systems',
  customer_tier: 'enterprise',
  arr: 1_400_000,
  service: 'build-api',
  repo: 'acme/build-api',
  notice_window: 24,
  clause_ref: '§7.3',
  clause_type: 'breach_notification',
  hops: 5,
  chain: ['brace-expansion', 'minimatch', 'glob', 'jest', 'build-api', 'Northwind Systems', '§7.3'],
  contract_id: 'CTR-2024-0117',
  governing_law: 'Delaware',
};

const HELIOS: HopPath = {
  customer: 'Helios Freight',
  customer_tier: 'growth',
  arr: 320_000,
  service: 'build-api',
  repo: 'acme/build-api',
  notice_window: 72,
  clause_ref: '§9.1',
  clause_type: 'breach_notification',
  hops: 5,
  chain: ['brace-expansion', 'minimatch', 'glob', 'jest', 'build-api', 'Helios Freight', '§9.1'],
  contract_id: 'CTR-2023-0442',
  governing_law: 'England and Wales',
};

const BEAT1_TELEMETRY: TelemetryEvent[] = [
  {
    kind: 'telemetry',
    service: 'build-api',
    package: 'brace-expansion',
    symbol: 'expand',
    calls: 1842,
    window_seconds: 300,
    observed_at: '2026-08-03T17:05:00Z',
  },
  // same package, different symbol — must not count toward the advisory's symbol
  {
    kind: 'telemetry',
    service: 'build-api',
    package: 'brace-expansion',
    symbol: 'parse',
    calls: 400,
    window_seconds: 300,
    observed_at: '2026-08-03T17:05:00Z',
  },
  // off-path noise — must not count at all
  {
    kind: 'telemetry',
    service: 'billing-api',
    package: 'lodash',
    symbol: 'merge',
    calls: 9021,
    window_seconds: 300,
    observed_at: '2026-08-03T17:05:00Z',
  },
];

/** the identical failure, three days old: history, not a live hazard */
const STALE_FAILURE: Precedent = {
  package: 'brace-expansion',
  from_v: '1.1.11',
  to_v: '1.1.18',
  outcome: 'broke_staging',
  ts: '2026-07-31T09:14:02Z',
  notes: 'PatchAttempt#1 — staging failed on an unrelated lockfile drift; resolved the same day',
  age_seconds: 259_200,
};

/** the same shape, ninety seconds old: the edge that overturns beat 3 */
const FRESH_FAILURE: Precedent = {
  package: 'minimatch',
  from_v: '9.0.3',
  to_v: '9.0.5',
  outcome: 'broke_staging',
  ts: '2026-08-03T17:03:14Z',
  notes:
    'PatchAttempt#3 — opened during GHSA-rgw5-rvv9-x895 remediation; build-api staging integration suite failed on glob resolution',
  age_seconds: 90,
};

/** Beat 1 — the hit. Reachable, obligated, patchable, no live failure. */
export function beat1Input(): AgentInput {
  return {
    advisory: HERO_ADVISORY,
    hopPaths: [NORTHWIND, HELIOS],
    telemetry: BEAT1_TELEMETRY,
    precedents: [STALE_FAILURE],
    isChokepoint: true,
  };
}

/** Beat 2 — the restraint. High severity, zero hops. */
export function suppressedInput(): AgentInput {
  return {
    advisory: SUPPRESSED_ADVISORY,
    hopPaths: [],
    telemetry: [],
    precedents: [],
    isChokepoint: false,
  };
}

/** Beat 3 — memory. Same shape as beat 1 but the failed bump is ninety seconds old. */
export function beat3Input(): AgentInput {
  const path: HopPath = {
    ...NORTHWIND,
    hops: 4,
    chain: ['minimatch', 'glob', 'jest', 'build-api', 'Northwind Systems', '§7.3'],
  };
  return {
    advisory: PRECEDENT_ADVISORY,
    hopPaths: [path],
    telemetry: [
      {
        kind: 'telemetry',
        service: 'build-api',
        package: 'minimatch',
        symbol: 'braceExpand',
        calls: 640,
        window_seconds: 300,
        observed_at: '2026-08-03T17:04:30Z',
      },
    ],
    precedents: [FRESH_FAILURE],
    isChokepoint: true,
  };
}

const AUTO_ADVISORY: Advisory = {
  ghsa_id: 'GHSA-0000-auto-0001',
  cve_id: 'CVE-2026-69310',
  severity: 'MODERATE',
  cvss: 5.3,
  published_at: '2026-08-03T17:11:09Z',
  summary: 'tar-fs: path traversal in extract() when following symlinks',
  in_kev: false,
  ecosystem: 'npm',
  package_name: 'tar-fs',
  vulnerable_range: '< 2.1.3',
  fixed_in: '2.1.3',
  source: 'fixture',
};

/** reachable, safe bump, no notice-bearing clause: the only shape that may run itself */
export function autoInput(): AgentInput {
  return {
    advisory: AUTO_ADVISORY,
    hopPaths: [
      {
        customer: 'Internal Platform',
        customer_tier: 'starter',
        arr: 0,
        service: 'artifact-cache',
        repo: 'acme/artifact-cache',
        notice_window: 0,
        clause_ref: '§4.1',
        clause_type: 'sla_uptime',
        hops: 2,
        chain: ['tar-fs', 'artifact-cache', 'Internal Platform', '§4.1'],
        contract_id: 'CTR-INTERNAL',
        governing_law: 'Delaware',
      },
    ],
    telemetry: [
      {
        kind: 'telemetry',
        service: 'artifact-cache',
        package: 'tar-fs',
        symbol: 'extract',
        calls: 310,
        window_seconds: 300,
        observed_at: '2026-08-03T17:12:00Z',
      },
    ],
    precedents: [],
    isChokepoint: false,
  };
}

/**
 * Beat 1 with a credential value planted in graph data — someone pasted a token into a
 * PatchAttempt note. The agent quotes its precedent notes, so without redaction this
 * value would land in a verdict, the transcript, the bus and the graph. It is the only
 * honest way to prove the containment is wired rather than merely absent.
 */
export function leakProbeInput(): AgentInput {
  return {
    ...beat1Input(),
    precedents: [
      {
        ...STALE_FAILURE,
        notes: `PatchAttempt#1 — retried with CI credential ${SENTINEL_GITHUB_TOKEN} pasted into the run log`,
      },
    ],
  };
}
