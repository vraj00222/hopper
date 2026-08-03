/** Fixture locations, resolved from the repo root rather than the cwd. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIVE_FIXTURE = 'fixtures/live.json';
export const REPLAY_FIXTURE = 'fixtures/replay.json';
export const KEV_FIXTURE = 'fixtures/kev.json';

let cachedRoot: string | null = null;

/** Walk up from this module until we find the workspace root. */
export function repoRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'contracts', 'src', 'index.ts'))) {
      cachedRoot = dir;
      return dir;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  cachedRoot = process.cwd();
  return cachedRoot;
}

export function fixturePath(rel: string): string {
  return isAbsolute(rel) ? rel : resolve(repoRoot(), rel);
}

export function readJson<T>(rel: string): T | null {
  const p = fixturePath(rel);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function writeJson(rel: string, value: unknown): string {
  const p = fixturePath(rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return p;
}

/** "4h 12m" / "3d 04h" / "38s" — advisory age, read out loud in the demo. */
export function fmtAge(iso: string, from: Date = new Date()): string {
  const ms = from.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'unknown';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
