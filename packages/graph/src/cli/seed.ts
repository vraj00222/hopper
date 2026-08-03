/**
 * HOPPER — seeder.
 *
 *   npx tsx packages/graph/src/cli/seed.ts [--reset] [--offline] [--memory]
 *
 * Default is MOCK-aware: with MOCK unset or true it seeds entirely from
 * fixtures/depsdev.json. `MOCK=false` (or omitting --offline with an empty
 * cache) hits deps.dev and rewrites the cache.
 */
import { isMock } from '@hopper/contracts';
import { createGraph, graphBackend } from '../index.js';
import { seedAll } from '../seed/index.js';

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const reset = has('--reset');
  const memory = has('--memory');
  const offline = has('--offline') ? true : has('--online') ? false : isMock();

  const out = (m: string): void => {
    process.stdout.write(`${m}\n`);
  };

  out(`HOPPER · seed · ${offline ? 'offline (cache)' : 'online (deps.dev)'}${reset ? ' · reset' : ''}`);

  const g = createGraph({ memory, onFallback: (r) => out(`  ${r}`) });
  await g.connect();
  out(`  backend: ${graphBackend(g)}`);

  await g.applySchema();
  out('  schema applied');

  const summary = await seedAll(g, { reset, offline, log: out });
  const stats = await g.stats();

  out('');
  out(`  roots      ${summary.roots.map((r) => `${r.name}@${r.version}`).join('  ')}`);
  out(`  cache      ${summary.cache_fetched_at}`);
  out(
    `  overlay    ${summary.repos} repos · ${summary.services} services · ` +
      `${summary.customers} customers · ${summary.contracts} contracts · ` +
      `${summary.clauses} clauses · ${summary.patchAttempts} patch attempts`,
  );
  out(
    `  graph      ${stats.nodes} nodes · ${stats.edges} edges · ${stats.packages} packages · ` +
      `${stats.advisories} advisories · ${stats.chokepoints} choke points`,
  );
  out(`  elapsed    ${summary.elapsed_ms}ms`);

  await g.close();
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
