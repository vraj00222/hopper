/**
 * LaserData transport — @laserdata/laser-sdk 0.0.1 over Apache Iggy.
 *
 * Verified surface (read out of node_modules/@laserdata/laser-sdk/dist/*.d.ts):
 *
 *   const laser = await Laser.connect(url)                       // client/laser.d.ts
 *   laser.stream('hopper').topic('advisories').ensure(4)         // stream/topic.d.ts
 *   topic.publish().json(value).send()                           // stream/publish.d.ts
 *   laser.kv('clocks').set(Uint8Array).json(value).send()        // managed/kv.d.ts  <- keys are BYTES
 *   laser.kv('clocks').get(Uint8Array) -> Uint8Array | undefined
 *   laser.kv('clocks').scan().entries() -> KvEntry[]
 *   laser.memory('incidents').recall().semantic(q).limit(n).fetch() -> MemoryItem[]
 *
 * Every call is wrapped. On the first failure we log once, mark the transport
 * degraded, and serve the rest of the demo from the local bus. The local bus is
 * always the source of truth for ordering, history and the funnel, so a
 * mid-demo LaserData outage is invisible to everything downstream.
 */
import { TOPICS } from '@hopper/contracts';
import type {
  EventBusPort,
  EventEnvelope,
  FunnelStats,
  HopperEvent,
  Topic,
  Unsubscribe,
} from '@hopper/contracts';

import { LocalBus, type BusInternals } from './local.js';

const STREAM = 'hopper';
const PARTITIONS = 4;

// ── the slice of the SDK we actually touch ──────────────────────────────────

interface SendableJson {
  json(value: unknown): SendableJson;
  send(): Promise<unknown>;
}
interface LaserTopicLike {
  ensure(partitions?: number): Promise<void>;
  publish(): SendableJson;
}
interface LaserStreamLike {
  topic(name: string): LaserTopicLike;
}
interface KvEntryLike {
  key: Uint8Array;
  value: Uint8Array;
}
interface KvScanLike {
  entries(): Promise<readonly KvEntryLike[]>;
}
interface KvLike {
  set(key: Uint8Array): SendableJson;
  get(key: Uint8Array): Promise<Uint8Array | undefined>;
  scan(): KvScanLike;
}
interface MemoryItemLike {
  payload: Uint8Array;
  score?: number;
}
interface RecallLike {
  application(name: string): RecallLike;
  semantic(text: string): RecallLike;
  limit(n: number): RecallLike;
  fetch(): Promise<readonly MemoryItemLike[]>;
}
interface RememberLike {
  application(name: string): RememberLike;
  send(): Promise<unknown>;
}
interface MemoryLike {
  recall(): RecallLike;
  remember(payload: Uint8Array): RememberLike;
}
interface LaserLike {
  stream(name: string): LaserStreamLike;
  kv(namespace: string): KvLike;
  memory(namespace: string): MemoryLike;
  close(): Promise<void>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export class LaserDataBus implements EventBusPort, BusInternals {
  private readonly local = new LocalBus({ trackLatency: false });
  private laser: LaserLike | null = null;
  private degraded = false;
  private logged = false;

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    await this.local.connect();
    try {
      const mod = (await import('@laserdata/laser-sdk')) as unknown as {
        Laser: { connect(url: string): Promise<LaserLike> };
      };
      const laser = await mod.Laser.connect(this.url);
      const stream = laser.stream(STREAM);
      for (const t of TOPICS) await stream.topic(t).ensure(PARTITIONS);
      this.laser = laser;
      console.log(`[ingest] laserdata connected — stream "${STREAM}", ${TOPICS.length} topics x ${PARTITIONS} partitions`);
    } catch (err) {
      this.degrade(err);
    }
  }

  async close(): Promise<void> {
    if (this.laser) {
      try {
        await this.laser.close();
      } catch (err) {
        this.degrade(err);
      }
      this.laser = null;
    }
    await this.local.close();
  }

  transport(): 'laserdata' | 'local' {
    return this.laser && !this.degraded ? 'laserdata' : 'local';
  }

  async publish<T extends HopperEvent>(topic: Topic, payload: T): Promise<EventEnvelope<T>> {
    const t0 = performance.now();
    const before = this.local.stats().deduped;
    const env = await this.local.publish(topic, payload);
    const wasDuplicate = this.local.stats().deduped > before;

    const laser = this.live();
    if (laser && !wasDuplicate) {
      try {
        await laser.stream(STREAM).topic(topic).publish().json(env).send();
      } catch (err) {
        this.degrade(err);
      }
    }
    this.local.pushLatency(performance.now() - t0);
    return env;
  }

  subscribe<T extends HopperEvent>(
    topic: Topic,
    handler: (e: EventEnvelope<T>) => void | Promise<void>,
  ): Unsubscribe {
    return this.local.subscribe(topic, handler);
  }

  history<T extends HopperEvent>(topic: Topic, limit?: number): EventEnvelope<T>[] {
    return this.local.history<T>(topic, limit);
  }

  async kvSet(namespace: string, key: string, value: unknown): Promise<void> {
    await this.local.kvSet(namespace, key, value);
    const laser = this.live();
    if (!laser) return;
    try {
      await laser.kv(namespace).set(enc.encode(key)).json(value).send();
    } catch (err) {
      this.degrade(err);
    }
  }

  async kvGet<T = unknown>(namespace: string, key: string): Promise<T | null> {
    const laser = this.live();
    if (laser) {
      try {
        const bytes = await laser.kv(namespace).get(enc.encode(key));
        if (bytes !== undefined) return JSON.parse(dec.decode(bytes)) as T;
        return null;
      } catch (err) {
        this.degrade(err);
      }
    }
    return this.local.kvGet<T>(namespace, key);
  }

  async kvList<T = unknown>(namespace: string): Promise<Array<{ key: string; value: T }>> {
    const laser = this.live();
    if (laser) {
      try {
        const entries = await laser.kv(namespace).scan().entries();
        return entries.map((e) => ({
          key: dec.decode(e.key),
          value: JSON.parse(dec.decode(e.value)) as T,
        }));
      } catch (err) {
        this.degrade(err);
      }
    }
    return this.local.kvList<T>(namespace);
  }

  async recall(namespace: string, q: string): Promise<Array<{ text: string; score: number }>> {
    const laser = this.live();
    if (laser) {
      try {
        const items = await laser
          .memory(namespace)
          .recall()
          .application(STREAM)
          .semantic(q)
          .limit(20)
          .fetch();
        if (items.length > 0) {
          return items.map((i) => ({ text: dec.decode(i.payload), score: i.score ?? 0 }));
        }
      } catch (err) {
        this.degrade(err);
      }
    }
    return this.local.recall(namespace, q);
  }

  stats(): FunnelStats {
    return this.local.stats();
  }

  p99(): number {
    return this.local.p99();
  }

  // ── BusInternals ─────────────────────────────────────────────────────────

  beginReplay(): void {
    this.local.beginReplay();
  }

  endReplay(): void {
    this.local.endReplay();
  }

  remember(namespace: string, text: string): void {
    this.local.remember(namespace, text);
    const laser = this.live();
    if (!laser) return;
    void laser
      .memory(namespace)
      .remember(enc.encode(text))
      .application(STREAM)
      .send()
      .catch((err: unknown) => this.degrade(err));
  }

  pushLatency(ms: number): void {
    this.local.pushLatency(ms);
  }

  invalidCount(): number {
    return this.local.invalidCount();
  }

  // ── internals ────────────────────────────────────────────────────────────

  private live(): LaserLike | null {
    return this.degraded ? null : this.laser;
  }

  private degrade(err: unknown): void {
    this.degraded = true;
    this.laser = null;
    if (!this.logged) {
      this.logged = true;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ingest] laserdata unavailable — falling back to the local transport: ${msg}`);
    }
  }
}
