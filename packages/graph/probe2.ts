import { buildDepsDataset, loadCache } from './src/seed/depsdev.js';
import { brandes, computeBetweenness } from './src/betweenness.js';
import { syntheticDataset } from './src/seed/synthetic.js';
import { advisoryDataset } from './src/seed/advisories.js';
import { mergeDatasets } from './src/dataset.js';

const cache = loadCache()!;
const { dataset } = buildDepsDataset(cache);
const full = mergeDatasets(dataset, syntheticDataset(), advisoryDataset());
const names = full.packages.map(p => p.name);
const edges = full.deps.map(d => [d.from, d.to] as [string,string]);

const out = computeBetweenness(names, edges);
const sorted = [...out.scores.entries()].sort((a,b)=>b[1]-a[1]);
const rank = sorted.findIndex(([n])=>n==='brace-expansion');
console.log('DIRECTED brace-expansion rank', rank+1, 'of', sorted.length, 'score', out.scores.get('brace-expansion'));
console.log('minimatch rank', sorted.findIndex(([n])=>n==='minimatch')+1, out.scores.get('minimatch'));
console.log('glob rank', sorted.findIndex(([n])=>n==='glob')+1);

// ancestors of minimatch / balanced-match
const rev = new Map<string,string[]>();
for (const d of full.deps) { const l=rev.get(d.to); if(l)l.push(d.from); else rev.set(d.to,[d.from]); }
function ancestors(t:string){ const seen=new Set([t]); const q=[t]; for(let i=0;i<q.length;i++) for(const p of rev.get(q[i])??[]) if(!seen.has(p)){seen.add(p);q.push(p);} return seen.size-1; }
console.log('ancestors(minimatch)',ancestors('minimatch'),'ancestors(brace-expansion)',ancestors('brace-expansion'),'ancestors(balanced-match)',ancestors('balanced-match'));
console.log('balanced-match in-edges', full.deps.filter(d=>d.to==='balanced-match'));
console.log('balanced-match out-edges', full.deps.filter(d=>d.from==='balanced-match'));

// UNDIRECTED
const und: [string,string][] = [];
for (const [a,b] of edges) { und.push([a,b]); und.push([b,a]); }
const ub = brandes(names, und);
const usorted = [...ub.entries()].sort((a,b)=>b[1]-a[1]);
console.log('\nUNDIRECTED top 15:');
usorted.slice(0,15).forEach(([n,v],i)=>console.log(String(i+1).padStart(3), n.padEnd(30), v.toFixed(1)));
console.log('UNDIRECTED brace-expansion rank', usorted.findIndex(([n])=>n==='brace-expansion')+1, ub.get('brace-expansion'));
console.log('UNDIRECTED minimatch rank', usorted.findIndex(([n])=>n==='minimatch')+1, ub.get('minimatch'));

// ancestors ranking (blast radius)
const anc = names.map(n=>[n, ancestors(n)] as [string,number]).sort((a,b)=>b[1]-a[1]);
console.log('\nBLAST RADIUS top 15:'); anc.slice(0,15).forEach(([n,v],i)=>console.log(String(i+1).padStart(3), n.padEnd(30), v));
console.log('blast rank brace-expansion', anc.findIndex(([n])=>n==='brace-expansion')+1, anc.find(([n])=>n==='brace-expansion'));
