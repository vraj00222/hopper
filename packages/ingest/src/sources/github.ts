/**
 * L1 source A — the GitHub Advisory API.
 *
 *   GET https://api.github.com/advisories?ecosystem=npm&per_page=50
 *
 * Unauthenticated: 60 requests/hour per IP. When that budget is gone the API
 * answers 403 (or 429) with a rate-limit body — that is not an error, it is a
 * signal to cascade to OSV. We report it as such rather than throwing.
 */
import type { Advisory, Ecosystem } from '@hopper/contracts';

import { bandForScore, cvssFromVector, normaliseSeverity, scoreForBand } from './cvss.js';
import { getJson } from './http.js';

const ENDPOINT = 'https://api.github.com/advisories';

export interface SourceResult {
  advisories: Advisory[];
  ok: boolean;
  status: number;
  rateLimited: boolean;
  error: string | null;
  note: string;
}

interface GhVulnerability {
  package?: { ecosystem?: string; name?: string } | null;
  vulnerable_version_range?: string | null;
  first_patched_version?: string | null;
}

interface GhAdvisory {
  ghsa_id?: string;
  cve_id?: string | null;
  summary?: string;
  severity?: string;
  published_at?: string;
  withdrawn_at?: string | null;
  vulnerabilities?: GhVulnerability[] | null;
  cvss?: { score?: number | null; vector_string?: string | null } | null;
  cvss_severities?: {
    cvss_v3?: { score?: number | null; vector_string?: string | null } | null;
    cvss_v4?: { score?: number | null; vector_string?: string | null } | null;
  } | null;
}

/** GitHub's ecosystem names -> the contract's */
const ECOSYSTEM: Record<string, Ecosystem> = {
  npm: 'npm',
  pip: 'pypi',
  pypi: 'pypi',
  go: 'go',
  maven: 'maven',
  rust: 'cargo',
  cargo: 'cargo',
  rubygems: 'rubygems',
};

export async function fetchGithubAdvisories(opts?: {
  ecosystem?: Ecosystem;
  limit?: number;
  hours?: number;
}): Promise<SourceResult> {
  const ecosystem = opts?.ecosystem ?? 'npm';
  const limit = Math.min(opts?.limit ?? 50, 100);
  const ghEco = ecosystem === 'pypi' ? 'pip' : ecosystem === 'cargo' ? 'rust' : ecosystem;
  const url = `${ENDPOINT}?ecosystem=${encodeURIComponent(ghEco)}&per_page=${limit}&sort=published&direction=desc`;

  const res = await getJson<GhAdvisory[]>(url);
  if (!res.ok || !Array.isArray(res.body)) {
    return {
      advisories: [],
      ok: false,
      status: res.status,
      rateLimited: res.rateLimited,
      error: res.error,
      note: res.rateLimited
        ? `github rate-limited (HTTP ${res.status}, 60 req/hr unauthenticated) — cascading to osv`
        : `github unreachable (${res.error ?? `HTTP ${res.status}`}) — cascading to osv`,
    };
  }

  const mapped = res.body
    .filter((a) => !a.withdrawn_at)
    .map((a) => toAdvisory(a))
    .filter((a): a is Advisory => a !== null);

  // hours is a soft filter — never starve the feed just because today was quiet
  let advisories = mapped;
  if (opts?.hours && opts.hours > 0) {
    const cutoff = Date.now() - opts.hours * 3_600_000;
    const recent = mapped.filter((a) => Date.parse(a.published_at) >= cutoff);
    if (recent.length >= 5) advisories = recent;
  }

  return {
    advisories,
    ok: true,
    status: res.status,
    rateLimited: false,
    error: null,
    note: `github returned ${advisories.length} ${ecosystem} advisories`,
  };
}

function toAdvisory(a: GhAdvisory): Advisory | null {
  const ghsa_id = a.ghsa_id;
  if (typeof ghsa_id !== 'string' || !ghsa_id.startsWith('GHSA-')) return null;

  const vuln = (a.vulnerabilities ?? []).find((v) => v.package?.name) ?? null;
  const rawEco = String(vuln?.package?.ecosystem ?? 'npm').toLowerCase();
  const ecosystem = ECOSYSTEM[rawEco];
  if (!ecosystem) return null;

  const vector = a.cvss?.vector_string ?? a.cvss_severities?.cvss_v3?.vector_string ?? null;
  const numeric =
    numberOrNull(a.cvss?.score) ??
    numberOrNull(a.cvss_severities?.cvss_v3?.score) ??
    cvssFromVector(vector) ??
    numberOrNull(a.cvss_severities?.cvss_v4?.score);

  const severity = normaliseSeverity(a.severity, numeric !== null ? bandForScore(numeric) : 'MODERATE');
  const cvss = numeric ?? scoreForBand(severity);

  return {
    ghsa_id,
    cve_id: typeof a.cve_id === 'string' && a.cve_id.length > 0 ? a.cve_id : null,
    severity,
    cvss,
    published_at: a.published_at ?? new Date().toISOString(),
    summary: (a.summary ?? `${vuln?.package?.name ?? 'package'} advisory`).trim(),
    in_kev: false,
    ecosystem,
    package_name: vuln?.package?.name ?? 'unknown',
    vulnerable_range: vuln?.vulnerable_version_range ?? '*',
    fixed_in: vuln?.first_patched_version ?? null,
    source: 'github',
  };
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}
