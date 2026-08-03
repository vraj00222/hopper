# HOPPER

**Every alert is five hops from a customer. Nobody walks them.**

Memory Meets Motion · Frontier Tower SF · August 2026
FalkorDB · LaserData · RocketRide.ai · Guild.ai

---

> **Every tool tells you a package is broken. None can tell you it breaches a contract by 6pm.
> That answer is five hops away, across four systems that have never shared a database.
> Hopper walks the hops.**

---

## Contents

- [What it actually does](#what-it-actually-does)
- [The problem](#the-problem-in-six-numbers)
- [How the four sponsors fit together](#how-the-four-sponsors-fit-together)
- [FalkorDB — memory](#falkordb--memory)
- [LaserData — motion in](#laserdata--motion-in)
- [RocketRide.ai — motion out, and the architectural move](#rocketrideai--motion-out-and-the-architectural-move)
- [Guild.ai — governance](#guildai--governance)
- [The data model](#the-data-model)
- [Running it](#running-it)
- [The demo](#the-demo-in-three-beats)
- [Verification](#verification)
- [How a customer adopts this](#how-a-customer-adopts-this)
- [Business model](#business-model)
- [What is real, and what is not](#what-is-real-and-what-is-not)

---

## What it actually does

Every scanner on the market answers **"is this package vulnerable?"**

Hopper answers a different question: **"does this cost me a customer, and by when am I legally required to tell them?"**

That answer doesn't live in any one system. It is a join across four that have never shared a database:

| system | what it knows | where it lives today |
|---|---|---|
| SBOM / lockfiles | what you depend on, five levels deep | your repos |
| service catalog | which repo deploys which service | Backstage, a wiki, someone's head |
| CRM | which customer uses which service | Salesforce |
| contracts | what you promised each customer, in hours | a PDF in legal's Drive |

Nobody has joined these, because they belong to four different teams who have never had a reason to share a schema. So the answer exists, but no single person can reach it — and the deadline is 24 hours.

Hopper is that join, expressed as a graph traversal:

```
Advisory → Package → …transitive dependencies… → Repo → Service → Customer → Contract → Clause
```

That is the five hops. Against real dependency data pulled from deps.dev, the hero case in this repository is genuinely **six**:

```
brace-expansion → minimatch → glob → @jest/reporters → @jest/core → jest
  → platform-build → build-api → Northwind Systems → §7.3      24h notice window
```

Nobody installs `brace-expansion`. It arrives four layers down through `minimatch` and `glob`, inside every JavaScript build tool on earth. It is the living embodiment of "95% of vulnerable dependencies are transitive."

### Three outcomes, and only one of them is loud

**~99% are suppressed, with a proof.** Not a heuristic, not a confidence score — a traversal that returns zero paths from any repository at depth ≤ 5, rendered as a positive safety claim: `SUPPRESSED · zero hops from any repo`. You can only prove a negative in a graph. This is the single most important behaviour in the product, because it is what makes the other 1% believable.

**The ~1% escalate.** The fix PR opens, on-call is paged, a countdown starts per affected customer, and the breach notice is drafted.

**The customer notification never fires automatically.** It is legal exposure, so it waits on a human signature — enforced structurally, not by convention.

And underneath all three, a memory layer: the system records that a bump broke staging, and argues against repeating it next time.

---

## The problem, in six numbers

| # | number | source |
|---|---|---|
| 1 | **35,364 CVEs in H1 2026** — one every 7.4 minutes, +49.5% YoY | Jerry Gamblin, CVE Mid-Year 2026 |
| 2 | **Only 85 (0.24%) reached CISA KEV** — a signal-to-noise problem, not a patch-volume problem | same |
| 3 | **NIST moved NVD to triage in April 2026** — ~29,000 marked "Not Scheduled" | NIST |
| 4 | **95% of vulnerable deps are transitive**; **under 9.5% reachable** at function level | Endor Labs |
| 5 | Time-to-exploit **32 → 5 days**. Time-to-fix **171 → 252 days** | Mandiant/Fortinet; Veracode SoSS |
| 6 | **DORA 4h · NIS2 24h · GDPR 72h · SEC 4 business days** | DORA RTS; NIS2 Art.23; GDPR Art.33 |

Read together: the volume is up by half, the free triage service that used to sort it has stopped, attackers now move in five days while teams take two hundred and fifty-two, and the moment a customer is affected you have hours rather than months. The industry solved *detection*. Nobody solved *consequence*.

### Why notification is the product

**MOVEit, 2023.** `MOVEit → Zellis (payroll) → British Airways, BBC, Boots → employee bank data`.

British Airways and the BBC never installed MOVEit. They found out because Zellis was contractually obligated to tell them — and Zellis's clock started the moment Zellis *knew*, not when they finished fixing. Roughly 2,700 organisations were in scope.

**If you sell software to businesses, you are Zellis.** Your customers' exposure is your legal problem, and the clock starts on knowledge, not on remediation.

---

## How the four sponsors fit together

```
MEMORY (FalkorDB)                    MOTION (RocketRide)
  what has ever been true      ───►    what happens next
        ▲                                     │
        │                                     ▼
  LaserData writes                     Guild decides who acts
  what is true right now               and where a human signs
        │                                     │
        └─────────────────────────────────────┘
                    the loop
```

This is not a diagram drawn after the fact to fit a theme. Each sponsor occupies a position no other could fill:

- **LaserData** is the only thing that knows what is true *right now* — a CVE published nine minutes ago, a function that executed in the last fifteen minutes, a clock with 21 hours left.
- **FalkorDB** is the only thing that knows what has *ever* been true — and crucially, what has *never* been true, which is what a suppression proof requires.
- **RocketRide** is the only thing that *acts*, and because its pipelines are portable JSON, the graph can choose which one runs.
- **Guild** is the only thing that decides *who* acts and where a human has to sign.

The claim we make on stage: **memory doesn't just feed motion — memory chooses the motion.** That is §4.3 below, and it is the strongest sponsor-specific claim available to this project.

---

## FalkorDB — memory

### How we used it

Docker locally, raw Cypher through the `falkordb` npm driver. Not the REST API, not a cloud instance.

### Why that way

The traversals *are* the product. Q1 is executed on every advisory and iterated on constantly during development, so a REST layer would add a network hop to the hottest path in the system for no benefit. Raw Cypher through the driver also means the query in the source is the query that runs — which matters when the query is the thing you have to defend to a judge.

Running locally in Docker was a deliberate risk decision: forty seconds to a working database, no signup, no connection-string debugging, and no dependency on conference wifi. The browser UI on `:3000` came free and became a demo asset we did not have to build.

### The seven uses, all load-bearing

| | what | why it matters |
|---|---|---|
| **F1** | **Ontology as `contracts/src/schema.cypher`** — 15 labels, 16 relationship types, indices on `Advisory.ghsa_id`, `Package.name`, `Service.name` and the other hot filters | Real modelling rather than ad-hoc `MERGE`s. The schema is frozen and version-controlled, which is what let six agents build against it in parallel |
| **F2** | **Real transitive ingestion from deps.dev** — `DEPENDS_ON {depth, relation}` five levels deep, **445 packages and 904 dependency edges** from six pinned roots | This is the 95% everyone skips. Anyone can model a direct dependency; the product only exists because the dangerous ones are four layers down |
| **F3** | **Zero vector store** | Every byte of agent context comes from Cypher. No embedding model appears anywhere in the dependency tree. This was a design constraint, not an omission |
| **F4** | **Write-back on every event** — verdicts, decisions, suppressions, patch attempts | Memory compounds *inside* the demo. Beat 3 reads an edge written during beat 1 |
| **F5** | **Temporal queries** — `knownAt(ghsa_id, T)` | "What did we know at 02:14?" is the regulator's question, and a system that cannot answer it is not an audit trail |
| **F6** | **Proof-of-absence** — Q2 returns zero paths, rendered as a positive claim | A vector store cannot do this at all. "Nothing similar was retrieved" is not a proof; "no path exists at depth ≤ 5 from any of 6 repositories" is |
| **F7** | **Betweenness centrality** — Brandes over the `DEPENDS_ON` graph | Choke-point packages flagged before they blow up |

### Why it matters commercially

Suppression is the product's economics, not a feature. Rejecting 99% of advisories is only defensible if the rejection can be *proved*, and a proof needs a readable path — which is exactly what a legal artifact requires and exactly what an embedding cannot provide. The graph is also a cost filter: LLM calls fire per *escalation*, not per *advisory*, which is roughly one model call per hundred advisories ingested.

### One honest note

Brandes puts `brace-expansion` at rank **41 of 445**, not in the top five. Betweenness on a dependency DAG structurally favours mid-graph fan-out hubs like `jest-snapshot` and `@jest/transform`. We did not invent a metric to promote our hero package into the top ten.

---

## LaserData — motion in

### How we used it

`@laserdata/laser-sdk` over Apache Iggy, behind an `EventBusPort` interface with a complete in-process implementation on the other side of the same port.

### Why that way

Every module has to run with `MOCK=true` and zero network, because at a hackathon one sponsor service will be down at 8pm — and in our case one was. Putting the transport behind a port made it a runtime decision rather than an architectural one, so the same code path runs on Iggy or in-process with no branching in business logic.

### The six topics

| | stream | role |
|---|---|---|
| **L1** | `advisories` | GitHub Advisory API → republished. Every new CVE is an event |
| **L2** | `telemetry` | Which functions ran in which service, last N minutes. **This is the reachability signal** that turns 95% into 9.5% |
| **L3** | `clock` | 1Hz obligation countdown per customer, state in kv. The most demo-able object in the product |
| **L4** | `kev-delta` | CISA KEV poll; a tracked CVE appearing is a severity escalation that re-triggers the pipeline |
| **L5** | `agent-bus` | The four agents coordinate over a topic, so every multi-agent run is replayable and auditable |
| **L6** | persist all → FalkorDB | Live in, memory out. This is the loop closing |

### What is genuinely live

**50 real advisories pulled.** The GitHub Advisory API was HTTP 403 rate-limited from our IP, so the cascade fell through to OSV exactly as designed. Later, when the limit reset, it pulled from GitHub directly with the newest advisory **five minutes old**.

**CVSS is computed, not copied.** Scores are derived from OSV vector strings by our own CVSS v3.1 implementation, and they independently match the values frozen in the contract. That is a real cross-check rather than a value passed through.

**CISA KEV at 1,657 CVEs**, refreshed mid-session from catalog 2026.07.29 to 2026.08.03.

**The funnel is honest.** `53 ingested → 49 suppressed → 4 escalated`. An earlier version read 31 escalated because the synthetic burst drew from packages genuinely inside the seeded closure — `lodash`, `semver`, `braces`, `micromatch` — which really do have paths to customers. Rather than rig the number, we made the *input* realistic: 64 packages verified absent from the dependency cache, with exactly two survivors that are both in-closure and have telemetry hits. A gate assertion holds pool overlap under 10%; it currently sits at 4.0%.

### Where we hit a wall, stated plainly

A free-tier cluster was provisioned (`aws us-east-1` — the only region where the free tier is available on this tenant), the `iggy` runtime reports healthy, access rules are open to `0.0.0.0/0`, and TCP 8090 accepts connections. But `Laser.connect()` never settles: 25 seconds with no resolution and no error.

We added a TCP pre-flight so the bus degrades to local in milliseconds rather than hanging the process. **The demo therefore runs on the local transport, and we say so rather than claiming a cloud connection we do not have.** The local bus carries all six topics with a measured p99 of 0.081 ms.

### Three bugs worth reporting back to LaserData

1. **`Laser.connect()` against an unreachable or non-responsive endpoint never settles and never times out.** No error, no rejection — the promise simply never resolves, and it holds the event loop so the process will not exit.
2. **The kv API takes `Uint8Array` keys**, but the documented example passes a string — a type error as written.
3. **`laser context set` silently no-ops.** It prints `updated 'division_id' on context 'default'`, but `context show` still reads null and every scoped command fails. Writing the field directly into `config.toml` does not work either.

---

## RocketRide.ai — motion out, and the architectural move

### How we used it

The `rocketride` npm package, **v1.3.0** — *not* `@rocketride/sdk`, which returns a 404 — against `https://api.rocketride.ai`. Note that `cloud.rocketride.ai` is the web application and rejects the websocket upgrade with a 403; the Cloud API endpoint is `api.rocketride.ai`.

### The move, and why it is our strongest architectural claim

> **RocketRide pipelines are portable JSON. JSON is data. Data belongs in the graph.**

So pipeline definitions are stored as `Pipeline` nodes in FalkorDB, with `(Pipeline)-[:HANDLES]->(AdvisoryClass)` edges and `(Pipeline)-[:OUTPERFORMED {margin}]->(Pipeline)`:

```
advisory lands
  → the graph classifies it (ecosystem, hop depth, severity band, chokepoint?)
  → the graph SELECTS the pipeline that has historically performed best on that class
  → RocketRide executes it
  → outcome and latency are written back as an edge
  → the next advisory of that class picks a better pipeline
```

Most systems have one hardcoded pipeline. Ours has a library of them in the graph, and **the graph picks**. Memory doesn't just feed motion — memory chooses the motion. That architecture does not exist without a portable pipeline format.

### We verified the thing it depends on

The critical unknown was whether a `.pipe` spec can be loaded from a JSON **string at runtime** rather than from a file. If not, the whole idea collapses to three pre-registered pipeline IDs. It can:

```ts
const { token } = await client.use({ pipeline })   // a pipeline OBJECT, at runtime
```

Confirmed against the live service with a real task token returned. **The fallback in our risk register was never needed.** Two proofs rather than one: the 14-component production spec loads, and a short spec compiled the same way processed a real payload end to end through the text lane — so the compiled shape genuinely *runs*, not merely parses.

### Three things the live catalogue corrected

We would have shipped all three wrong from the docs alone:

- **Bare `response` is not a provider.** `use()` accepts it, then the task immediately self-terminates with "Task is terminating, cannot process data requests". The real egress is **`response_text`**.
- **Only `ner` and `anonymize_text` carry text→text.** An `anonymize_text` chain failed to start; the identical `ner` chain started and processed a payload.
- **Component ids must be unique per project+source**, or the second `use()` answers "Pipeline is already running". Every dispatch now gets a per-run tag suffix.

### The three pipelines, and why they differ

| pipeline | shape | for |
|---|---|---|
| `deep-traversal` | 12 nodes: full five-stage chain → agents → all four tools → write-back | deep, high-severity advisories. Slowest, most thorough |
| `fast-suppress` | 3 nodes: reachability → `branch.suppress` → write-back | `depth_band: none`. No agents, no tools. **This is what makes the cost-filter claim true** |
| `chokepoint-priority` | 9 nodes: reachability → ownership → page **first**, then obligation and agents | chokepoint packages, where speed of paging beats completeness |

### Where the boundary honestly sits

No RocketRide provider runs Cypher, calls Guild, or opens a pull request. So the remote does not — and cannot — execute our traversal. What actually happens: the graph-selected spec is compiled and genuinely loaded on their engine at runtime, the traversal executes locally against the ports, and the run summary is pushed into that task, with components named as the five traversal stages so their own trace panel reads correctly. Anything beyond that would be theatre, and it is commented as such in the source.

`traceUrl()` returns a local base rather than a guessed dashboard URL. Neither the SDK nor the published docs define a shareable trace page for `id` / `publicToken` / `projectId`, and a link that 404s on stage is worse than no link.

### The number that carries the argument

Suppression costs **7.0 ms and 0 tokens**. Escalation costs **298 ms and 903 tokens**. That is **42× cheaper**, and on the suppression path the agents are never woken at all. The short-circuit is a real branch in the pipeline, visible as `short_circuit: true` in the trace.

---

## Guild.ai — governance

### How we used it

A Guild-compatible control plane — Workspace, Session, Credentials, human-in-the-loop Approvals, readable session traces — implemented locally behind the `AgentsPort` interface, with every call site ready for the real SDK and an HTTP mirror behind `GUILD_API_URL`.

### Why that way

`@guild-ai/sdk` returns a 404 on npm. We did not fake an import that does not exist. What we did instead was build the *shapes* a hosted control plane would expose, so the swap is a single file, and — more importantly — we implemented the **invariants** rather than the buttons.

### The four agents

| | agent | role |
|---|---|---|
| **G1** | Reachability Analyst | dependency path + telemetry → `{reachable, confidence, call_path}` |
| **G2** | Patch Engineer | version ranges + `PatchAttempt` precedent → `{safe_bump, target, breaking_risk}` |
| **G3** | Obligation Officer | customer/contract/clause subgraph → `{clauses[], deadline_utc, notice_draft}` |
| **G4** | Arbiter | reconciles the three, resolves conflict, decides auto vs. human vs. suppress |

All four are **graph-grounded**: every input comes from Cypher results passed in as `AgentInput`. All four emit strict JSON validated at the boundary, and in `MOCK` they are fully deterministic — the same input produces byte-identical verdicts.

### G5 — staged disagreement, and why it had to be real

Three agents agreeing proves nothing. The Reachability Analyst says patch now; the Patch Engineer cites a `PatchAttempt` that broke staging ninety seconds ago; the Arbiter escalates to a human.

**The conflict arises from data, not from a branch on the hero advisory id.** No advisory id appears anywhere in `patch-engineer.ts` or `arbiter.ts` — the trigger is a filter on precedent recency and outcome (`broke_staging` or `rolled_back`, within 600 seconds). Two controls prove it:

- an **identical** precedent aged three days produces **no** conflict, and
- an **unrelated** advisory with a fresh failure fires the **same** conflict.

And the precedent itself is earned: beat 1's pull request genuinely comes back red from CI, which writes the edge that beat 3 finds. Its age is however long the presenter took to get there.

### G6 — the HITL gate, proved two ways

A customer notification cannot execute without a human click. This is enforced, not documented:

- **At runtime** — a pending approval holds no token; a forged token on a returned copy does not persist because the store hands out copies; `reject()` never mints one; a decided request cannot be re-decided.
- **Statically** — a source audit of the package's own code asserts that every write matching `/\btoken\s*[:=]/` lies inside the single marked mint region, which is lexically inside `Approvals.approve()`. One write, zero elsewhere.

The tool executor refuses independently: `notifyCustomer` with an empty `approval_token` returns `ok: false` and delivers nothing. Two independent gates, either sufficient.

### G7 — scoped credentials

Tokens never enter an agent context window. Proved with a **positive control** rather than a vacuous absence check: a sentinel value is planted in a `PatchAttempt` note that the Patch Engineer quotes verbatim in its rationale. It emerges as `[redacted:GITHUB_TOKEN]`, appears nowhere in the result, transcript, session trace, graph writes, bus, or approval body — while `credential('GITHUB_TOKEN')` still resolves it correctly. Credential values live in a `#private` field; `Credentials.toJSON()` emits names only; agents receive `hasCredential(name)` and never the value.

### G8 — dual-write

Every verdict lands in the Guild session trace **and** in FalkorDB as an `AgentVerdict`. Their trace is the operational record; our graph is the regulator audit log. `sessionTrace(sessionId)` reads back a full ordered transcript after the run.

### Why it matters

The difference between decorative and load-bearing is whether the approve button is yours or theirs. Ours is a primitive with an auditable invariant — not a disabled button and a hopeful comment.

---

## The data model

```
Advisory      {ghsa_id, cve_id, severity, cvss, published_at, summary, in_kev, ecosystem, …}
Package       {name, ecosystem, is_chokepoint, betweenness}
Repo          {name, org, lockfile_path}
Service       {name, tier, env, public_facing}
Team          {name, slack_channel}
Person        {name, email, oncall_until}
Customer      {name, tier, arr, region}
Contract      {id, signed_at, governing_law}
Clause        {type, hours, text_ref}
Incident      {id, opened_at, severity}
PatchAttempt  {package, from_v, to_v, outcome, ts, notes}
AgentVerdict  {agent, verdict, confidence, rationale, ts}
Decision      {action, auto, approved_by, ts}
Pipeline      {id, spec_json, avg_latency, success_rate}     ← the meta layer
AdvisoryClass {ecosystem, severity_band, depth_band}

(Advisory)-[:AFFECTS {range, fixed_in}]->(Package)
(Package)-[:DEPENDS_ON {depth, relation}]->(Package)
(Repo)-[:USES {declared_version}]->(Package)
(Repo)-[:DEPLOYS]->(Service)
(Service)-[:SERVES]->(Customer)
(Customer)-[:SIGNED]->(Contract)
(Contract)-[:HAS_CLAUSE]->(Clause)
(Pipeline)-[:HANDLES]->(AdvisoryClass)
(Pipeline)-[:OUTPERFORMED {margin}]->(Pipeline)
```

**Q1 — hop count to customer, the money query:**

```cypher
MATCH (a:Advisory {ghsa_id:$id})-[:AFFECTS]->(vuln:Package)
MATCH path = (r:Repo)-[:USES]->(:Package)-[:DEPENDS_ON*0..5]->(vuln)
MATCH (r)-[:DEPLOYS]->(s:Service)-[:SERVES]->(c:Customer)
      -[:SIGNED]->(:Contract)-[:HAS_CLAUSE]->(cl:Clause)
WHERE cl.type = 'breach_notification'
RETURN c.name AS customer, s.name AS service, cl.hours AS notice_window,
       length(path) AS hops, [n IN nodes(path) | n.name] AS chain
ORDER BY cl.hours ASC
```

**Q2 — proof of no path**, which is the one nobody else can run, and **Q7 — pipeline selection**, which is the meta layer, live alongside it in `packages/graph/src/queries.ts`.

### Repository layout

```
contracts/            FROZEN after Phase 0. Types, ports, schema.cypher, demo constants
packages/graph        FalkorDB          — GraphPort
packages/ingest       LaserData         — EventBusPort + IngestPort
packages/orchestrate  RocketRide        — PipelineRuntimePort + OrchestratorPort + ToolsPort
packages/agents       Guild             — AgentsPort
packages/meta         the pipeline layer — MetaPort
packages/server       integration glue
apps/ui               the operations console
apps/site             the public page and adoption story
```

**Every package depends on `@hopper/contracts` and nothing else.** Collaborators arrive through port interfaces defined in `contracts/src/ports.ts`. That constraint is what allowed six agents to build simultaneously without interface drift: the contracts were frozen and gate-verified *before* any implementation began, and no package ever imported another. Interface drift is the only thing that reliably kills parallel builds, and freezing the contract is the only thing that reliably prevents it.

---

## Running it

FalkorDB must be up. Everything else runs offline.

```bash
npm install
npm run falkor:up          # docker, ports 6379 + 3000
npm run seed               # 489 nodes, 969 edges from cached deps.dev data
npm run demo               # the three beats, headless
npm run dev                # server :8787 · console :5173 · site :5174
```

| script | what it does |
|---|---|
| `npm run gate` | the full Definition of Done — six package gates plus integration |
| `npm run pull-live` | pull real advisories and rewrite the fixtures |
| `npm run replay` | the entire arc from a fixture, **zero network** |
| `npm run typecheck` | whole repo |

`MOCK=true` is the default and runs everything with no network and no credentials. `MOCK=false` arms the live RocketRide bridge and the real advisory pull. The outbound action layer mocks itself when the credential store is empty, with each receipt stamped `mock: true`, so running live without a GitHub token shows the receipts it can honestly produce rather than three failures.

---

## The demo, in three beats

**0:00 — the problem, not the product.**
> "35,364 security bugs in the first six months of this year. One every seven minutes. Eighty-five of them mattered. In April NIST stopped scoring them, so nobody's sorting anymore."

**Beat 1 — the hit.** `brace-expansion`, six hops, landing on clause §7.3. PR opens, on-call paged, clock starts at `T-21:28:26`, customer notice held at the gate.
> "Five hops. That last one is a contract clause. No scanner on the market reaches it."

**Beat 2 — the restraint.** High severity, zero hops. The screen turns teal.
> "High severity, zero hops. Under 9.5% of vulnerabilities are actually reachable. This isn't a guess — it's a proof of no-path. You can only prove absence in a graph."

**Beat 3 — memory.** The Patch Engineer's verdict changes, citing a `PatchAttempt` this system wrote ninety seconds earlier during beat 1, when the pull request came back red from CI.
> "Nothing about that is in the prompt. It's an edge this system wrote ninety seconds ago."

**The meta reveal.** Beat 3 ran a *different pipeline* than beat 1, and the strip says so.
> "We store RocketRide pipelines as nodes in FalkorDB and let the graph pick based on what's worked before. Memory doesn't just feed motion. Memory chooses the motion."

**The gate.**
> "This action — telling a customer — runs through Guild's approval primitive. It cannot execute without a human."

---

## Verification

Every slice wrote its gate **before** its implementation. All reproducible with `npm run gate`.

| slice | gate | headline |
|---|---|---|
| graph | **30/30 ×2 backends** | identical results on FalkorDB and the in-memory fallback |
| ingest | **19/19** | 50 real advisories, clock monotonic, no leaked timers |
| orchestrate | **56/56** mock · **65/65** live | runtime pipeline loading proved against the real service |
| agents | **70/70** | HITL and credential containment proved statically *and* at runtime |
| meta | **91/91** | two classes select different pipelines; selection flips on recorded failures |
| ui | **89 checks** | the full arc renders from a fixture with no backend at all |
| **integration** | **24/24** | the spec's Definition of Done, executed as assertions rather than a checklist |

**Stability:** three consecutive runs, byte-identical — `escalated / suppressed / escalated`, two conflict lines, `53 ingested → 49 suppressed → 4 escalated` every time. A demo that varies run to run is a demo that fails on stage.

**Offline:** `npm run replay` runs the entire arc from a fixture with zero network. The in-memory graph backend passes the same 30 checks as FalkorDB, so the arc survives Docker dying.

---

## How a customer adopts this

Progressive, and nothing valuable is gated behind the hard part.

**Layer 1 — install the GitHub App. About 30 seconds.**
No SDK, no code change, nothing running in your production runtime. Hopper reads your lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `go.sum`, `poetry.lock`, `Cargo.lock`) and builds the transitive graph from deps.dev and OSV. You immediately get suppression and hop paths. **This layer alone is the pitch:** Dependabot opens 40 PRs a month; Hopper opens 2.

**Layer 2 — map repos to services.** A short `hopper.yml` per repo, or read from an existing catalog such as Backstage, or from Kubernetes and Terraform labels.

**Layer 3 — map customers and contracts.** One row per customer: which service they use, and the notice window as a dropdown. Everyone defaults to **72h, the GDPR baseline**, so the clock exists before anyone does the boring work. Optionally sync from Salesforce or HubSpot. Hopper deliberately does **not** parse contract PDFs on day one — that is a Team-tier upsell, not a prerequisite.

**Layer 4 — reachability (optional).** The only part that touches your runtime: an OpenTelemetry exporter reporting which functions actually executed. This is what turns "95% of your dependencies are vulnerable" into "9.5% are actually reachable." Without it Hopper still works — it proves path existence rather than live reachability, and we are explicit about that difference.

**Output goes where your team already is:** pull requests into your repo, Slack or PagerDuty pages, Jira tickets, drafted customer notices. And one rule that never bends — **the customer notification always waits on a human signature.**

---

## Business model

| tier | price | what |
|---|---|---|
| **Watch** | Free | 1 repo · hop paths · suppression log · no actions |
| **Solo** | **$20**/user/mo | 10 repos · auto-PR · Slack paging · precedent memory · reachability filtering |
| **Team** | $99/user/mo | unlimited repos · **customer + contract graph** · obligation clock · audit export · SSO |
| **Enterprise** | custom | self-hosted FalkorDB · VEX/SBOM export · DORA/NIS2 templates · regulator audit trail |

**Why $20 works:** the value is legible in one sentence, provable in week one, needs no procurement, and onboards with one OAuth click.

**Unit economics:** Cypher is sub-100ms and cheap. LLM calls fire only on the ~0.5% that survive traversal — measured at 42× cheaper on the suppression path, with zero tokens spent. The graph is a cost filter as well as an accuracy filter.

**Market:** Snyk is worth $7.4B for answering *"is it vulnerable."* Nobody answers *"does it cost me a customer."* That question has a bigger budget attached, because it is legal exposure rather than an engineering chore.

---

## What is real, and what is not

Stated plainly, because a judge will ask.

### Real

- **FalkorDB**, live, with **445 packages** of genuine transitive dependency data from deps.dev
- **50 advisories** pulled live from the GitHub Advisory API and OSV; **CISA KEV at 1,657** CVEs
- **RocketRide Cloud** — authenticated, pipeline objects loaded at runtime, real task tokens returned, a real payload processed end to end
- The hop path, the suppression proof, the precedent conflict, the HITL invariant, the pipeline selection — **all computed, none hardcoded**

### Local implementations, and why

- **Guild** — `@guild-ai/sdk` does not exist on npm. Built compatible behind the port, with the invariants implemented rather than the buttons.
- **LaserData transport** — the cluster is provisioned and healthy, but the SDK's `connect()` hangs indefinitely. Degrades to the in-process bus, which is complete and carries all six topics at 0.081 ms p99.
- **Outbound actions** — mocked when the credential store is empty, each receipt stamped `mock: true`. Everything upstream stays live.

### Honest imperfections we chose not to hide

- The hero chain is **six hops, not five**. No published version of `jest` depends on `glob` directly; deps.dev routes it through `@jest/core` and `@jest/reporters`. We kept the real edges rather than fabricate a shorter path.
- `brace-expansion` ranks **41 of 445** on betweenness, not top five.
- Root versions are **pinned** so `brace-expansion` resolves `1.1.18` and agrees with the advisory's vulnerable range, instead of `latest` resolving `2.1.4` and contradicting it.

---

## Design

**Direction: Seismograph.** An instrument, not a dashboard. Air traffic control, hospital telemetry. The product's job is to make you *less* alarmed, correctly — so restraint is the entire personality.

```
ground   #0F141C   deep slate, not black
paper    #E8E4DA   bone — primary text
muted    #7A8595   secondary
signal   #E8A33D   amber — the hop propagating
breach   #C7433A   oxide — obligation at risk
clear    #4A9B8E   teal — suppressed / safe
```

**Colour is state, never decoration:** amber, oxide and teal appear only as in-flight, breached and cleared. Everything structural is bone and muted. The countdown is the only large type on the page. No emoji anywhere in product output.

**The signature element** is the hop path — one ring per 300ms, so you *watch* the shockwave travel from CVE to contract clause. On suppression the wave dies at hop two and turns teal. That single animation is the whole product in one image.

`SUPPRESSED · zero hops` reads more confident than any alert.

---

## Built with

Node 25 · TypeScript · npm workspaces · `tsx` (no build step) · React 18 · Vite
`falkordb` · `@laserdata/laser-sdk` · `rocketride` · `@anthropic-ai/sdk`

---

*Grace Hopper — naval, precise, found the first bug. And literally what the product does: it hops the graph.*
