/**
 * Everything the page states. Numbers live here with their source so the copy
 * and the footnotes can never drift apart.
 */
import {
  HERO_ADVISORY,
  HERO_CLAUSE,
  HERO_CUSTOMER,
  HERO_SERVICE,
  HERO_WINDOW_HOURS,
  SUPPRESSED_ADVISORY,
} from '@hopper/contracts';

export const CONSOLE_URL = 'http://localhost:5173';

/** The rail is a scale for the document. These are its graduations. */
export const SECTIONS = [
  { id: 'signal', label: 'signal' },
  { id: 'volume', label: 'volume' },
  { id: 'boundary', label: 'boundary' },
  { id: 'precedent', label: 'precedent' },
  { id: 'join', label: 'join' },
  { id: 'adoption', label: 'adoption' },
  { id: 'plans', label: 'plans' },
] as const;

/** Which of the four systems each node in a hop path came out of. */
export type Band = 'SBOM' | 'CATALOG' | 'CRM' | 'LEGAL' | '—';

export interface HopRow {
  band: Band;
  kind: string;
  name: string;
  meta: string;
}

/** brace-expansion → minimatch → glob → jest → build-api → Northwind → §7.3 */
export const ESCALATED_PATH: HopRow[] = [
  {
    band: 'SBOM',
    kind: 'advisory',
    name: HERO_ADVISORY.ghsa_id,
    meta: `${HERO_ADVISORY.severity} · cvss ${HERO_ADVISORY.cvss}`,
  },
  {
    band: 'SBOM',
    kind: 'package',
    name: HERO_ADVISORY.package_name,
    meta: HERO_ADVISORY.vulnerable_range,
  },
  { band: 'SBOM', kind: 'depends on', name: 'minimatch', meta: 'transitive · depth 1' },
  { band: 'SBOM', kind: 'depends on', name: 'glob', meta: 'transitive · depth 2' },
  { band: 'SBOM', kind: 'depends on', name: 'jest', meta: 'transitive · depth 3' },
  { band: 'CATALOG', kind: 'service', name: HERO_SERVICE, meta: 'tier 1 · production' },
  { band: 'CRM', kind: 'customer', name: HERO_CUSTOMER, meta: 'msa · signed 2024-11' },
  {
    band: 'LEGAL',
    kind: 'clause',
    name: HERO_CLAUSE,
    meta: `notice within ${HERO_WINDOW_HOURS}h of confirmation`,
  },
];

/**
 * The advisory and the package are where the wave starts, and the clause is
 * where it stops — so the hops actually walked are the rows in between:
 * minimatch, glob, jest, build-api, Northwind. Five, as advertised.
 */
export const HOP_TOTAL = ESCALATED_PATH.length - 3;

/** How many hops a traversal that has reached `n` rows has actually walked. */
export function hopsWalked(reached: number): number {
  return Math.min(Math.max(reached - 2, 0), HOP_TOTAL);
}

export const SUPPRESSED_PATH: HopRow[] = [
  {
    band: 'SBOM',
    kind: 'advisory',
    name: SUPPRESSED_ADVISORY.ghsa_id,
    meta: `${SUPPRESSED_ADVISORY.severity} · cvss ${SUPPRESSED_ADVISORY.cvss}`,
  },
  {
    band: 'SBOM',
    kind: 'package',
    name: SUPPRESSED_ADVISORY.package_name,
    meta: SUPPRESSED_ADVISORY.vulnerable_range,
  },
  { band: '—', kind: 'no path', name: 'not in any lockfile', meta: 'traversal ended' },
];

/** Three tools, one scale. Where each one stops answering. */
export const CHANNELS = [
  {
    name: 'Dependabot · Snyk · Trivy',
    question: 'Is this package vulnerable?',
    reach: 2,
    stop: 'stops at the package',
  },
  {
    name: 'Reachability analysis',
    question: 'Is the vulnerable function ever called?',
    reach: 3,
    stop: 'stops at the call site',
  },
  {
    name: 'Hopper',
    question: 'Which customer is exposed, and when am I required to tell them?',
    reach: 8,
    stop: `ends at ${HERO_CLAUSE} · ${HERO_WINDOW_HOURS}h`,
  },
] as const;

/** The four systems. None of them share a database. */
export const SYSTEMS = [
  {
    band: 'SBOM',
    reads: 'lockfiles, resolved through deps.dev and OSV',
    gives: 'packages, versions and every transitive edge between them',
    from: 'your repositories',
  },
  {
    band: 'CATALOG',
    reads: 'hopper.yml, Backstage, Kubernetes and Terraform labels',
    gives: 'which repository builds which service, its tier and environment',
    from: 'your platform',
  },
  {
    band: 'CRM',
    reads: 'a CSV, or a Salesforce or HubSpot sync',
    gives: 'which customer depends on which service',
    from: 'your revenue team',
  },
  {
    band: 'LEGAL',
    reads: 'the notice window you record per customer',
    gives: 'the clause, the deadline and who has to sign the notice',
    from: 'your contracts',
  },
] as const;

export const REGIMES = [
  { name: 'DORA', window: '4h', scope: 'EU financial entities' },
  { name: 'NIS2', window: '24h', scope: 'EU essential and important entities' },
  { name: 'GDPR', window: '72h', scope: 'personal data breaches' },
  { name: 'SEC', window: '4 business days', scope: 'US listed material incidents' },
] as const;

export const PLANS = [
  {
    name: 'Watch',
    price: 'Free',
    unit: '',
    note: 'one repository',
    lines: ['hop paths', 'suppression log', 'read-only — Hopper takes no actions'],
    accent: false,
  },
  {
    name: 'Solo',
    price: '$20',
    unit: '/user/mo',
    note: 'ten repositories',
    lines: [
      'everything in Watch',
      'auto-PR on the fixable ones',
      'Slack paging',
      'precedent memory',
      'reachability filtering',
    ],
    accent: false,
  },
  {
    name: 'Team',
    price: '$99',
    unit: '/user/mo',
    note: 'unlimited repositories',
    lines: [
      'everything in Solo',
      'customer and contract graph',
      'obligation clock',
      'audit export',
      'SSO',
    ],
    accent: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    unit: '',
    note: 'self-hosted',
    lines: [
      'everything in Team',
      'VEX and SBOM export',
      'DORA and NIS2 notice templates',
      'regulator audit trail',
    ],
    accent: false,
  },
] as const;

export const LOCKFILES = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'go.sum',
  'poetry.lock',
  'Cargo.lock',
] as const;

export const CUSTOMER_ROWS = [
  { customer: 'Northwind Systems', service: 'build-api', window: '24', basis: 'msa §7.3' },
  { customer: 'Halcyon Bank', service: 'payments-api', window: '24', basis: 'dora art. 19' },
  { customer: 'Kestrel Freight', service: 'build-api', window: '72', basis: 'default · gdpr' },
  { customer: 'Orbit Media', service: 'notify-worker', window: '72', basis: 'default · gdpr' },
] as const;

export const OUTPUTS = [
  { where: 'GitHub', what: 'a pull request that bumps the dependency', auto: true },
  { where: 'Slack · PagerDuty', what: 'a page to the owning team, once', auto: true },
  { where: 'Jira · Linear', what: 'a ticket carrying the hop path', auto: true },
  { where: 'Customer notice', what: 'drafted, addressed, and held', auto: false },
] as const;

export const SOURCES = [
  '35,364 CVEs published in H1 2026, +49.5% year over year — one every 7.4 minutes.',
  '85 of those reached the CISA Known Exploited Vulnerabilities catalogue. 0.24%.',
  'NIST moved the National Vulnerability Database to a triage model in April 2026; roughly 29,000 entries carry the status "Not Scheduled".',
  '95% of vulnerable dependencies are transitive; under 9.5% are reachable at function level.',
  'Median time to exploit fell from 32 days to 5. Median time to fix rose from 171 days to 252.',
  'Sonatype counted 454,648 new malicious packages in 2025.',
  'MOVEit, June 2023: roughly 2,700 organisations in scope through their vendors.',
] as const;

export const HERO = {
  advisory: HERO_ADVISORY,
  suppressed: SUPPRESSED_ADVISORY,
  windowHours: HERO_WINDOW_HOURS,
  customer: HERO_CUSTOMER,
  clause: HERO_CLAUSE,
  service: HERO_SERVICE,
  contract: 'MSA 2024-11-02',
  regime: 'NIS2 Art. 23',
};
