/**
 * L1 source B — OSV.dev. The cascade target when GitHub is rate-limited.
 *
 *   POST https://api.osv.dev/v1/query      {"package":{"name":"…","ecosystem":"npm"}}
 *   POST https://api.osv.dev/v1/querybatch {"queries":[…]}   (ids only, hydrated via /v1/vulns/:id)
 *
 * OSV records are richer and messier than GitHub's: severity lives in
 * `database_specific.severity`, the score has to come out of a CVSS vector, and
 * the vulnerable range has to be rebuilt from introduced/fixed event pairs.
 */
import type { Advisory, Ecosystem } from '@hopper/contracts';

import { bandForScore, cvssFromVector, normaliseSeverity, scoreForBand } from './cvss.js';
import { getJson, pool, postJson } from './http.js';
import type { SourceResult } from './github.js';

const QUERY = 'https://api.osv.dev/v1/query';
const QUERYBATCH = 'https://api.osv.dev/v1/querybatch';
const VULN = 'https://api.osv.dev/v1/vulns';

interface OsvEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
  limit?: string;
}
interface OsvRange {
  type?: string;
  events?: OsvEvent[];
}
interface OsvAffected {
  package?: { name?: string; ecosystem?: string; purl?: string };
  ranges?: OsvRange[];
  versions?: string[];
}
export interface OsvVuln {
  id?: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  published?: string;
  modified?: string;
  withdrawn?: string;
  severity?: Array<{ type?: string; score?: string }>;
  affected?: OsvAffected[];
  database_specific?: { severity?: string; cwe_ids?: string[] };
}

const ECOSYSTEM: Record<string, Ecosystem> = {
  npm: 'npm',
  pypi: 'pypi',
  go: 'go',
  maven: 'maven',
  'crates.io': 'cargo',
  cargo: 'cargo',
  rubygems: 'rubygems',
};

const OSV_ECOSYSTEM: Record<Ecosystem, string> = {
  npm: 'npm',
  pypi: 'PyPI',
  go: 'Go',
  maven: 'Maven',
  cargo: 'crates.io',
  rubygems: 'RubyGems',
};

/** one /v1/query per package, four at a time */
export async function queryOsv(
  packages: readonly string[],
  ecosystem: Ecosystem = 'npm',
): Promise<SourceResult> {
  const results = await pool([...packages], 4, async (name) => {
    const res = await postJson<{ vulns?: OsvVuln[] }>(QUERY, {
      package: { name, ecosystem: OSV_ECOSYSTEM[ecosystem] },
    });
    return { name, res };
  });

  const advisories: Advisory[] = [];
  const failures: string[] = [];
  let anyOk = false;
  let status = 0;

  for (const { name, res } of results) {
    status = res.status || status;
    if (!res.ok || !res.body) {
      failures.push(`${name}:${res.error ?? res.status}`);
      continue;
    }
    anyOk = true;
    for (const v of res.body.vulns ?? []) {
      const a = toAdvisory(v, name);
      if (a) advisories.push(a);
    }
  }

  return {
    advisories: dedupe(advisories),
    ok: anyOk,
    status,
    rateLimited: false,
    error: failures.length ? failures.join(', ') : null,
    note: anyOk
      ? `osv returned ${dedupe(advisories).length} advisories across ${packages.length} packages`
      : `osv unreachable (${failures.join(', ') || 'no response'})`,
  };
}

/**
 * /v1/querybatch — one round trip for every package, but it answers with ids
 * and modification stamps only, so the records are hydrated from /v1/vulns/:id.
 */
export async function queryOsvBatch(
  packages: readonly string[],
  ecosystem: Ecosystem = 'npm',
  opts?: { hydrate?: number },
): Promise<SourceResult> {
  const res = await postJson<{ results?: Array<{ vulns?: Array<{ id?: string }> }> }>(QUERYBATCH, {
    queries: packages.map((name) => ({ package: { name, ecosystem: OSV_ECOSYSTEM[ecosystem] } })),
  });
  if (!res.ok || !res.body) {
    return {
      advisories: [],
      ok: false,
      status: res.status,
      rateLimited: res.rateLimited,
      error: res.error,
      note: `osv querybatch unreachable (${res.error ?? `HTTP ${res.status}`})`,
    };
  }

  const owner = new Map<string, string>();
  const ids: string[] = [];
  (res.body.results ?? []).forEach((r, i) => {
    for (const v of r.vulns ?? []) {
      if (typeof v.id === 'string' && !owner.has(v.id)) {
        owner.set(v.id, packages[i] ?? '');
        ids.push(v.id);
      }
    }
  });

  const wanted = ids.slice(0, opts?.hydrate ?? 60);
  const hydrated = await pool(wanted, 6, async (vid) => getJson<OsvVuln>(`${VULN}/${vid}`));
  const advisories: Advisory[] = [];
  hydrated.forEach((h, i) => {
    if (h.ok && h.body) {
      const a = toAdvisory(h.body, owner.get(wanted[i]) ?? '');
      if (a) advisories.push(a);
    }
  });

  return {
    advisories: dedupe(advisories),
    ok: true,
    status: res.status,
    rateLimited: false,
    error: null,
    note: `osv querybatch matched ${ids.length} ids, hydrated ${advisories.length}`,
  };
}

// ── mapping ────────────────────────────────────────────────────────────────

export function toAdvisory(v: OsvVuln, preferredPackage = ''): Advisory | null {
  if (v.withdrawn) return null;
  const aliases = v.aliases ?? [];
  const ghsa_id =
    typeof v.id === 'string' && v.id.startsWith('GHSA-')
      ? v.id
      : aliases.find((a) => a.startsWith('GHSA-')) ?? null;
  if (!ghsa_id) return null;

  const cve_id =
    (typeof v.id === 'string' && v.id.startsWith('CVE-') ? v.id : null) ??
    aliases.find((a) => a.startsWith('CVE-')) ??
    null;

  const affected = pickAffected(v.affected ?? [], preferredPackage);
  const rawEco = String(affected?.package?.ecosystem ?? 'npm').toLowerCase();
  const ecosystem = ECOSYSTEM[rawEco.split(':')[0]] ?? null;
  if (!ecosystem) return null;

  const vector =
    v.severity?.find((s) => (s.type ?? '').toUpperCase() === 'CVSS_V3')?.score ??
    v.severity?.find((s) => (s.score ?? '').startsWith('CVSS:3'))?.score ??
    null;
  const numeric = cvssFromVector(vector);
  const severity = normaliseSeverity(
    v.database_specific?.severity,
    numeric !== null ? bandForScore(numeric) : 'MODERATE',
  );

  const packageName = affected?.package?.name ?? preferredPackage ?? 'unknown';
  const sameName = (v.affected ?? []).filter((a) => a.package?.name === packageName);

  return {
    ghsa_id,
    cve_id,
    severity,
    cvss: numeric ?? scoreForBand(severity),
    published_at: v.published ?? v.modified ?? new Date().toISOString(),
    summary: (v.summary ?? firstLine(v.details) ?? `${packageName} advisory`).trim(),
    in_kev: false,
    ecosystem,
    package_name: packageName,
    vulnerable_range: rangeString(sameName),
    fixed_in: highestFixed(sameName),
    source: 'osv',
  };
}

function pickAffected(affected: OsvAffected[], preferred: string): OsvAffected | null {
  if (affected.length === 0) return null;
  return affected.find((a) => a.package?.name === preferred) ?? affected[0];
}

/** rebuild "< 1.1.18" / ">= 3.0.0, < 5.0.7" out of introduced/fixed events */
export function rangeString(affected: OsvAffected[]): string {
  const parts: string[] = [];
  for (const a of affected) {
    for (const r of a.ranges ?? []) {
      let introduced: string | null = null;
      for (const ev of r.events ?? []) {
        if (ev.introduced !== undefined) {
          introduced = ev.introduced;
        } else if (ev.fixed !== undefined) {
          parts.push(introduced && introduced !== '0' ? `>= ${introduced}, < ${ev.fixed}` : `< ${ev.fixed}`);
          introduced = null;
        } else if (ev.last_affected !== undefined) {
          parts.push(
            introduced && introduced !== '0' ? `>= ${introduced}, <= ${ev.last_affected}` : `<= ${ev.last_affected}`,
          );
          introduced = null;
        }
      }
      if (introduced !== null) parts.push(introduced === '0' ? '*' : `>= ${introduced}`);
    }
  }
  const uniq = [...new Set(parts)];
  return uniq.length > 0 ? uniq.join(' || ') : '*';
}

export function highestFixed(affected: OsvAffected[]): string | null {
  const fixed: string[] = [];
  for (const a of affected) {
    for (const r of a.ranges ?? []) {
      for (const ev of r.events ?? []) if (ev.fixed) fixed.push(ev.fixed);
    }
  }
  if (fixed.length === 0) return null;
  return fixed.sort(compareVersions)[fixed.length - 1];
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na !== nb) return na - nb;
    } else {
      const sa = pa[i] ?? '';
      const sb = pb[i] ?? '';
      if (sa !== sb) return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

function firstLine(s: string | undefined): string | null {
  if (!s) return null;
  const line = s.split('\n').find((l) => l.trim().length > 0 && !l.trim().startsWith('#'));
  return line ? line.trim().slice(0, 240) : null;
}

function dedupe(list: Advisory[]): Advisory[] {
  const seen = new Map<string, Advisory>();
  for (const a of list) if (!seen.has(a.ghsa_id)) seen.set(a.ghsa_id, a);
  return [...seen.values()];
}
