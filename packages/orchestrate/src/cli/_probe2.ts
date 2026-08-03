/* TEMPORARY probe — deleted before the slice is reported. Never prints secrets. */
import { readFileSync } from 'node:fs';

function loadEnv(): void {
  try {
    const raw = readFileSync('/Users/vrajpatel/Developer/hopper/.env', 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch {}
}

const STAMP = Date.now().toString(36);

async function main(): Promise<void> {
  loadEnv();
  const auth = process.env.ROCKETRIDE_AUTH ?? process.env.ROCKETRIDE_APIKEY ?? '';
  const uri = process.env.ROCKETRIDE_URI ?? 'https://api.rocketride.ai';
  const projectId = process.env.ROCKETRIDE_PROJECT_ID ?? 'hopper';
  if (!auth) return;

  const mod = (await import('rocketride')) as any;
  const client = new mod.RocketRideClient({ auth, uri, requestTimeout: 90000 });
  await client.connect();

  const services = await client.getServices();
  const map = services?.services ?? services;
  console.log('lane map for candidates:');
  for (const n of ['tool_python', 'summarization', 'extract_facts', 'anonymize_text', 'ner']) {
    console.log(`  ${n}: ${map[n] ? JSON.stringify(map[n].lanes) : 'ABSENT'}`);
  }

  const src = `in_${STAMP}`;
  const stage = (id: string, provider: string, from: string) => ({
    id,
    provider,
    name: id,
    description: `hopper ${id}`,
    config: {},
    input: [{ lane: 'text', from }],
  });

  const chain = (label: string, provider: string, tag: string) => {
    const ids = ['reachability', 'deployment', 'obligation', 'precedent', 'ownership'].map(
      (n) => `${n}_${tag}${STAMP}`,
    );
    const source = `in_${tag}${STAMP}`;
    const comps: any[] = [{ id: source, provider: 'webhook', config: {} }];
    let prev = source;
    for (const id of ids) {
      comps.push({
        id,
        provider,
        name: `traverse.${id.split('_')[0]}`,
        description: `HOPPER ${id.split('_')[0]} stage`,
        config: {},
        input: [{ lane: 'text', from: prev }],
      });
      prev = id;
    }
    comps.push({
      id: `out_${tag}${STAMP}`,
      provider: 'response_text',
      config: {},
      input: [{ lane: 'text', from: prev }],
    });
    return [label, { name: label, project_id: projectId, source, components: comps }] as [string, any];
  };

  const cases: Array<[string, any]> = [
    chain('F five anonymize_text stages', 'anonymize_text', 'f'),
    chain('G five ner stages', 'ner', 'g'),
  ];

  for (const [label, pipeline] of cases) {
    try {
      const r = await client.use({ pipeline, name: label, ttl: 45 });
      console.log(`${label}: TOKEN OK id=${r.id} source=${r.source} provider=${r.provider}`);
      try {
        const res = await client.send(r.token, 'GHSA-probe payload', { name: 'input.txt' }, 'text/plain');
        console.log(`   send -> ${JSON.stringify(res).slice(0, 300)}`);
      } catch (e) {
        console.log(`   send failed: ${String((e as Error).message).split('\n')[0]}`);
      }
      await client.terminate(r.token);
      console.log('   terminated');
    } catch (e) {
      console.log(`${label}: FAILED ${String((e as Error).message).split('\n')[0]}`);
    }
  }

  await client.disconnect();
  console.log('disconnected');
}

main().catch((e) => {
  console.error('probe error:', (e as Error).message);
  process.exit(1);
});
