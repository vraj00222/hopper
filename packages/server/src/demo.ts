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

async function beat(
  h: Hopper,
  store: Store,
  step: number,
  label: string,
  advisory: Advisory,
): Promise<BeatResult> {
  await h.bus.publish('advisories', {
    kind: 'advisory',
    advisory,
    received_at: nowIso(),
  });

  const run = await h.orchestrator.handle(advisory);
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
      : 'deduped',
  };
}

/**
 * Between beat 1 and beat 3: the PR opened during beat 1 comes back red.
 * This is not stagecraft — it is the system recording the consequence of its
 * own action, and it is what makes beat 3's conflict real rather than scripted.
 */
async function ciResult(h: Hopper): Promise<void> {
  await h.graph.recordPatchAttempt({
    id: id('patch'),
    package: PRECEDENT_PACKAGE,
    from_v: '9.0.3',
    to_v: '9.0.5',
    outcome: 'broke_staging',
    ts: nowIso(),
    notes:
      'staging integration suite failed after the transitive bump opened for ' +
      `${HERO_PACKAGE}: 14 glob-pattern tests regressed`,
  });
  await h.graph.recordObservation(
    HERO_ADVISORY.ghsa_id,
    `CI: staging broke on the ${PRECEDENT_PACKAGE} bump carried by the ${HERO_PACKAGE} fix`,
  );
}

export async function runBeat(h: Hopper, store: Store, step: number): Promise<BeatResult> {
  switch (step) {
    case 1:
      return beat(h, store, 1, 'the hit', HERO_ADVISORY);
    case 2:
      return beat(h, store, 2, 'the restraint', SUPPRESSED_ADVISORY);
    case 3:
      await ciResult(h);
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
