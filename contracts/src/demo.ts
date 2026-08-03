/**
 * HOPPER — shared demo constants. The 100-second script depends on these ids
 * lining up across packages, so they live in the contract.
 */
import type { Advisory } from './graph.js';

/** Beat 1 — the hit. Real advisory, real package, genuinely 4+ hops down. */
export const HERO_GHSA = 'GHSA-rgw5-rvv9-x895';
export const HERO_PACKAGE = 'brace-expansion';

/** Beat 2 — the restraint. High severity, zero hops. */
export const SUPPRESSED_GHSA = 'GHSA-0000-supp-0001';
export const SUPPRESSED_PACKAGE = '@angular/compiler';

/** Beat 3 — memory. Same package family as a PatchAttempt written during beat 1. */
export const PRECEDENT_GHSA = 'GHSA-0000-prec-0001';
export const PRECEDENT_PACKAGE = 'minimatch';

export const HERO_CUSTOMER = 'Northwind Systems';
export const HERO_SERVICE = 'build-api';
export const HERO_CLAUSE = '§7.3';
export const HERO_WINDOW_HOURS = 24;

export const SEED_ROOTS = [
  'express',
  'next',
  'webpack',
  'jest',
  'eslint',
  'axios',
] as const;

export const HERO_ADVISORY: Advisory = {
  ghsa_id: HERO_GHSA,
  cve_id: 'CVE-2026-69152',
  severity: 'HIGH',
  cvss: 7.5,
  published_at: '2026-08-03T16:35:32Z',
  summary:
    'brace-expansion: Denial of Service via unbounded intermediate arrays in expand()',
  in_kev: false,
  ecosystem: 'npm',
  package_name: HERO_PACKAGE,
  vulnerable_range: '< 1.1.18',
  fixed_in: '1.1.18',
  source: 'fixture',
};

export const SUPPRESSED_ADVISORY: Advisory = {
  ghsa_id: SUPPRESSED_GHSA,
  cve_id: 'CVE-2026-69201',
  severity: 'HIGH',
  cvss: 8.1,
  published_at: '2026-08-03T16:23:11Z',
  summary:
    '@angular/compiler: template injection in ahead-of-time compilation path',
  in_kev: false,
  ecosystem: 'npm',
  package_name: SUPPRESSED_PACKAGE,
  vulnerable_range: '< 17.3.12',
  fixed_in: '17.3.12',
  source: 'fixture',
};

export const PRECEDENT_ADVISORY: Advisory = {
  ghsa_id: PRECEDENT_GHSA,
  cve_id: 'CVE-2026-69233',
  severity: 'MODERATE',
  cvss: 5.9,
  published_at: '2026-08-03T17:02:44Z',
  summary: 'minimatch: ReDoS in brace pattern parsing',
  in_kev: false,
  ecosystem: 'npm',
  package_name: PRECEDENT_PACKAGE,
  vulnerable_range: '< 9.0.5',
  fixed_in: '9.0.5',
  source: 'fixture',
};

/** the three demo beats, in order */
export const DEMO_BEATS = [
  { step: 1, ghsa_id: HERO_GHSA, label: 'the hit', expect: 'escalated' },
  { step: 2, ghsa_id: SUPPRESSED_GHSA, label: 'the restraint', expect: 'suppressed' },
  { step: 3, ghsa_id: PRECEDENT_GHSA, label: 'memory', expect: 'escalated' },
] as const;

/** Seismograph palette — the UI imports these, nobody hand-types hex. */
export const PALETTE = {
  ground: '#0F141C',
  paper: '#E8E4DA',
  muted: '#7A8595',
  signal: '#E8A33D',
  breach: '#C7433A',
  clear: '#4A9B8E',
} as const;

export const HOP_INTERVAL_MS = 300;
