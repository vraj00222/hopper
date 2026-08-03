/** npm run replay — the whole arc from a fixture, zero network. */
import { existsSync } from 'node:fs';
import { runArc } from '../demo.js';
import { Store } from '../store.js';
import { boot } from '../wire.js';

const fixture = process.argv[2] ?? 'fixtures/replay.json';
const speed = Number(process.env.SPEED ?? 4);

process.env.MOCK = 'true';

const hopper = await boot({ mock: true, log: (m) => console.log(`  ${m}`) });
const store = new Store(hopper);

if (existsSync(fixture)) {
  console.log(`\nreplaying ${fixture} at ${speed}x`);
  const n = await hopper.ingest.replay(fixture, speed);
  console.log(`  ${n} events replayed`);
} else {
  console.log(`\nno fixture at ${fixture} - running the arc live from constants`);
}

const results = await runArc(hopper, store, { pause: 300 });
for (const r of results) console.log(`  beat ${r.step} ${r.label.padEnd(16)} ${r.note}`);

const state = await store.state();
console.log(
  `\nfunnel  ${state.funnel.ingested} -> ${state.funnel.escalated} escalated, ${state.funnel.suppressed} suppressed\n`,
);

await hopper.shutdown();
process.exit(0);
