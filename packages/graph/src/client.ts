/**
 * HOPPER — FalkorDB connection. The only file in the repo that imports the driver.
 */
import { FalkorDB } from 'falkordb';
import type { FalkorDBOptions } from 'falkordb';
import type Graph from 'falkordb/dist/src/graph.js';

export const DEFAULT_URL = 'falkor://localhost:6379';
export const DEFAULT_GRAPH = 'hopper';

export interface ClientOptions {
  url?: string;
  graph?: string;
  /** per-attempt connect timeout */
  connectTimeoutMs?: number;
  /** how many times to try before giving up and letting the caller fall back */
  attempts?: number;
}

export interface Endpoint {
  host: string;
  port: number;
}

/** `falkor://host:6379`, `redis://host:6379`, `host:6379`, `host` all parse. */
export function parseUrl(url: string): Endpoint {
  const stripped = url.replace(/^[a-z]+:\/\//i, '');
  const withoutPath = stripped.split('/')[0];
  const at = withoutPath.includes('@')
    ? withoutPath.slice(withoutPath.lastIndexOf('@') + 1)
    : withoutPath;
  const [host, port] = at.split(':');
  return { host: host || 'localhost', port: port ? Number(port) : 6379 };
}

export class FalkorClient {
  private db: FalkorDB | null = null;
  private g: Graph | null = null;
  readonly endpoint: Endpoint;
  readonly graphName: string;
  private readonly connectTimeoutMs: number;
  private readonly attempts: number;

  constructor(opts: ClientOptions = {}) {
    this.endpoint = parseUrl(opts.url ?? process.env.FALKOR_URL ?? DEFAULT_URL);
    this.graphName = opts.graph ?? process.env.FALKOR_GRAPH ?? DEFAULT_GRAPH;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 1500;
    this.attempts = opts.attempts ?? 2;
  }

  get connected(): boolean {
    return this.g !== null;
  }

  async connect(): Promise<void> {
    if (this.g) return;
    let lastErr: unknown;
    for (let i = 0; i < this.attempts; i += 1) {
      try {
        // reconnectStrategy is a node-redis socket option the driver forwards
        // but does not surface in its narrower SocketOptions type. Without it a
        // dead FalkorDB leaves a reconnect loop running behind the fallback.
        const socket = {
          host: this.endpoint.host,
          port: this.endpoint.port,
          connectTimeout: this.connectTimeoutMs,
          reconnectStrategy: false,
        } as unknown as NonNullable<FalkorDBOptions['socket']>;
        const db = await FalkorDB.connect({ socket });
        const g = db.selectGraph(this.graphName);
        // touch it so an unreachable server fails here, not on the first query
        await g.query('RETURN 1');
        this.db = db;
        this.g = g;
        return;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 120 * (i + 1)));
      }
    }
    throw new Error(
      `FalkorDB unreachable at ${this.endpoint.host}:${this.endpoint.port} — ` +
        `${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }

  async close(): Promise<void> {
    const db = this.db;
    this.db = null;
    this.g = null;
    if (db) await db.close().catch(() => undefined);
  }

  /** raw passthrough — every Cypher statement in this package goes through here */
  async query<T = Record<string, unknown>>(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    if (!this.g) throw new Error('FalkorClient.query called before connect()');
    const res = await this.g.query<T>(
      cypher,
      params ? { params: params as never } : undefined,
    );
    return (res.data ?? []) as T[];
  }

  /** like query() but swallows errors matching `tolerate` — used by applySchema */
  async queryTolerant(cypher: string, tolerate: RegExp): Promise<'ok' | 'skipped'> {
    try {
      await this.query(cypher);
      return 'ok';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (tolerate.test(msg)) return 'skipped';
      throw err;
    }
  }
}

/** cheap reachability probe used by createGraph() to decide on a backend */
export async function falkorReachable(opts: ClientOptions = {}): Promise<boolean> {
  const c = new FalkorClient({ ...opts, attempts: 1, connectTimeoutMs: opts.connectTimeoutMs ?? 800 });
  try {
    await c.connect();
    await c.close();
    return true;
  } catch {
    await c.close().catch(() => undefined);
    return false;
  }
}
