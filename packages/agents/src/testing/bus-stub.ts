/**
 * An EventBusPort double for this package's gate only. Not exported from src/index.ts —
 * LaserData lives in @hopper/ingest and arrives through the port.
 */
import type {
  AgentBusEvent,
  EventBusPort,
  EventEnvelope,
  FunnelStats,
  HopperEvent,
  Topic,
  Unsubscribe,
} from '@hopper/contracts';

export class StubBus implements EventBusPort {
  readonly envelopes: Array<EventEnvelope<HopperEvent>> = [];
  private readonly kv = new Map<string, Map<string, unknown>>();
  private readonly handlers = new Map<Topic, Array<(e: EventEnvelope<never>) => void | Promise<void>>>();
  private seq = 0;

  /** every agent-bus payload seen, in order */
  get published(): AgentBusEvent[] {
    return this.envelopes
      .filter((e) => e.topic === 'agent-bus')
      .map((e) => e.payload as AgentBusEvent);
  }

  async connect(): Promise<void> {}
  async close(): Promise<void> {}

  async publish<T extends HopperEvent>(topic: Topic, payload: T): Promise<EventEnvelope<T>> {
    this.seq += 1;
    const envelope: EventEnvelope<T> = {
      id: `evt_${this.seq}`,
      topic,
      ts: new Date().toISOString(),
      seq: this.seq,
      payload,
    };
    this.envelopes.push(envelope as EventEnvelope<HopperEvent>);
    for (const h of this.handlers.get(topic) ?? []) await h(envelope as never);
    return envelope;
  }

  subscribe<T extends HopperEvent>(
    topic: Topic,
    handler: (e: EventEnvelope<T>) => void | Promise<void>,
  ): Unsubscribe {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler as (e: EventEnvelope<never>) => void | Promise<void>);
    this.handlers.set(topic, list);
    return () => {
      const current = this.handlers.get(topic) ?? [];
      this.handlers.set(
        topic,
        current.filter((h) => h !== (handler as unknown)),
      );
    };
  }

  history<T extends HopperEvent>(topic: Topic, limit = 500): EventEnvelope<T>[] {
    return this.envelopes.filter((e) => e.topic === topic).slice(-limit) as EventEnvelope<T>[];
  }

  async kvSet(namespace: string, key: string, value: unknown): Promise<void> {
    const ns = this.kv.get(namespace) ?? new Map<string, unknown>();
    ns.set(key, value);
    this.kv.set(namespace, ns);
  }
  async kvGet<T = unknown>(namespace: string, key: string): Promise<T | null> {
    return (this.kv.get(namespace)?.get(key) as T) ?? null;
  }
  async kvList<T = unknown>(namespace: string): Promise<Array<{ key: string; value: T }>> {
    return [...(this.kv.get(namespace)?.entries() ?? [])].map(([key, value]) => ({
      key,
      value: value as T,
    }));
  }
  async recall(): Promise<Array<{ text: string; score: number }>> {
    return [];
  }

  stats(): FunnelStats {
    return {
      ingested: this.envelopes.length,
      deduped: 0,
      traversed: 0,
      suppressed: 0,
      escalated: 0,
      actions: 0,
      p99_ms: 0,
      window_started_at: new Date().toISOString(),
    };
  }
  transport(): 'laserdata' | 'local' {
    return 'local';
  }
  p99(): number {
    return 0;
  }
}
