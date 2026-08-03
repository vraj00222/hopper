/** Tiny shared helpers. Deterministic ids so replays diff cleanly. */

let counter = 0;

export function id(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(3, '0')}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoPlusHours(hours: number, from: Date = new Date()): string {
  return new Date(from.getTime() + hours * 3_600_000).toISOString();
}

export function secondsUntil(iso: string, from: Date = new Date()): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - from.getTime()) / 1000));
}

export function fmtCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `T-${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function isMock(): boolean {
  const v = process.env.MOCK;
  return v === undefined ? true : v !== 'false' && v !== '0';
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** severity → band used by the AdvisoryClass id */
export function severityBand(s: string): 'low' | 'moderate' | 'high' | 'critical' {
  const v = s.toLowerCase();
  if (v === 'critical') return 'critical';
  if (v === 'high') return 'high';
  if (v === 'moderate' || v === 'medium') return 'moderate';
  return 'low';
}

/** hop depth → band used by the AdvisoryClass id */
export function depthBand(maxHops: number, pathCount: number): 'direct' | 'shallow' | 'deep' | 'none' {
  if (pathCount === 0) return 'none';
  if (maxHops <= 1) return 'direct';
  if (maxHops <= 3) return 'shallow';
  return 'deep';
}

export function classId(
  ecosystem: string,
  severity_band: string,
  depth_band: string,
): string {
  return `${ecosystem}/${severity_band}/${depth_band}`;
}
