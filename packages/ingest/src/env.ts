/**
 * LaserData connection resolution.
 *
 * Documented by LaserData (docs.laserdata.cloud/laser-sdk/connect) and
 * confirmed against laser-sdk 0.0.1's own `Laser.connectEnv()`, which reads
 * LASER_CONNECTION_STRING plus LASER_STREAM. Cloud hosts look like
 * `starter-123.us-west-1.aws.laserdata.cloud:8090`. The transport is Apache
 * Iggy over TCP — laserdata.com is the marketing site and will never connect.
 *
 * Precedence:
 *   1. LASER_CONNECTION_STRING   (or the legacy LASER_URL this package shipped with)
 *   2. LASER_SERVER + LASER_USERNAME/LASER_PASSWORD, or LASER_SERVER + LASER_TOKEN
 *   3. nothing -> stay on the local transport
 *
 * Credentials are never logged. `describe()` returns a redacted summary safe to
 * print in a gate or a server banner.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './paths.js';

export const DEFAULT_IGGY_PORT = 8090;
export const DEFAULT_STREAM = 'hopper';

export interface LaserConfig {
  /** the connection string to hand to Laser.connect(), or null to stay local */
  connectionString: string | null;
  stream: string;
  /** how we got here, safe to print */
  reason: string;
  source: 'LASER_CONNECTION_STRING' | 'LASER_URL' | 'LASER_SERVER' | 'none';
  /** host:port, no credentials — safe to print */
  endpoint: string | null;
  tls: boolean;
}

/**
 * Minimal .env reader. No dependency, no export syntax, no interpolation —
 * KEY=VALUE, # comments, optional surrounding quotes. Never overwrites a
 * variable that is already set in the environment.
 */
export function loadDotEnv(dir: string = repoRoot(), env: NodeJS.ProcessEnv = process.env): string[] {
  const path = join(dir, '.env');
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const applied: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    // the process environment always wins over the file
    if (env[key] !== undefined) continue;
    env[key] = value;
    applied.push(key);
  }
  return applied;
}

function clean(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t.length > 0 ? t : null;
}

function isTruthy(v: string | undefined): boolean {
  const t = (v ?? '').trim().toLowerCase();
  return t === '1' || t === 'true' || t === 'yes' || t === 'on';
}

/** strip scheme + credentials so an endpoint can be printed */
export function redactEndpoint(connectionString: string): string {
  const bare = connectionString.trim().replace(/^iggy(\+\w+)?:\/\//i, '');
  const authority = bare.includes('@') ? bare.slice(bare.lastIndexOf('@') + 1) : bare;
  return authority.split('/')[0] || 'unknown';
}

export function resolveLaserConfig(env: NodeJS.ProcessEnv = process.env): LaserConfig {
  const stream = clean(env.LASER_STREAM) ?? DEFAULT_STREAM;
  const noTls = isTruthy(env.LASER_NO_TLS);
  const tls = !noTls;

  const direct = clean(env.LASER_CONNECTION_STRING);
  if (direct) {
    return {
      connectionString: direct,
      stream,
      reason: `LASER_CONNECTION_STRING is set (${redactEndpoint(direct)})`,
      source: 'LASER_CONNECTION_STRING',
      endpoint: redactEndpoint(direct),
      tls,
    };
  }

  // the variable this package originally shipped with, kept working
  const legacy = clean(env.LASER_URL);
  if (legacy) {
    return {
      connectionString: legacy,
      stream,
      reason: `LASER_URL is set (${redactEndpoint(legacy)})`,
      source: 'LASER_URL',
      endpoint: redactEndpoint(legacy),
      tls,
    };
  }

  const server = clean(env.LASER_SERVER);
  if (server) {
    const authority = /:\d+$/.test(server) ? server : `${server}:${DEFAULT_IGGY_PORT}`;
    const username = clean(env.LASER_USERNAME);
    const password = clean(env.LASER_PASSWORD);
    const token = clean(env.LASER_TOKEN);
    let credential: string | null = null;
    let how = 'no credentials';
    if (username && password) {
      credential = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`;
      how = 'LASER_USERNAME/LASER_PASSWORD';
    } else if (token) {
      credential = encodeURIComponent(token);
      how = 'LASER_TOKEN';
    }
    const connectionString = `iggy://${credential ? `${credential}@` : ''}${authority}`;
    return {
      connectionString,
      stream,
      reason: `assembled from LASER_SERVER (${authority}) with ${how}`,
      source: 'LASER_SERVER',
      endpoint: authority,
      tls,
    };
  }

  // A token on its own cannot connect — say so, rather than failing silently.
  const orphanToken = clean(env.LASER_TOKEN) !== null;
  return {
    connectionString: null,
    stream,
    reason: orphanToken
      ? 'LASER_TOKEN is set but LASER_CONNECTION_STRING and LASER_SERVER are both empty — no host to connect to'
      : 'no LASER_CONNECTION_STRING, LASER_URL or LASER_SERVER — local transport',
    source: 'none',
    endpoint: null,
    tls,
  };
}
