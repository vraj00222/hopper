/**
 * In-memory EventBusPort for the gate ONLY. The real transport is LaserData,
 * behind @hopper/ingest.
 */
import {
  nowIso,
  percentile,
  type EventBusPort,
  type EventEnvelope,
  type FunnelStats,
  type HopperEvent,
  type Topic,
  type Unsubscribe,
} from '@hopper/contracts';

export interface StubBus extends EventBusPort {
  published: EventEnvelope[];
  topicsSeen(): Topic[];
}

export function createStubBus(): StubBus {
  const log = new Map<Topic, EventEnvelope[]>();
  const handlers = new Map<Topic, Array<(e: EventEnvelope) => void | Promise<void>>>();
  const kv = new Map<string, Map<string, unknown>>();
  const published: EventEnvelope[] = [];
  const latencies: number[] = [];
  let seq = 0;

  const funnel: FunnelStats = {
    ingested: 0,
    deduped: 0,
    traversed: 0,
    suppressed: 0,
    escalated: 0,
    actions: 0,
    p99_ms: 0,
    window_started_at: nowIso(),
  };

  const bus: StubBus = {
    published,
    topicsSeen: () => [...log.keys()],

    async connect() {},
    async close() {},

    async publish<T extends HopperEvent>(topic: Topic, payload: T) {
      const t0 = performance.now();
      seq += 1;
      const env: EventEnvelope<T> = {
        id: `evt_${seq.toString(36)}`,
        topic,
        ts: nowIso(),
        seq,
        payload,
      };
      const list = log.get(topic) ?? [];
      list.push(env as EventEnvelope);
      log.set(topic, list);
      published.push(env as EventEnvelope);
      funnel.ingested += 1;

      for (const h of handlers.get(topic) ?? []) {
        await h(env as EventEnvelope);
      }
      latencies.push(performance.now() - t0);
      funnel.p99_ms = percentile(latencies, 99);
      return env;
    },

    subscribe<T extends HopperEvent>(
      topic: Topic,
      handler: (e: EventEnvelope<T>) => void | Promise<void>,
    ): Unsubscribe {
      const list = handlers.get(topic) ?? [];
      const fn = handler as (e: EventEnvelope) => void | Promise<void>;
      list.push(fn);
      handlers.set(topic, list);
      return () => {
        const cur = handlers.get(topic) ?? [];
        const i = cur.indexOf(fn);
        if (i >= 0) cur.splice(i, 1);
      };
    },

    history<T extends HopperEvent>(topic: Topic, limit = 100): EventEnvelope<T>[] {
      const list = (log.get(topic) ?? []) as EventEnvelope<T>[];
      return list.slice(-limit);
    },

    async kvSet(namespace, key, value) {
      const ns = kv.get(namespace) ?? new Map<string, unknown>();
      ns.set(key, value);
      kv.set(namespace, ns);
    },
    async kvGet<T = unknown>(namespace: string, key: string): Promise<T | null> {
      return ((kv.get(namespace)?.get(key) as T) ?? null);
    },
    async kvList<T = unknown>(namespace: string) {
      return [...(kv.get(namespace) ?? new Map()).entries()].map(([key, value]) => ({
        key,
        value: value as T,
      }));
    },
    async recall(namespace, q) {
      const ns = kv.get(namespace);
      if (!ns) return [];
      const needle = q.toLowerCase();
      return [...ns.values()]
        .map((v) => JSON.stringify(v))
        .filter((t) => t.toLowerCase().includes(needle))
        .map((text) => ({ text, score: 1 }));
    },

    stats: () => ({ ...funnel }),
    transport: () => 'local',
    p99: () => percentile(latencies, 99),
  };

  return bus;
}
