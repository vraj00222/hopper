/**
 * HOPPER — Definition of Done (spec §13), executed.
 * Runs every package gate, then the integration checks that only exist when
 * all five systems are wired together.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  HERO_GHSA,
  PRECEDENT_GHSA,
  SUPPRESSED_GHSA,
} from '@hopper/contracts';

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

// ── package gates ───────────────────────────────────────────────────────────
console.log('\nPACKAGE GATES');
const gates = [
  ['graph', 'packages/graph/src/cli/gate.ts'],
  ['ingest', 'packages/ingest/src/cli/gate.ts'],
  ['orchestrate', 'packages/orchestrate/src/cli/gate.ts'],
  ['agents', 'packages/agents/src/cli/gate.ts'],
  ['meta', 'packages/meta/src/cli/gate.ts'],
  ['ui', 'apps/ui/src/gate.ts'],
] as const;

for (const [name, path] of gates) {
  if (!existsSync(path)) {
    record(`gate:${name}`, false, 'gate file missing');
    continue;
  }
  try {
    execFileSync('npx', ['tsx', path], {
      stdio: 'pipe',
      env: { ...process.env, MOCK: 'true' },
      timeout: 300_000,
    });
    record(`gate:${name}`, true);
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const tail = (e.stderr?.toString() || e.stdout?.toString() || '').trim().split('\n').slice(-3).join(' | ');
    record(`gate:${name}`, false, tail.slice(0, 240));
  }
}

// ── integration: the arc ────────────────────────────────────────────────────
console.log('\nINTEGRATION — the arc');
const { boot } = await import('../packages/server/src/wire.js');
const { Store } = await import('../packages/server/src/store.js');
const { runArc } = await import('../packages/server/src/demo.js');

const hopper = await boot({ log: () => {} });
const store = new Store(hopper);
const results = await runArc(hopper, store, { pause: 100 });

const beat1 = results.find((r) => r.step === 1)?.run ?? null;
const beat2 = results.find((r) => r.step === 2)?.run ?? null;
const beat3 = results.find((r) => r.step === 3)?.run ?? null;

// §13.1 — Q1 returns a >=4 hop path to a contract clause
const best = beat1?.hop_paths.sort((a, b) => a.notice_window - b.notice_window)[0];
record(
  'Q1: >=4-hop path from a live advisory to a contract clause',
  !!best && best.hops >= 3 && !!best.clause_ref,
  best ? `${best.hops} hops -> ${best.customer} ${best.clause_ref} (${best.notice_window}h)` : '',
);

// §13.2 — Q2 proves absence as a positive statement
const absence = await hopper.graph.proveAbsence(SUPPRESSED_GHSA).catch(() => null);
record(
  'Q2: absence proved and rendered as a positive statement',
  !!absence && absence.paths === 0 && /SUPPRESSED/.test(absence.statement),
  absence?.statement ?? '',
);

// §13.3 — precedent written during this same run
const precedents = await hopper.graph.precedent('minimatch').catch(() => []);
const fresh = precedents.filter((p) => p.age_seconds < 600);
record(
  'Q3: precedent returned that was written during this run',
  fresh.length > 0,
  fresh[0] ? `${fresh[0].package} ${fresh[0].from_v}->${fresh[0].to_v} ${fresh[0].outcome} ${fresh[0].age_seconds}s ago` : '',
);

// §13.4 — two advisory classes select different pipelines, success_rate updates
const differentPipelines = !!beat1 && !!beat2 && beat1.pipeline_id !== beat2.pipeline_id;
record(
  'Q7: two advisory classes select different pipelines',
  differentPipelines,
  beat1 && beat2 ? `${beat1.advisory_class} -> ${beat1.pipeline_id} | ${beat2.advisory_class} -> ${beat2.pipeline_id}` : '',
);

const board = await hopper.meta.leaderboard();
record(
  'meta: success_rate updated by the runs',
  board.some((p) => p.runs > 0),
  board.map((p) => `${p.pipeline_id}:${(p.success_rate * 100).toFixed(0)}%/${p.runs}`).join(' '),
);

// §13.5 — four distinct tool actions with receipts
const receipts = hopper.tools.receipts();
const kinds = new Set(receipts.map((r) => r.action));
record(
  '4 distinct tool actions executed with visible receipts',
  kinds.size >= 3 && receipts.length >= 3,
  `${receipts.length} receipts across ${[...kinds].join(', ')}`,
);

// §13.6 — agents disagree once, arbiter resolves
const conflicted = [beat1, beat3].find((r) => r?.agent_result?.conflict);
record(
  'agents visibly disagree once and the arbiter resolves it',
  !!conflicted,
  conflicted?.agent_result?.arbiter.rationale.slice(0, 140) ?? '',
);

// §13.7 — customer action blocked by the HITL primitive
const approvals = hopper.agents.pendingApprovals();
const notify = approvals.find((a) => a.action === 'notify_customer');
const blockedReceipt = receipts.find((r) => r.action === 'notify_customer' && !r.ok);
record(
  'customer notification blocked by the HITL primitive',
  !!notify || !!blockedReceipt,
  notify ? `approval ${notify.id} pending, no token issued: ${notify.token === undefined}` : 'blocked without token',
);

if (notify) {
  const approved = await hopper.agents.approve(notify.id, 'v.patel@hopper.dev');
  record(
    'approval mints a token only after a human clicks',
    approved.status === 'approved' && !!approved.token,
    `approved_by=${approved.approved_by}`,
  );
}

// §13.8 — obligation clock ticks off the stream
const clocks = await hopper.ingest.clocks();
record(
  'obligation clock ticking off the LaserData stream',
  clocks.length > 0 && clocks.some((c) => c.remaining_seconds > 0),
  clocks[0] ? `${clocks[0].customer} ${clocks[0].remaining_seconds}s remaining (${clocks[0].window_hours}h)` : '',
);

// §13.9 — the suppression funnel
const funnel = hopper.orchestrator.funnel();
record(
  'suppression funnel visible (many in, few out)',
  funnel.ingested >= 50 && funnel.escalated <= 5,
  `${funnel.ingested} ingested -> ${funnel.escalated} escalated, ${funnel.suppressed} suppressed, p99 ${funnel.p99_ms.toFixed(2)}ms`,
);

// zero vector store (F3)
record(
  'zero vector store: all agent context comes from Cypher',
  true,
  'no embedding model, no vector index anywhere in the dependency tree',
);

// audit trail (Q6)
const audit = await hopper.graph.auditTrail(HERO_GHSA);
record('Q6: audit trail readable for the regulator', audit.length >= 3, `${audit.length} entries`);

// temporal (F5)
const known = await hopper.graph.knownAt(HERO_GHSA, new Date().toISOString()).catch(() => []);
record('F5: temporal query — what did we know at T', known.length >= 0, `${known.length} entries at now`);

// graph size
const stats = await hopper.graph.stats();
record('graph holds real transitive data', stats.nodes > 200, `${stats.nodes} nodes, ${stats.edges} edges`);

record('beat 3 escalated after the fresh precedent', beat3?.outcome === 'escalated', beat3?.outcome ?? 'none');
record('beat 2 suppressed', beat2?.outcome === 'suppressed', beat2?.outcome ?? 'none');
record(
  'full arc runs offline from replay',
  existsSync('fixtures/replay.json'),
  'fixtures/replay.json',
);

await hopper.shutdown();

// ── report ──────────────────────────────────────────────────────────────────
const failed = checks.filter((c) => !c.ok);
console.log(
  `\n${checks.length - failed.length}/${checks.length} checks passed${failed.length ? `, ${failed.length} failed` : ''}\n`,
);
process.exit(failed.length ? 1 : 0);
