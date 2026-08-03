/**
 * CVSS v3.x base score from a vector string. OSV hands out vectors, the
 * contract wants a number, and "7.5" on screen has to be the real 7.5.
 * Formula: FIRST CVSS v3.1 specification, section 7.1.
 */
import type { Severity } from '@hopper/contracts';

const AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const AC: Record<string, number> = { L: 0.77, H: 0.44 };
const PR_U: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
const PR_C: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };
const UI: Record<string, number> = { N: 0.85, R: 0.62 };
const CIA: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };

export function cvssFromVector(vector: string | null | undefined): number | null {
  if (!vector || !/^CVSS:3\.[01]\//i.test(vector)) return null;
  const m = new Map<string, string>();
  for (const part of vector.split('/').slice(1)) {
    const [k, v] = part.split(':');
    if (k && v) m.set(k.toUpperCase(), v.toUpperCase());
  }
  const scope = m.get('S');
  const av = AV[m.get('AV') ?? ''];
  const ac = AC[m.get('AC') ?? ''];
  const pr = (scope === 'C' ? PR_C : PR_U)[m.get('PR') ?? ''];
  const ui = UI[m.get('UI') ?? ''];
  const c = CIA[m.get('C') ?? ''];
  const i = CIA[m.get('I') ?? ''];
  const a = CIA[m.get('A') ?? ''];
  if ([av, ac, pr, ui, c, i, a].some((x) => x === undefined)) return null;

  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact =
    scope === 'C' ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av * ac * pr * ui;
  const raw = scope === 'C' ? 1.08 * (impact + exploitability) : impact + exploitability;
  return roundUp(Math.min(raw, 10));
}

/** CVSS rounds *up* to one decimal — 4.02 is 4.1, not 4.0. */
function roundUp(n: number): number {
  const scaled = Math.round(n * 100000);
  return scaled % 10000 === 0 ? scaled / 100000 : (Math.floor(scaled / 10000) + 1) / 10;
}

/** severity band -> a representative score, for records with no vector at all */
export function scoreForBand(sev: Severity): number {
  switch (sev) {
    case 'CRITICAL':
      return 9.8;
    case 'HIGH':
      return 7.5;
    case 'MODERATE':
      return 5.3;
    default:
      return 3.1;
  }
}

export function bandForScore(score: number): Severity {
  if (score >= 9) return 'CRITICAL';
  if (score >= 7) return 'HIGH';
  if (score >= 4) return 'MODERATE';
  return 'LOW';
}

/** GitHub says "medium", OSV says "MODERATE", the contract says MODERATE. */
export function normaliseSeverity(raw: string | null | undefined, fallback: Severity = 'MODERATE'): Severity {
  const v = String(raw ?? '').toUpperCase();
  if (v === 'CRITICAL') return 'CRITICAL';
  if (v === 'HIGH') return 'HIGH';
  if (v === 'MODERATE' || v === 'MEDIUM') return 'MODERATE';
  if (v === 'LOW') return 'LOW';
  return fallback;
}
