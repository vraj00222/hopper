import { refreshCache, buildDepsDataset, loadCache } from './src/seed/depsdev.js';
import { computeBetweenness } from './src/betweenness.js';
import { syntheticDataset } from './src/seed/synthetic.js';
import { advisoryDataset } from './src/seed/advisories.js';
import { mergeDatasets } from './src/dataset.js';

let cache = loadCache();
if (!cache) cache = await refreshCache(undefined, (m) => console.log(m));
const { dataset, summary } = buildDepsDataset(cache);
const full = mergeDatasets(dataset, syntheticDataset(), advisoryDataset());
console.log('roots:', summary.roots.map(r=>`${r.name}@${r.version}`).join(' '));
console.log('packages', full.packages.length, 'deps', full.deps.length);
console.log('brace-expansion version:', full.packages.find(p=>p.name==='brace-expansion'));
const names = full.packages.map(p => p.name);
const edges = full.deps.map(d => [d.from, d.to] as [string,string]);
for (const q of [0.6,0.65,0.7,0.75,0.8]) {
  const out = computeBetweenness(names, edges, { quantile: q, maxChokePoints: 80, minChokePoints: 5 });
  const sorted=[...out.scores.entries()].filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const r=sorted.findIndex(([n])=>n==='brace-expansion');
  console.log(`q=${q} nonzero=${sorted.length} chokepoints=${out.chokepoints.size} brace rank=${r+1}/${names.length} flagged=${out.chokepoints.has('brace-expansion')} thr=${out.threshold.toExponential(3)}`);
}
const out = computeBetweenness(names, edges, { quantile: 0.7, maxChokePoints: 80 });
const sorted=[...out.scores.entries()].filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
console.log('top15:', sorted.slice(0,15).map(([n,v],i)=>`${i+1}.${n}`).join(' '));
console.log('around brace:', sorted.slice(36,46).map(([n,v],i)=>`${i+37}.${n}(${v.toExponential(2)})`).join(' '));
