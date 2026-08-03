/**
 * HOPPER — the 100-second arc, driven from one place so the CLI, the API and
 * the presenter's keyboard all run the identical sequence.
 */
import {
  HERO_ADVISORY,
  HERO_PACKAGE,
  HOP_INTERVAL_MS,
  PRECEDENT_ADVISORY,
  PRECEDENT_PACKAGE,
  SUPPRESSED_ADVISORY,
  id,
  nowIso,
  sleep,
} from '@hopper/contracts';
import type { Advisory, PipelineRun } from '@hopper/contracts';
import type { Store } from './store.js';
import type { Hopper } from './wire.js';

export interface BeatResult {
  step: number;
  label: string;
  ghsa_id: string;
  run: PipelineRun | null;
  note: string;
}

/**
 * Publish, then wait for the router to pick it up off the bus.
 *
 * The orchestrator subscribes to `advisories` itself, so calling handle()
 * here as well would make the router's own sighting the duplicate and the
 * beat would report `deduped`. The event has to travel the real path —
 * LaserData in, RocketRide out — or the demo is narrating a lie.
 */
async function awaitRun(
  h: Hopper,
  ghsaId: string,
  timeoutMs = 20_000,
): Promise<PipelineRun | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = h.orchestrator.runs().find((r) => r.ghsa_id === ghsaId);
    if (run) return run;
    await sleep(25);
  }
  return null;
}

async function beat(
  h: Hopper,
  store: Store,
  step: number,
  label: string,
  advisory: Advisory,
): Promise<BeatResult> {
  const before = h.orchestrator.runs().length;

  await h.bus.publish('advisories', {
    kind: 'advisory',
    advisory,
    received_at: nowIso(),
  });

  let run = await awaitRun(h, advisory.ghsa_id);

  // If nothing is subscribed (a bare runtime, or a bus with no router
  // attached) drive it directly rather than reporting a false suppression.
  if (!run && h.orchestrator.runs().length === before) {
    run = await h.orchestrator.handle(advisory);
  }

  if (run) {
    store.applyRun(run);
    await store.propagate(run, HOP_INTERVAL_MS);
  }
  return {
    step,
    label,
    ghsa_id: advisory.ghsa_id,
    run,
    note: run
      ? `${run.outcome} · ${run.traces.length} nodes · ${run.latency_ms}ms · pipeline ${run.pipeline_id}`
      : 'no run produced',
  };
}

/**
 * The PR opened during beat 1 comes back red.
 *
 * This is not stagecraft — it is the system recording the consequence of its
 * own action, and it is what makes beat 3's conflict real rather than
 * scripted. It fires straight after beat 1 so the precedent's age is genuinely
 * however long the presenter took to reach beat 3, not a number we assert.
 */
async function ciResult(h: Hopper, ts = nowIso()): Promise<void> {
  const attemptId = id('patch');
  await h.graph.recordPatchAttempt({
    id: attemptId,
    package: PRECEDENT_PACKAGE,
    from_v: '9.0.3',
    to_v: '9.0.5',
    outcome: 'broke_staging',
    ts,
    // carry the node id in the note: Precedent (Q3) has no id field, and the
    // Patch Engineer cites whatever id it can find here.
    notes:
      `${attemptId}: staging integration suite failed after the transitive bump ` +
      `opened for ${HERO_PACKAGE} — 14 glob-pattern tests regressed`,
  });
  await h.graph.recordObservation(
    HERO_ADVISORY.ghsa_id,
    `CI: staging broke on the ${PRECEDENT_PACKAGE} bump carried by the ${HERO_PACKAGE} fix`,
    ts,
  );
}

/** has beat 1's red build already been recorded? */
async function hasFreshFailure(h: Hopper): Promise<boolean> {
  const precedents = await h.graph.precedent(PRECEDENT_PACKAGE).catch(() => []);
  return precedents.some((p) => p.outcome === 'broke_staging' && p.age_seconds <= 600);
}

export async function runBeat(h: Hopper, store: Store, step: number): Promise<BeatResult> {
  switch (step) {
    case 1: {
      const result = await beat(h, store, 1, 'the hit', HERO_ADVISORY);
      // CI comes back on the PR we just opened
      if (result.run?.outcome === 'escalated') await ciResult(h);
      return result;
    }
    case 2:
      return beat(h, store, 2, 'the restraint', SUPPRESSED_ADVISORY);
    case 3:
      // driving beat 3 on its own, without beat 1 having run: stamp the failed
      // build at the point in the arc where it would have happened.
      if (!(await hasFreshFailure(h))) {
        await ciResult(h, new Date(Date.now() - 90_000).toISOString());
      }
      return beat(h, store, 3, 'memory', PRECEDENT_ADVISORY);
    default:
      throw new Error(`unknown beat: ${step}`);
  }
}

export async function runArc(
  h: Hopper,
  store: Store,
  opts: { pause?: number; burst?: boolean } = {},
): Promise<BeatResult[]> {
  const pause = opts.pause ?? 1500;
  const results: BeatResult[] = [];

  if (opts.burst !== false) {
    // the funnel: 50 in, 2 out
    await h.ingest.burst(50, 10);
  }

  results.push(await runBeat(h, store, 1));
  await sleep(pause);
  results.push(await runBeat(h, store, 2));
  await sleep(pause);
  results.push(await runBeat(h, store, 3));
  return results;
}
