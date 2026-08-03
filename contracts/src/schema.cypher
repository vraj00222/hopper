// HOPPER — ontology. 15 labels, 16 relationship types.
// Applied by @hopper/graph on boot. Statements are separated by ';'.

CREATE INDEX FOR (a:Advisory) ON (a.ghsa_id);
CREATE INDEX FOR (a:Advisory) ON (a.cve_id);
CREATE INDEX FOR (a:Advisory) ON (a.published_at);
CREATE INDEX FOR (p:Package) ON (p.name);
CREATE INDEX FOR (p:Package) ON (p.is_chokepoint);
CREATE INDEX FOR (r:Repo) ON (r.name);
CREATE INDEX FOR (s:Service) ON (s.name);
CREATE INDEX FOR (t:Team) ON (t.name);
CREATE INDEX FOR (p:Person) ON (p.email);
CREATE INDEX FOR (c:Customer) ON (c.name);
CREATE INDEX FOR (c:Contract) ON (c.id);
CREATE INDEX FOR (c:Clause) ON (c.type);
CREATE INDEX FOR (i:Incident) ON (i.id);
CREATE INDEX FOR (pa:PatchAttempt) ON (pa.package);
CREATE INDEX FOR (av:AgentVerdict) ON (av.ghsa_id);
CREATE INDEX FOR (d:Decision) ON (d.ghsa_id);
CREATE INDEX FOR (pl:Pipeline) ON (pl.id);
CREATE INDEX FOR (ac:AdvisoryClass) ON (ac.id);

// ── labels ──────────────────────────────────────────────────────────────────
// Advisory      {ghsa_id, cve_id, severity, cvss, published_at, summary, in_kev,
//                ecosystem, package_name, vulnerable_range, fixed_in, source}
// Package       {name, ecosystem, is_chokepoint, betweenness, version}
// Repo          {name, org, lockfile_path}
// Service       {name, tier, env, public_facing}
// Team          {name, slack_channel}
// Person        {name, email, oncall_until, slack_handle}
// Customer      {name, tier, arr, region}
// Contract      {id, signed_at, governing_law}
// Clause        {type, hours, text_ref, text}
// Incident      {id, opened_at, severity, ghsa_id}
// PatchAttempt  {id, package, from_v, to_v, outcome, ts, notes}
// AgentVerdict  {id, agent, verdict, confidence, rationale, ts, ghsa_id, payload_json}
// Decision      {id, action, auto, approved_by, ts, ghsa_id, outcome}
// Pipeline      {id, name, spec_json, avg_latency, success_rate, runs}
// AdvisoryClass {id, ecosystem, severity_band, depth_band}
//
// ── relationships ───────────────────────────────────────────────────────────
// (Advisory)-[:AFFECTS {range, fixed_in}]->(Package)
// (Package)-[:DEPENDS_ON {depth, relation}]->(Package)
// (Repo)-[:USES {declared_version}]->(Package)
// (Repo)-[:DEPLOYS]->(Service)
// (Service)-[:CALLS]->(Service)
// (Service)-[:OWNED_BY]->(Team)
// (Team)-[:ONCALL]->(Person)
// (Service)-[:SERVES]->(Customer)
// (Customer)-[:SIGNED]->(Contract)
// (Contract)-[:HAS_CLAUSE]->(Clause)
// (PatchAttempt)-[:ON]->(Package)
// (AgentVerdict)-[:ABOUT]->(Advisory)
// (Decision)-[:RESOLVED]->(Advisory)
// (Pipeline)-[:HANDLES]->(AdvisoryClass)
// (Pipeline)-[:OUTPERFORMED {margin}]->(Pipeline)
// (Advisory)-[:SUPERSEDED_BY]->(Advisory)
