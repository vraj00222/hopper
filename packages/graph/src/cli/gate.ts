/**
 * HOPPER — @hopper/graph gate. The definition of done.
 *
 *   npx tsx packages/graph/src/cli/gate.ts
 *
 * Exits 0 only if every check below holds against BOTH backends
 * (FalkorDB and the in-memory fallback). Prints what it proved.
 */
import {
  HERO_GHSA,
  HERO_PACKAGE,
  HERO_CUSTOMER,
  HERO_WINDOW_HOURS,
  PRECEDENT_PACKAGE,
  SUPPRESSED_GHSA,
  nowIso,
} from '@hopper/contracts';
import type { AdvisoryClass, GraphPort } from '@hopper/contracts';
import { createGraph } from '../index.js';
import { seedAll } from '../seed/index.js';

type Backend = 'falkordb' | 'memory';

let failures = 0;
let checksRun = 0;

function ok(label: string, detail: string): void {
  checksRun += 1;
  process.stdout.write(`  PASS  ${label.padEnd(34)} ${detail}\n`);
}

function bad(label: string, detail: string): void {
  checksRun += 1;
  failures += 1;
  process.stdout.write(`  FAIL  ${label.padEnd(34)} ${detail}\n`);
}

function assert(cond: boolean, label: string, detail: string): void {
  if (cond) ok(label, detail);
  else bad(label, detail);
}

async function runSuite(g: GraphPort, backend: Backend): Promise<void> {
  process.stdout.write(`\n─── backend: ${backend} ${'─'.repeat(50 - backend.length)}\n`);

  // 1 — schema applies, twice, idempotently
  await g.applySchema();
  await g.applySchema();
  ok('1  applySchema x2', 'idempotent, no error on re-apply');

  // 2 — seed runs clean
  const t0 = Date.now();
  const summary = await seedAll(g, { reset: true, offline: true, quiet: true });
  ok(
    '2  seed',
    `${summary.packages} packages, ${summary.depEdges} DEPENDS_ON, ` +
      `${summary.repos} repos, ${summary.customers} customers (${Date.now() - t0}ms)`,
  );

  const st0 = await g.stats();

  // 3 — Q1: the money query
  const paths = await g.hopPaths(HERO_GHSA);
  const hero = paths.find(
    (p) =>
      p.customer === HERO_CUSTOMER &&
      p.notice_window === HERO_WINDOW_HOURS &&
      p.hops >= 3 &&
      p.chain.includes(HERO_PACKAGE) &&
      p.chain.includes('minimatch') &&
      p.chain.includes('glob'),
  );
  if (hero) {
    ok(
      '3  Q1 hopPaths(HERO)',
      `${paths.length} path(s); hero ${hero.hops} hops · ${hero.customer} · ` +
        `${hero.notice_window}h · ${hero.clause_ref}`,
    );
    process.stdout.write(`        chain: ${hero.chain.join(' -> ')}\n`);
    if (paths.length > 1) {
      for (const p of paths) {
        process.stdout.write(
          `        ${String(p.hops).padStart(2)} hops  ${String(p.notice_window).padStart(3)}h  ` +
            `${p.customer} / ${p.service} / ${p.clause_ref}\n`,
        );
      }
    }
  } else {
    bad(
      '3  Q1 hopPaths(HERO)',
      `no path matched (got ${paths.length}): ${JSON.stringify(paths.slice(0, 3))}`,
    );
  }
  assert(
    paths.length > 0 && paths[0].customer === HERO_CUSTOMER,
    '3b Q1 ordering',
    paths.length > 0
      ? `first row is ${paths[0].customer} @ ${paths[0].notice_window}h`
      : 'no rows',
  );

  // 4 — Q2: absence is provable
  const bogus = await g.proveAbsence('GHSA-does-not-exist-0000');
  assert(
    bogus.paths === 0 && bogus.decision === 'SUPPRESSED',
    '4  Q2 bogus advisory',
    `paths=${bogus.paths} decision=${bogus.decision} · "${bogus.statement}"`,
  );
  const supp = await g.proveAbsence(SUPPRESSED_GHSA);
  assert(
    supp.paths === 0 && supp.decision === 'SUPPRESSED',
    '4b Q2 SUPPRESSED_GHSA',
    `${supp.package} paths=${supp.paths} across ${supp.repos_checked} repos ` +
      `at depth<=${supp.max_depth} · ${supp.decision}`,
  );

  // 5 — Q2 on the hero escalates
  const heroAbs = await g.proveAbsence(HERO_GHSA);
  assert(
    heroAbs.decision === 'ESCALATE' && heroAbs.paths > 0,
    '5  Q2 HERO_GHSA',
    `${heroAbs.package} paths=${heroAbs.paths} · ${heroAbs.decision}`,
  );

  // 6 — Q3: precedent
  const prec = await g.precedent(PRECEDENT_PACKAGE);
  assert(
    prec.length >= 1,
    '6  Q3 precedent',
    prec.length
      ? `${prec.length} attempt(s) on ${PRECEDENT_PACKAGE}; latest ` +
        `${prec[0].from_v}->${prec[0].to_v} = ${prec[0].outcome} ` +
        `(${Math.round(prec[0].age_seconds / 86400)}d ago)`
      : 'none',
  );

  // 7 — Q4: choke points
  const chokes = await g.chokePoints();
  const brace = chokes.find((c) => c.package === HERO_PACKAGE);
  assert(
    chokes.length > 0 && !!brace && brace.is_chokepoint,
    '7  Q4 chokePoints',
    brace
      ? `${chokes.length} returned; ${HERO_PACKAGE} betweenness=` +
        `${brace.betweenness.toExponential(3)} dependents=${brace.dependents} ` +
        `rank ${chokes.indexOf(brace) + 1}/${st0.packages} packages`
      : `${HERO_PACKAGE} absent from top ${chokes.length}`,
  );
  process.stdout.write(
    `        top: ${chokes
      .slice(0, 6)
      .map((c) => `${c.package}(${c.betweenness.toFixed(3)})`)
      .join('  ')}\n`,
  );

  // 8 — Q5: who to wake
  const oncall = await g.whoToWake(HERO_GHSA);
  const live = oncall.filter((o) => o.oncall_until !== null);
  assert(
    live.length >= 1,
    '8  Q5 whoToWake',
    live.length
      ? `${live[0].person} <${live[0].email}> ${live[0].slack_handle} · ` +
        `${live[0].team} ${live[0].slack_channel} · ${live[0].service}`
      : `${oncall.length} rota members, none currently on call`,
  );

  // 9 — writes, then Q6 audit trail in ts order
  const base = Date.now();
  const iso = (offsetMs: number) => new Date(base + offsetMs).toISOString();
  await g.recordVerdict({
    id: 'gate_verdict_1',
    agent: 'reachability',
    verdict: 'reachable',
    confidence: 0.82,
    rationale: 'expand() observed in build-api telemetry',
    ts: iso(0),
    ghsa_id: HERO_GHSA,
  });
  await g.recordObservation(HERO_GHSA, 'gate observation: obligation clock started', iso(1000));
  await g.recordPatchAttempt({
    id: 'gate_patch_1',
    package: HERO_PACKAGE,
    from_v: '1.1.11',
    to_v: '1.1.18',
    outcome: 'success',
    ts: iso(2000),
    notes: 'gate: patch bump applied on branch hopper/brace-expansion',
  });
  await g.recordDecision({
    id: 'gate_decision_1',
    action: 'notify_customer',
    auto: false,
    approved_by: 'v.patel@hopper.dev',
    ts: iso(3000),
    ghsa_id: HERO_GHSA,
    outcome: 'executed',
  });

  const audit = await g.auditTrail(HERO_GHSA);
  const kinds = audit.map((a) => a.kind);
  const sorted = audit.every(
    (a, i) => i === 0 || Date.parse(audit[i - 1].ts) <= Date.parse(a.ts),
  );
  const sawVerdict = audit.some((a) => a.detail.includes('expand() observed'));
  const sawDecision = audit.some((a) => a.detail.includes('notify_customer'));
  const sawPatch = audit.some((a) => a.detail.includes('1.1.11'));
  const sawObs = audit.some((a) => a.detail.includes('obligation clock started'));
  assert(
    sorted && sawVerdict && sawDecision && sawPatch && sawObs,
    '9  Q6 auditTrail',
    `${audit.length} entries, ts-ordered=${sorted}, kinds=[${[...new Set(kinds)].join(',')}]`,
  );

  // 9b — temporal read-back
  const known = await g.knownAt(HERO_GHSA, iso(1500));
  assert(
    known.length < audit.length && known.length >= 1,
    '9b knownAt(T)',
    `${known.length}/${audit.length} entries known at T+1.5s`,
  );

  // 10 — stats
  const st = await g.stats();
  assert(
    st.nodes > 200,
    '10 stats',
    `${st.nodes} nodes, ${st.edges} edges, ${st.packages} packages, ` +
      `${st.advisories} advisories, ${st.customers} customers, ${st.chokepoints} chokepoints`,
  );

  // 11 (bonus) — Q7 pipeline selection round-trips
  const cls: AdvisoryClass = {
    id: 'npm/high/deep',
    ecosystem: 'npm',
    severity_band: 'high',
    depth_band: 'deep',
  };
  await g.upsertPipeline({
    id: 'pl_gate_probe',
    name: 'gate probe',
    spec_json: '{"nodes":[]}',
    avg_latency: 900,
    success_rate: 0.9,
    runs: 4,
  });
  await g.linkPipelineToClass('pl_gate_probe', cls);
  await g.recordPipelineRun('pl_gate_probe', true, 700);
  const sel = await g.selectPipeline(cls);
  assert(
    sel !== null && sel.pipeline_id === 'pl_gate_probe',
    '11 Q7 selectPipeline',
    sel
      ? `${sel.pipeline_id} success=${sel.success_rate.toFixed(2)} ` +
        `avg=${Math.round(sel.avg_latency)}ms · ${sel.reason}`
      : 'null',
  );
  await g.query('MATCH (p:Pipeline {id:$id}) DETACH DELETE p', { id: 'pl_gate_probe' });

  // 12 (bonus) — raw Cypher escape hatch
  const rows = await g.query<{ n: number }>(
    'MATCH (p:Package) RETURN count(p) AS n',
  );
  assert(
    rows.length === 1 && Number(rows[0].n) === st.packages,
    '12 raw query()',
    `MATCH (p:Package) RETURN count(p) -> ${rows.length ? rows[0].n : 'nothing'}`,
  );
}

async function main(): Promise<void> {
  const started = Date.now();
  process.stdout.write(`HOPPER · @hopper/graph gate · ${nowIso()}\n`);

  const backends: Array<{ name: Backend; make: () => GraphPort }> = [
    { name: 'falkordb', make: () => createGraph({ graph: 'hopper' }) },
    { name: 'memory', make: () => createGraph({ memory: true }) },
  ];

  for (const b of backends) {
    const g = b.make();
    try {
      await g.connect();
      const actual = (g as { backend?: () => Backend }).backend?.() ?? b.name;
      if (b.name === 'falkordb' && actual !== 'falkordb') {
        bad('0  backend', 'FalkorDB unreachable — cannot prove the FalkorDB path');
        await g.close();
        continue;
      }
      await runSuite(g, b.name);
    } catch (err) {
      bad(`suite:${b.name}`, err instanceof Error ? err.stack ?? err.message : String(err));
    } finally {
      await g.close().catch(() => undefined);
    }
  }

  const ms = Date.now() - started;
  process.stdout.write(
    `\n${'═'.repeat(72)}\n` +
      `${failures === 0 ? 'GATE PASS' : 'GATE FAIL'} · ${checksRun - failures}/${checksRun} checks · ${ms}ms\n` +
      (failures === 0
        ? 'Proved: idempotent schema; real deps.dev transitive seed; Q1 hero path to\n' +
          'Northwind Systems at 24h through brace-expansion/minimatch/glob; Q2 absence\n' +
          'for an unseeded package AND an unknown advisory; Q3 precedent; Q4 betweenness\n' +
          'chokepoints; Q5 on-call; Q6 audit trail in ts order; Q7 pipeline selection;\n' +
          '>200 nodes — identically on FalkorDB and the in-memory fallback.\n'
        : ''),
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`gate crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
