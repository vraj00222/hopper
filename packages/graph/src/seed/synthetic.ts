/**
 * HOPPER — the overlay that turns a dependency graph into a business graph.
 *
 * deps.dev gives us real packages. Nobody publishes their customer contracts to
 * an API, so the six Repos / eight Services / five Customers / five Contracts
 * are ours. Everything downstream of `(Repo)-[:USES]->(Package)` is synthetic;
 * everything upstream of it is real.
 *
 * The hero path is load-bearing for the demo:
 *   brace-expansion -> minimatch -> glob -> ... -> jest
 *     -> platform-build -> build-api -> Northwind Systems -> §7.3 (24h)
 *
 * Two constraints follow from that and must not be broken:
 *   - the hero repo (platform-build) must NOT use eslint. eslint depends on
 *     minimatch directly, which would give Northwind a 3-hop path that wins the
 *     shortest-path dedupe and drops `glob` out of the chain.
 *   - @angular/compiler (SUPPRESSED_PACKAGE) must appear in no repo's closure,
 *     so Q2 proves absence rather than asserting it.
 */
import {
  HERO_CLAUSE,
  HERO_CUSTOMER,
  HERO_SERVICE,
  HERO_WINDOW_HOURS,
  isoPlusHours,
} from '@hopper/contracts';
import type { Dataset } from '../dataset.js';
import { emptyDataset } from '../dataset.js';

export const HERO_REPO = 'platform-build';
export const HERO_ROOT_PACKAGE = 'jest';
export const HERO_TEAM = 'platform-infra';
export const HERO_ONCALL_EMAIL = 'p.raman@hopper.dev';
export const HERO_CONTRACT_ID = 'CTR-NWS-2024-011';

const ORG = 'hopper-io';

function daysAgo(n: number, from = Date.now()): string {
  return new Date(from - n * 86_400_000).toISOString();
}

export function syntheticDataset(now: Date = new Date()): Dataset {
  const ds = emptyDataset();

  // ─── 6 repos ──────────────────────────────────────────────────────────────
  ds.repos = [
    { name: HERO_REPO, org: ORG, lockfile_path: 'services/build-api/package-lock.json' },
    { name: 'edge-gateway', org: ORG, lockfile_path: 'package-lock.json' },
    { name: 'checkout-web', org: ORG, lockfile_path: 'apps/checkout/package-lock.json' },
    { name: 'identity-svc', org: ORG, lockfile_path: 'package-lock.json' },
    { name: 'analytics-etl', org: ORG, lockfile_path: 'pipelines/package-lock.json' },
    { name: 'search-svc', org: ORG, lockfile_path: 'package-lock.json' },
  ];

  // ─── 8 services ───────────────────────────────────────────────────────────
  ds.services = [
    { name: HERO_SERVICE, tier: 'tier-0', env: 'prod', public_facing: false },
    { name: 'edge-gateway', tier: 'tier-0', env: 'prod', public_facing: true },
    { name: 'checkout-web', tier: 'tier-0', env: 'prod', public_facing: true },
    { name: 'payments-api', tier: 'tier-0', env: 'prod', public_facing: false },
    { name: 'identity-api', tier: 'tier-0', env: 'prod', public_facing: false },
    { name: 'analytics-api', tier: 'tier-2', env: 'prod', public_facing: false },
    { name: 'notify-worker', tier: 'tier-1', env: 'prod', public_facing: false },
    { name: 'search-api', tier: 'tier-1', env: 'prod', public_facing: false },
  ];

  // ─── 2 teams, 4 people, exactly one currently on call ─────────────────────
  ds.teams = [
    { name: HERO_TEAM, slack_channel: '#platform-oncall' },
    { name: 'product-eng', slack_channel: '#product-oncall' },
  ];
  ds.people = [
    {
      name: 'Priya Raman',
      email: HERO_ONCALL_EMAIL,
      oncall_until: isoPlusHours(8, now),
      slack_handle: '@priya',
    },
    {
      name: 'Marcus Feld',
      email: 'm.feld@hopper.dev',
      oncall_until: null,
      slack_handle: '@marcus',
    },
    {
      name: 'Dana Whitlock',
      email: 'd.whitlock@hopper.dev',
      oncall_until: null,
      slack_handle: '@dana',
    },
    {
      name: 'Sam Okafor',
      email: 's.okafor@hopper.dev',
      oncall_until: null,
      slack_handle: '@sam',
    },
  ];

  // ─── 5 customers ──────────────────────────────────────────────────────────
  ds.customers = [
    { name: HERO_CUSTOMER, tier: 'enterprise', arr: 2_400_000, region: 'us' },
    { name: 'Contoso Logistics', tier: 'enterprise', arr: 1_150_000, region: 'eu' },
    { name: 'Fabrikam Health', tier: 'enterprise', arr: 3_100_000, region: 'us' },
    { name: 'Tailwind Retail', tier: 'growth', arr: 420_000, region: 'apac' },
    { name: 'Litware Financial', tier: 'enterprise', arr: 1_980_000, region: 'eu' },
  ];

  // ─── 5 contracts, breach_notification at 24/48/72/72/24 ───────────────────
  ds.contracts = [
    { id: HERO_CONTRACT_ID, signed_at: '2024-03-11T00:00:00Z', governing_law: 'Delaware, USA' },
    { id: 'CTR-CTL-2023-004', signed_at: '2023-09-02T00:00:00Z', governing_law: 'Ireland' },
    { id: 'CTR-FBH-2025-002', signed_at: '2025-01-20T00:00:00Z', governing_law: 'New York, USA' },
    { id: 'CTR-TWR-2025-018', signed_at: '2025-06-14T00:00:00Z', governing_law: 'Singapore' },
    { id: 'CTR-LWF-2024-007', signed_at: '2024-11-05T00:00:00Z', governing_law: 'England & Wales' },
  ];
  ds.clauses = [
    {
      contract_id: HERO_CONTRACT_ID,
      type: 'breach_notification',
      hours: HERO_WINDOW_HOURS,
      text_ref: HERO_CLAUSE,
      text:
        'Supplier shall notify Customer in writing of any Security Incident affecting ' +
        'Customer Data or the Services within twenty-four (24) hours of becoming aware of it.',
    },
    {
      contract_id: 'CTR-CTL-2023-004',
      type: 'breach_notification',
      hours: 48,
      text_ref: '§9.1',
      text:
        'Notification of any confirmed or suspected Security Incident shall be provided ' +
        'within forty-eight (48) hours.',
    },
    {
      contract_id: 'CTR-FBH-2025-002',
      type: 'breach_notification',
      hours: 72,
      text_ref: '§4.2',
      text:
        'Supplier shall notify the Covered Entity within seventy-two (72) hours of discovery ' +
        'of a Breach of Unsecured Protected Health Information.',
    },
    {
      contract_id: 'CTR-TWR-2025-018',
      type: 'breach_notification',
      hours: 72,
      text_ref: '§11.4',
      text: 'Written notice of a Data Incident within seventy-two (72) hours of awareness.',
    },
    {
      contract_id: 'CTR-LWF-2024-007',
      type: 'breach_notification',
      hours: 24,
      text_ref: '§6.6',
      text:
        'Supplier shall notify within twenty-four (24) hours of any event materially ' +
        'affecting the confidentiality or integrity of Customer Data.',
    },
    // non-breach clauses so the WHERE cl.type = 'breach_notification' filter is real
    {
      contract_id: HERO_CONTRACT_ID,
      type: 'sla_uptime',
      hours: 0,
      text_ref: '§5.1',
      text: 'Monthly uptime of not less than 99.95%.',
    },
    {
      contract_id: 'CTR-CTL-2023-004',
      type: 'data_residency',
      hours: 0,
      text_ref: '§3.4',
      text: 'Customer Data shall be processed and stored within the EEA.',
    },
    {
      contract_id: 'CTR-FBH-2025-002',
      type: 'audit_right',
      hours: 0,
      text_ref: '§12.0',
      text: 'Customer may audit Supplier security controls once per contract year.',
    },
  ];

  // ─── (Repo)-[:USES]->(Package) ────────────────────────────────────────────
  // Declared roots only. Everything below them is real deps.dev data.
  // platform-build deliberately has no eslint — see the file header.
  ds.uses = [
    { repo: HERO_REPO, package: HERO_ROOT_PACKAGE, declared_version: '^30.0.0' },
    { repo: HERO_REPO, package: 'webpack', declared_version: '^5.99.0' },
    { repo: HERO_REPO, package: 'express', declared_version: '^5.1.0' },
    { repo: 'edge-gateway', package: 'express', declared_version: '^5.1.0' },
    { repo: 'edge-gateway', package: 'axios', declared_version: '^1.19.0' },
    { repo: 'checkout-web', package: 'next', declared_version: '^16.0.0' },
    { repo: 'checkout-web', package: 'jest', declared_version: '^30.0.0' },
    { repo: 'identity-svc', package: 'express', declared_version: '^5.1.0' },
    { repo: 'identity-svc', package: 'axios', declared_version: '^1.19.0' },
    { repo: 'analytics-etl', package: 'eslint', declared_version: '^10.0.0' },
    { repo: 'analytics-etl', package: 'axios', declared_version: '^1.19.0' },
    { repo: 'search-svc', package: 'eslint', declared_version: '^10.0.0' },
    { repo: 'search-svc', package: 'webpack', declared_version: '^5.99.0' },
  ];

  // ─── (Repo)-[:DEPLOYS]->(Service) ─────────────────────────────────────────
  ds.deploys = [
    { from: HERO_REPO, to: HERO_SERVICE },
    { from: 'edge-gateway', to: 'edge-gateway' },
    { from: 'edge-gateway', to: 'notify-worker' },
    { from: 'checkout-web', to: 'checkout-web' },
    { from: 'checkout-web', to: 'payments-api' },
    { from: 'identity-svc', to: 'identity-api' },
    { from: 'analytics-etl', to: 'analytics-api' },
    { from: 'search-svc', to: 'search-api' },
  ];

  // ─── (Service)-[:CALLS]->(Service) ────────────────────────────────────────
  ds.calls = [
    { from: 'edge-gateway', to: HERO_SERVICE },
    { from: 'edge-gateway', to: 'identity-api' },
    { from: 'edge-gateway', to: 'checkout-web' },
    { from: 'checkout-web', to: 'payments-api' },
    { from: 'payments-api', to: 'identity-api' },
    { from: HERO_SERVICE, to: 'search-api' },
    { from: 'notify-worker', to: 'identity-api' },
    { from: 'analytics-api', to: 'search-api' },
  ];

  // ─── (Service)-[:OWNED_BY]->(Team), (Team)-[:ONCALL]->(Person) ────────────
  ds.ownedBy = [
    { from: HERO_SERVICE, to: HERO_TEAM },
    { from: 'edge-gateway', to: HERO_TEAM },
    { from: 'search-api', to: HERO_TEAM },
    { from: 'notify-worker', to: HERO_TEAM },
    { from: 'checkout-web', to: 'product-eng' },
    { from: 'payments-api', to: 'product-eng' },
    { from: 'identity-api', to: 'product-eng' },
    { from: 'analytics-api', to: 'product-eng' },
  ];
  ds.oncall = [
    { from: HERO_TEAM, to: HERO_ONCALL_EMAIL },
    { from: HERO_TEAM, to: 'm.feld@hopper.dev' },
    { from: 'product-eng', to: 'd.whitlock@hopper.dev' },
    { from: 'product-eng', to: 's.okafor@hopper.dev' },
  ];

  // ─── (Service)-[:SERVES]->(Customer) ──────────────────────────────────────
  // Northwind is served only by build-api so its shortest path is the hero path.
  ds.serves = [
    { from: HERO_SERVICE, to: HERO_CUSTOMER },
    { from: 'search-api', to: 'Contoso Logistics' },
    { from: 'payments-api', to: 'Fabrikam Health' },
    { from: 'analytics-api', to: 'Tailwind Retail' },
    { from: 'identity-api', to: 'Litware Financial' },
  ];

  // ─── (Customer)-[:SIGNED]->(Contract)-[:HAS_CLAUSE]->(Clause) ─────────────
  ds.signed = [
    { from: HERO_CUSTOMER, to: HERO_CONTRACT_ID },
    { from: 'Contoso Logistics', to: 'CTR-CTL-2023-004' },
    { from: 'Fabrikam Health', to: 'CTR-FBH-2025-002' },
    { from: 'Tailwind Retail', to: 'CTR-TWR-2025-018' },
    { from: 'Litware Financial', to: 'CTR-LWF-2024-007' },
  ];
  ds.hasClause = ds.clauses.map((c) => ({ from: c.contract_id, to: c.text_ref }));

  // ─── 3 PatchAttempts — the memory that beat 3 pays off ────────────────────
  const t = now.getTime();
  ds.patchAttempts = [
    {
      id: 'pa_minimatch_3_1_2',
      package: 'minimatch',
      from_v: '3.0.4',
      to_v: '3.1.2',
      outcome: 'success',
      ts: daysAgo(21, t),
      notes:
        'Bumped across 4 repos to clear GHSA-f8q6-p94x-37v3. Full suite green, no downstream churn.',
    },
    {
      id: 'pa_brace_expansion_2_0_1',
      package: 'brace-expansion',
      from_v: '1.1.11',
      to_v: '2.0.1',
      outcome: 'broke_staging',
      ts: daysAgo(9, t),
      notes:
        'Major bump changed expand() return ordering; glob@7 pattern resolution failed in staging. Reverted in 40m.',
    },
    {
      id: 'pa_glob_9_3_5',
      package: 'glob',
      from_v: '7.2.3',
      to_v: '9.3.5',
      outcome: 'rolled_back',
      ts: daysAgo(3, t),
      notes:
        'glob@9 dropped the sync API used by build-api. Rolled back; pinned 7.2.3 pending refactor.',
    },
  ];

  return ds;
}
