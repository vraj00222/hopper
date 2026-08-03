/** npm run demo — the full arc, headless, printing what happened. */
import { fmtCountdown } from '@hopper/contracts';
import { runArc } from '../demo.js';
import { Store } from '../store.js';
import { boot } from '../wire.js';

const hopper = await boot({ log: (m) => console.log(`  ${m}`) });
const store = new Store(hopper);

console.log('\nHOPPER — 100 second arc\n');

const results = await runArc(hopper, store, { pause: 400 });

for (const r of results) {
  console.log(`\nBEAT ${r.step} · ${r.label}  (${r.ghsa_id})`);
  console.log(`  ${r.note}`);
  const run = r.run;
  if (!run) continue;

  if (run.outcome === 'suppressed') {
    console.log('  SUPPRESSED · zero hops from any repo');
  } else {
    const best = [...run.hop_paths].sort((a, b) => a.notice_window - b.notice_window)[0];
    if (best) {
      // the chain already terminates at the clause; do not append it twice
      console.log(`  ${best.chain.join(' -> ')}`);
      console.log(
        `  ${best.hops} hops · ${best.customer} · ${best.notice_window}h window · ${best.governing_law}`,
      );
    }
  }
  const ar = run.agent_result;
  if (ar) {
    console.log(`  reachability   ${ar.reachability.reachable ? 'REACHABLE' : 'NOT REACHABLE'}  ${ar.reachability.confidence.toFixed(2)}`);
    console.log(`  patch-engineer ${ar.patch.safe_bump ? `BUMP ${ar.patch.target}` : 'CONFLICT'}  ${ar.patch.confidence.toFixed(2)}`);
    console.log(`  obligation     ${ar.obligation.obligated ? ar.obligation.clauses[0]?.clause_ref : 'none'}  ${ar.obligation.confidence.toFixed(2)}`);
    console.log(`  arbiter        ${ar.arbiter.decision.toUpperCase()}${ar.arbiter.conflict ? '  [CONFLICT]' : ''}`);
    if (ar.arbiter.conflict) console.log(`    ${ar.arbiter.rationale}`);
  }
  for (const rc of run.receipts) {
    console.log(`  ${rc.ok ? 'x' : 'o'} ${rc.action.padEnd(16)} ${rc.ref}  ${rc.detail}`);
  }
}

const state = await store.state();
console.log('\nFUNNEL');
const f = state.funnel;
console.log(
  `  ${f.ingested} ingested -> ${f.deduped} deduped -> ${f.suppressed} suppressed -> ${f.escalated} escalated -> ${f.actions} actions  (p99 ${f.p99_ms.toFixed(2)}ms)`,
);

console.log('\nCLOCKS');
for (const c of state.clocks) {
  console.log(`  ${c.customer.padEnd(20)} ${fmtCountdown(c.remaining_seconds)}  ${c.clause_ref} · ${c.window_hours}h  ${c.state}`);
}

console.log('\nPIPELINES');
for (const p of state.pipelines) {
  console.log(
    `  ${p.name.padEnd(24)} ${(p.success_rate * 100).toFixed(0)}%  ${p.avg_latency.toFixed(0)}ms  ${p.runs} runs`,
  );
}

console.log('\nAPPROVALS');
for (const a of state.approvals) {
  console.log(`  ${a.status.padEnd(10)} ${a.action.padEnd(18)} ${a.title}`);
}

console.log(`\nGRAPH  ${state.graph_stats.nodes} nodes · ${state.graph_stats.edges} edges\n`);

await hopper.shutdown();
process.exit(0);
