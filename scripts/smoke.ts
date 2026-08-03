/** Phase 0 gate: hand-seed 20 nodes, prove Q1 returns rows. */
import { FalkorDB } from 'falkordb';

const db = await FalkorDB.connect({ socket: { host: 'localhost', port: 6379 } });
const g = db.selectGraph('hopper_smoke');

await g.query('MATCH (n) DETACH DELETE n');
await g.query(`
  CREATE (a:Advisory {ghsa_id:'GHSA-x', severity:'HIGH'})
  CREATE (be:Package {name:'brace-expansion'})
  CREATE (mm:Package {name:'minimatch'})
  CREATE (gl:Package {name:'glob'})
  CREATE (je:Package {name:'jest'})
  CREATE (r:Repo {name:'build-api-repo'})
  CREATE (s:Service {name:'build-api'})
  CREATE (c:Customer {name:'Northwind Systems', tier:'enterprise'})
  CREATE (ct:Contract {id:'CTR-1'})
  CREATE (cl:Clause {type:'breach_notification', hours:24, text_ref:'§7.3'})
  CREATE (a)-[:AFFECTS {range:'<1.1.18'}]->(be)
  CREATE (je)-[:DEPENDS_ON {depth:1}]->(gl)
  CREATE (gl)-[:DEPENDS_ON {depth:2}]->(mm)
  CREATE (mm)-[:DEPENDS_ON {depth:3}]->(be)
  CREATE (r)-[:USES {declared_version:'^29'}]->(je)
  CREATE (r)-[:DEPLOYS]->(s)
  CREATE (s)-[:SERVES]->(c)
  CREATE (c)-[:SIGNED]->(ct)
  CREATE (ct)-[:HAS_CLAUSE]->(cl)
`);

const res = await g.query<any>(
  `MATCH (a:Advisory {ghsa_id:$id})-[:AFFECTS]->(vuln:Package)
   MATCH path = (r:Repo)-[:USES]->(:Package)-[:DEPENDS_ON*0..5]->(vuln)
   MATCH (r)-[:DEPLOYS]->(s:Service)-[:SERVES]->(c:Customer)
         -[:SIGNED]->(:Contract)-[:HAS_CLAUSE]->(cl:Clause)
   WHERE cl.type = 'breach_notification'
   RETURN c.name AS customer, s.name AS service, cl.hours AS notice_window,
          length(path) AS hops, [n IN nodes(path) | n.name] AS chain
   ORDER BY cl.hours ASC`,
  { params: { id: 'GHSA-x' } },
);

console.log(JSON.stringify(res.data, null, 2));
const rows = res.data ?? [];
if (rows.length === 0) {
  console.error('GATE FAILED: Q1 returned no rows');
  process.exit(1);
}
console.log(`\nPHASE 0 GATE PASSED — Q1 returned ${rows.length} row(s), hops=${rows[0].hops}`);
await db.close();
