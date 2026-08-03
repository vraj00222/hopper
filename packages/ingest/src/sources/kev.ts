/**
 * L4 source — the CISA Known Exploited Vulnerabilities catalog.
 *
 *   GET https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
 *
 * ~1,656 CVEs that are confirmed exploited in the wild. A tracked CVE appearing
 * here is not new information about the bug, it is new information about the
 * world — so it escalates. Successive polls are diffed into KevDeltaEvents.
 */
import { nowIso } from '@hopper/contracts';
import type { KevDeltaEvent } from '@hopper/contracts';

import { KEV_FIXTURE, readJson, writeJson } from '../paths.js';
import { getJson } from './http.js';

const FEED = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

export interface KevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  knownRansomwareCampaignUse: boolean;
}

export interface KevCatalog {
  catalogVersion: string;
  dateReleased: string;
  count: number;
  fetched_at: string;
  origin: 'cisa' | 'fixture' | 'empty';
  cves: KevEntry[];
}

interface RawKev {
  catalogVersion?: string;
  dateReleased?: string;
  count?: number;
  vulnerabilities?: Array<{
    cveID?: string;
    vendorProject?: string;
    product?: string;
    vulnerabilityName?: string;
    dateAdded?: string;
    knownRansomwareCampaignUse?: string;
  }>;
}

export interface KevIndex {
  has(cve: string | null | undefined): boolean;
  entry(cve: string | null | undefined): KevEntry | null;
  size: number;
  ids(): Set<string>;
}

export function kevIndex(catalog: KevCatalog): KevIndex {
  const byId = new Map<string, KevEntry>();
  for (const e of catalog.cves) byId.set(e.cveID.toUpperCase(), e);
  return {
    has: (cve) => (typeof cve === 'string' ? byId.has(cve.toUpperCase()) : false),
    entry: (cve) => (typeof cve === 'string' ? byId.get(cve.toUpperCase()) ?? null : null),
    size: byId.size,
    ids: () => new Set(byId.keys()),
  };
}

const EMPTY: KevCatalog = {
  catalogVersion: 'unavailable',
  dateReleased: nowIso(),
  count: 0,
  fetched_at: nowIso(),
  origin: 'empty',
  cves: [],
};

/**
 * Network first, fixture second, empty last. Always writes the cache on a
 * successful fetch so `MOCK=true` runs have something real to work with.
 */
export async function fetchKev(opts?: { mock?: boolean; cache?: boolean }): Promise<KevCatalog> {
  if (opts?.mock) {
    const cached = readJson<KevCatalog>(KEV_FIXTURE);
    // origin reports where *this* read came from, never where the cache was born
    return cached ? { ...cached, origin: 'fixture' } : EMPTY;
  }
  const res = await getJson<RawKev>(FEED, 25_000);
  if (res.ok && res.body?.vulnerabilities) {
    const catalog: KevCatalog = {
      catalogVersion: res.body.catalogVersion ?? 'unknown',
      dateReleased: res.body.dateReleased ?? nowIso(),
      count: res.body.count ?? res.body.vulnerabilities.length,
      fetched_at: nowIso(),
      origin: 'cisa',
      cves: res.body.vulnerabilities
        .filter((v) => typeof v.cveID === 'string')
        .map((v) => ({
          cveID: String(v.cveID),
          vendorProject: v.vendorProject ?? '',
          product: v.product ?? '',
          vulnerabilityName: v.vulnerabilityName ?? '',
          dateAdded: v.dateAdded ?? '',
          knownRansomwareCampaignUse: String(v.knownRansomwareCampaignUse ?? '').toLowerCase() === 'known',
        })),
    };
    if (opts?.cache !== false) writeJson(KEV_FIXTURE, catalog);
    return catalog;
  }
  const cached = readJson<KevCatalog>(KEV_FIXTURE);
  if (cached) return { ...cached, origin: 'fixture' };
  return EMPTY;
}

/** everything in `next` that was not in `prev` */
export function diffKev(prev: KevCatalog | null, next: KevCatalog, tracked?: Map<string, string>): KevDeltaEvent[] {
  const before = prev ? kevIndex(prev).ids() : new Set<string>();
  const out: KevDeltaEvent[] = [];
  for (const e of next.cves) {
    const key = e.cveID.toUpperCase();
    if (before.has(key)) continue;
    const ghsa = tracked?.get(key) ?? null;
    out.push({
      kind: 'kev-delta',
      cve_id: e.cveID,
      ghsa_id: ghsa,
      added_at: isoDay(e.dateAdded),
      known_ransomware: e.knownRansomwareCampaignUse,
      // we only escalate CVEs we are actually tracking; the rest are noise
      action: ghsa ? 'escalate' : 'noop',
    });
  }
  return out;
}

function isoDay(day: string): string {
  if (!day) return nowIso();
  const parsed = Date.parse(day.length === 10 ? `${day}T00:00:00Z` : day);
  return Number.isNaN(parsed) ? nowIso() : new Date(parsed).toISOString();
}
