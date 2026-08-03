/**
 * Thin bridge over the real `rocketride` client (npm `rocketride@1.3.0` — the
 * package is `rocketride`, NOT `@rocketride/sdk`, which is a 404).
 *
 * Cloud endpoint is `https://api.rocketride.ai`; the client upgrades it to
 * `wss://api.rocketride.ai/task/service` internally. `cloud.rocketride.ai` is
 * the web app and refuses the upgrade.
 *
 * Two rules shape this file:
 *
 *  1. The dependency is optional at runtime. The import is a lazy dynamic
 *     `import('rocketride')` behind a structural interface, so @hopper/orchestrate
 *     still loads, typechecks and passes its gate with the package absent.
 *  2. The demo never waits on somebody else's uptime. Every method resolves —
 *     none of them throw — and after a small number of failures the bridge
 *     latches off and says so once.
 *
 * The auth value is read once, held in a closure, never logged, never put in a
 * receipt, never returned by any method.
 */
import type { RocketRidePipeline } from './compile.js';

/** what `use()` gives back — verified live: id, token, publicToken, projectId, source */
export interface RemoteTask {
  id: string | null;
  token: string;
  publicToken: string | null;
  projectId: string | null;
  source: string | null;
}

/** structural view of the bits of RocketRideClient we use — no type-level dependency */
interface RocketRideClientLike {
  connect(credential?: string): Promise<unknown>;
  disconnect(): Promise<void>;
  isConnected?(): boolean;
  use(options: {
    pipeline?: unknown;
    name?: string;
    ttl?: number;
    source?: string;
    pipelineTraceLevel?: 'none' | 'metadata' | 'summary' | 'full';
  }): Promise<Record<string, unknown> & { token: string }>;
  send(
    token: string,
    data: string | Uint8Array,
    objinfo?: Record<string, unknown>,
    mimetype?: string,
  ): Promise<unknown>;
  terminate(token: string): Promise<void>;
}

type ClientCtor = new (config: Record<string, unknown>) => RocketRideClientLike;

export interface BridgeOptions {
  auth?: string;
  uri?: string;
  projectId?: string;
  requestTimeout?: number;
  /** how many consecutive failures before the bridge latches off */
  maxFailures?: number;
  log?: (msg: string) => void;
}

export interface RocketRideBridge {
  /** configured with a credential and not latched off */
  enabled(): boolean;
  connected(): boolean;
  /** connect (idempotent); resolves false instead of throwing */
  connect(): Promise<boolean>;
  /** load a pipeline OBJECT at runtime — the §4.3 call. null on any failure */
  dispatch(pipeline: RocketRidePipeline, name: string): Promise<RemoteTask | null>;
  /** push the run summary into the task so their trace panel has real content */
  report(task: RemoteTask, payload: string): Promise<boolean>;
  terminate(task: RemoteTask): Promise<void>;
  disconnect(): Promise<void>;
  status(): { enabled: boolean; connected: boolean; failures: number; lastError: string | null };
}

const BACKOFF_MS = [250, 1000, 3000];

export function createRocketRideBridge(opts: BridgeOptions = {}): RocketRideBridge {
  const auth = opts.auth ?? process.env.ROCKETRIDE_AUTH ?? process.env.ROCKETRIDE_APIKEY ?? '';
  const uri = opts.uri ?? process.env.ROCKETRIDE_URI ?? 'https://api.rocketride.ai';
  const projectId = opts.projectId ?? process.env.ROCKETRIDE_PROJECT_ID ?? 'hopper';
  const requestTimeout = opts.requestTimeout ?? 60_000;
  const maxFailures = opts.maxFailures ?? 2;
  const log = opts.log ?? (() => {});

  let client: RocketRideClientLike | null = null;
  let connecting: Promise<boolean> | null = null;
  let isConnected = false;
  let failures = 0;
  let latched = false;
  let lastError: string | null = null;
  let saidSo = false;

  function fail(where: string, e: unknown): null {
    failures += 1;
    lastError = `${where}: ${(e as Error)?.message ?? String(e)}`;
    if (failures >= maxFailures && !latched) {
      latched = true;
      log(`rocketride: disabled after ${failures} failures (${lastError}) — running locally`);
    } else if (!saidSo) {
      saidSo = true;
      log(`rocketride: ${lastError}`);
    }
    return null;
  }

  function enabled(): boolean {
    return auth.length > 0 && !latched;
  }

  async function loadCtor(): Promise<ClientCtor | null> {
    try {
      // lazy + dynamic so the package is genuinely optional at runtime
      const mod = (await import('rocketride')) as unknown as { RocketRideClient?: ClientCtor };
      if (!mod?.RocketRideClient) throw new Error("module has no export 'RocketRideClient'");
      return mod.RocketRideClient;
    } catch (e) {
      fail('import', e);
      return null;
    }
  }

  async function connectOnce(): Promise<boolean> {
    const Ctor = await loadCtor();
    if (!Ctor) return false;
    for (let attempt = 0; attempt < BACKOFF_MS.length; attempt += 1) {
      try {
        const c = new Ctor({ auth, uri, requestTimeout, persist: true });
        await c.connect();
        client = c;
        isConnected = true;
        failures = 0;
        log(`rocketride: connected to ${uri} (project ${projectId})`);
        return true;
      } catch (e) {
        if (attempt === BACKOFF_MS.length - 1) {
          fail('connect', e);
          return false;
        }
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
      }
    }
    return false;
  }

  async function connect(): Promise<boolean> {
    if (!enabled()) return false;
    if (isConnected && client) return true;
    if (!connecting) {
      connecting = connectOnce().finally(() => {
        connecting = null;
      });
    }
    return connecting;
  }

  return {
    enabled,
    connected: () => isConnected,
    connect,

    async dispatch(pipeline, name) {
      if (!(await connect()) || !client) return null;
      try {
        // THE §4.3 CALL: a pipeline OBJECT, loaded at runtime, never registered
        // in advance. Verified live — this is why no fallback to pre-registered
        // pipeline IDs is needed.
        const res = await client.use({ pipeline, name, ttl: 120 });
        if (!res?.token) throw new Error('use() returned no token');
        return {
          id: (res.id as string) ?? null,
          token: res.token,
          publicToken: (res.publicToken as string) ?? null,
          projectId: (res.projectId as string) ?? null,
          source: (res.source as string) ?? null,
        };
      } catch (e) {
        return fail('use', e);
      }
    },

    async report(task, payload) {
      if (!client || !task?.token) return false;
      try {
        await client.send(task.token, payload, { name: 'hopper-run.txt' }, 'text/plain');
        return true;
      } catch (e) {
        fail('send', e);
        return false;
      }
    },

    async terminate(task) {
      if (!client || !task?.token) return;
      try {
        await client.terminate(task.token);
      } catch (e) {
        fail('terminate', e);
      }
    },

    async disconnect() {
      const c = client;
      client = null;
      isConnected = false;
      if (!c) return;
      try {
        await c.disconnect();
      } catch (e) {
        fail('disconnect', e);
      }
    },

    status: () => ({ enabled: enabled(), connected: isConnected, failures, lastError }),
  };
}
