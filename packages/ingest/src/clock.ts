/**
 * L3 — the obligation clock. The most demo-able object in the product.
 *
 * One interval per (advisory, customer), 1Hz, state in kv('clocks'), every tick
 * republished on the `clock` topic. Guarantees the demo leans on:
 *
 *   - monotonic: remaining_seconds strictly decreases, never jumps backwards,
 *     even if the wall clock does
 *   - concurrent: many clocks run independently, keyed by advisory + customer
 *   - clean: stopClock clears its interval; nothing leaks a timer
 */
import { isoPlusHours, nowIso, secondsUntil } from '@hopper/contracts';
import type { ClockTick, EventBusPort } from '@hopper/contracts';

export const CLOCK_NAMESPACE = 'clocks';

export interface ClockInput {
  ghsa_id: string;
  customer: string;
  window_hours: number;
  clause_ref: string;
  started_at?: string;
}

export function clockKey(ghsaId: string, customer: string): string {
  return `obligation:${ghsaId}:${customer}`;
}

interface Entry {
  timer: NodeJS.Timeout;
  tick: ClockTick;
}

export class ClockRegistry {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly bus: EventBusPort) {}

  async start(input: ClockInput): Promise<ClockTick> {
    const key = clockKey(input.ghsa_id, input.customer);
    await this.stop(input.ghsa_id, input.customer);

    const startedAt = input.started_at ? new Date(input.started_at) : new Date();
    const deadline = isoPlusHours(input.window_hours, startedAt);
    const remaining = secondsUntil(deadline);

    const tick: ClockTick = {
      kind: 'clock',
      customer: input.customer,
      ghsa_id: input.ghsa_id,
      deadline_utc: deadline,
      remaining_seconds: remaining,
      window_hours: input.window_hours,
      clause_ref: input.clause_ref,
      state: remaining > 0 ? 'running' : 'breached',
    };

    await this.commit(tick);

    if (tick.state === 'running') {
      const timer = setInterval(() => {
        void this.advance(key);
      }, 1000);
      // an obligation clock must never be the reason a process stays alive
      timer.unref();
      this.entries.set(key, { timer, tick });
    }

    return { ...tick };
  }

  async stop(ghsaId: string, customer: string): Promise<void> {
    const key = clockKey(ghsaId, customer);
    const entry = this.entries.get(key);
    if (!entry) return;
    clearInterval(entry.timer);
    this.entries.delete(key);
    // record the pause in kv, but do not publish — a stopped clock is silent
    const paused: ClockTick = { ...entry.tick, state: 'paused' };
    await this.bus.kvSet(CLOCK_NAMESPACE, key, paused);
  }

  async stopAll(): Promise<void> {
    for (const [key, entry] of [...this.entries]) {
      clearInterval(entry.timer);
      this.entries.delete(key);
      await this.bus.kvSet(CLOCK_NAMESPACE, key, { ...entry.tick, state: 'paused' });
    }
  }

  /** live view straight out of kv — the same value the UI reads */
  async list(): Promise<ClockTick[]> {
    const rows = await this.bus.kvList<ClockTick>(CLOCK_NAMESPACE);
    return rows
      .map((r) => r.value)
      .filter((v): v is ClockTick => !!v && (v as ClockTick).kind === 'clock')
      .sort((a, b) => a.remaining_seconds - b.remaining_seconds);
  }

  active(): number {
    return this.entries.size;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async advance(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;

    const wall = secondsUntil(entry.tick.deadline_utc);
    const previous = entry.tick.remaining_seconds;
    // Strictly monotonic, exactly one second per tick. Sub-second flooring in
    // secondsUntil() would otherwise make the first step read as two. We only
    // resync to the wall clock when it has drifted more than 2s ahead of us —
    // a suspended laptop must not leave the countdown lying.
    const remaining = Math.max(0, wall < previous - 2 ? wall : previous - 1);
    const next: ClockTick = {
      ...entry.tick,
      remaining_seconds: remaining,
      state: remaining > 0 ? 'running' : 'breached',
    };
    entry.tick = next;

    if (remaining === 0) {
      clearInterval(entry.timer);
      this.entries.delete(key);
    }
    await this.commit(next);
  }

  private async commit(tick: ClockTick): Promise<void> {
    await this.bus.kvSet(CLOCK_NAMESPACE, clockKey(tick.ghsa_id, tick.customer), tick);
    await this.bus.publish('clock', tick);
  }
}

/** deadline for a window that started now — used by the pull-live fixture */
export function deadlineFor(windowHours: number, startedAt: string = nowIso()): string {
  return isoPlusHours(windowHours, new Date(startedAt));
}
