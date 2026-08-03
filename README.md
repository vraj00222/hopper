# HOPPER

**Every alert is five hops from a customer. Nobody walks them.**

Memory Meets Motion · Frontier Tower SF · August 2026
FalkorDB · LaserData · RocketRide.ai · Guild.ai

---

## The one line

> Every tool tells you a package is broken. None can tell you it breaches a contract by 6pm.
> That answer is five hops away, across four systems that have never shared a database.
> Hopper walks the hops.

---

## What it actually does

Every scanner on the market answers **"is this package vulnerable?"**

Hopper answers a different question: **"does this cost me a customer, and by when am I legally required to tell them?"**

That answer doesn't live in any one system. It's a join across four that have never shared a database:

| system | what it knows |
|---|---|
| SBOM / lockfiles | what you depend on, five levels deep |
| service catalog | which repo deploys which service |
| CRM | which customer uses which service |
| contracts | what you promised each customer, and in how many hours |

So the answer is a graph traversal:

```
Advisory → Package → …transitive dependencies… → Repo → Service → Customer → Contract → Clause
```

That's the five hops. Running against real dependency data pulled from deps.dev, the hero case in this repo is genuinely six:

```
brace-expansion → minimatch → glob → @jest/reporters → @jest/core → jest
  → platform-build → build-api → Northwind Systems → §7.3        24h notice window
```

Nobody installs `brace-expansion`. It arrives four layers down through `minimatch` and `glob`, inside every JavaScript build tool on earth. It is the living embodiment of "95% of vulnerable dependencies are transitive."

### Three outcomes

- **~99% suppressed**, with a *proof*: there is no path from any repo to that package. You can only prove a negative in a graph — which is precisely why this is not a vector store.
- **The ~1%**: opens the fix PR, pages on-call, starts a countdown per affected customer, drafts the breach notice.
- **The customer notification never fires automatically.** It is legal exposure, so it waits on a human signature.

Plus a memory layer: the system records that a bump broke staging, and argues against repeating it the next time.

---

## The problem, in six numbers

| # | number | source |
|---|---|---|
| 1 | **35,364 CVEs in H1 2026** — one every 7.4 minutes, +49.5% YoY | Jerry Gamblin, CVE Mid-Year 2026 |
| 2 | **Only 85 (0.24%) reached CISA KEV.** A signal-to-noise problem, not a patch-volume problem | same |
| 3 | **NIST moved NVD to triage April 2026** — ~29,000 marked "Not Scheduled" | NIST |
| 4 | **95% of vulnerable deps are transitive**; **under 9.5% reachable** at function level | Endor Labs |
| 5 | Time-to-exploit **32 → 5 days**. Time-to-fix **171 → 252 days** | Mandiant/Fortinet; Veracode SoSS |
| 6 | **DORA 4h · NIS2 24h · GDPR 72h · SEC 4 business days** | DORA RTS; NIS2 Art.23; GDPR Art.33 |

### Why notification is the product

**MOVEit, 2023.** `MOVEit → Zellis (payroll) → British Airways, BBC, Boots → employee bank data`.

BA and the BBC never installed MOVEit. They found out because Zellis was contractually obligated to tell them — and Zellis's clock started the moment Zellis *knew*, not when they finished fixing. Roughly 2,700 organisations were in scope.

**If you sell software to businesses, you are Zellis.**

---

## Sponsor integration

Four sponsors, each load-bearing. This section is deliberately specific about **how** each was used, **why that particular way**, and **what it buys the product** — including the places where we hit a wall and said so.

### FalkorDB — memory

**How.** Docker locally, raw Cypher through the `falkordb` npm driver. Not the REST API.

**Why that way.** The traversals *are* the product. The REST layer would add a hop to the one query we run a hundred times while iterating, and the browser UI on `:3000` is a demo asset we didn't have to build.

**What it buys us — seven things, all load-bearing:**

| | | |
|---|---|---|
| **F1** | Ontology as `contracts/src/schema.cypher` | 15 labels, 16 relationship types, indices on the fields the hot queries filter by. Real modelling, not ad-hoc MERGEs |
| **F2** | Real transitive ingestion from deps.dev | `DEPENDS_ON {depth, relation}` five levels deep — **445 packages, 904 dependency edges** from six pinned roots. This is the 95% everyone skips |
| **F3** | **Zero vector store** | Every byte of agent context comes from Cypher. No embedding model anywhere in the dependency tree |
| **F4** | Write-back on every event | Verdicts, decisions, suppressions and patch attempts all land as nodes. Memory compounds *inside* the demo |
| **F5** | Temporal edges | `knownAt(ghsa_id, T)` answers "what did we know at 02:14?" — the regulator's question |
| **F6** | **Proof-of-absence** | Q2 returns zero paths and renders it as a positive safety claim. A vector store cannot do this at all |
| **F7** | Betweenness centrality | Brandes over the `DEPENDS_ON` graph, pre-flagging choke-point packages |

**Why it matters.** Suppression is the product's economics. Rejecting 99% of advisories is only defensible if you can *prove* the rejection, and a proof needs a readable path — which is what a legal artifact requires and what an embedding cannot provide.

**One honest note.** Honest Brandes puts `brace-expansion` at rank **41 of 445**, not top five. Betweenness on a dependency DAG structurally favours mid-graph fan-out hubs. We did not invent a metric to promote it.

---

### LaserData — motion in

**How.** `@laserdata/laser-sdk` over Apache Iggy, with a complete in-process bus behind the same `EventBusPort` interface.

**Why that way.** Every module has to run with `MOCK=true` and zero network, because at a hackathon one sponsor service will be down at 8pm. The port abstraction means the transport is a runtime decision, not an architectural one.

**Six topics:**

| | stream | role |
|---|---|---|
| **L1** | `advisories` | GitHub Advisory API → republished. Every new CVE is an event |
| **L2** | `telemetry` | Which functions ran in which service. **This is the reachability signal** that turns 95% into 9.5% |
| **L3** | `clock` | 1Hz obligation countdown per customer, state in kv |
| **L4** | `kev-delta` | CISA KEV poll; a tracked CVE appearing is a severity escalation |
| **L5** | `agent-bus` | The agents coordinate over a topic, so every multi-agent run is replayable |
| **L6** | persist all → FalkorDB | Live in, memory out |

**What's real.** 50 advisories pulled live. The GitHub Advisory API was HTTP 403 rate-limited from our IP, so the cascade fell through to OSV exactly as designed — and later, when the limit reset, pulled from GitHub directly with the newest advisory **five minutes old**. CVSS scores are computed from OSV vector strings by our own v3.1 implementation and independently match the values frozen in the contract, which is a real cross-check rather than a copy.

**Where we hit a wall, stated plainly.** A free-tier cluster was provisioned (`aws us-east-1` — the only region where the free tier is available on this tenant), the `iggy` runtime reports healthy, access rules are open to `0.0.0.0/0`, and TCP 8090 accepts connections. But `Laser.connect()` never settles — it hangs indefinitely rather than erroring or timing out. We added a TCP pre-flight so the bus degrades to local in milliseconds instead of hanging the process. **The demo runs on the local transport, and we say so rather than claiming a cloud connection we don't have.**

**Three bugs worth reporting back to LaserData:**
1. `Laser.connect()` against an unreachable or non-responsive endpoint never settles and never times out.
2. The kv API takes `Uint8Array` keys, but their documented example passes a string — a type error as written.
3. `laser context set` reports `updated 'division_id' on context 'default'` but does not persist; every subsequent scoped command fails. Writing the field into `config.toml` by hand doesn't work either.

---

### RocketRide.ai — motion out, and the architectural move

**How.** The `rocketride` npm package (v1.3.0 — *not* `@rocketride/sdk`, which is a 404) against `https://api.rocketride.ai`.

**The move, and why it's the strongest sponsor-specific claim we can make:**

> RocketRide pipelines are portable JSON. JSON is data. Data belongs in the graph.

So pipeline definitions are stored as `Pipeline` nodes in FalkorDB, with `(Pipeline)-[:HANDLES]->(AdvisoryClass)` edges and `(Pipeline)-[:OUTPERFORMED {margin}]->(Pipeline)`:

```
advisory lands
  → the graph classifies it (ecosystem, hop depth, severity, chokepoint?)
  → the graph SELECTS the pipeline that has historically performed best on that class
  → RocketRide executes it
  → outcome and latency written back as an edge
  → the next advisory of that class picks a better pipeline
```

**Memory doesn't just feed motion. Memory chooses the motion.** And that architecture is only possible because their pipeline format is portable JSON.

**We verified the thing it depends on.** The critical unknown was whether a `.pipe` spec can be loaded from a JSON *string* at runtime, rather than a file. It can:

```ts
const { token } = await client.use({ pipeline })   // a pipeline OBJECT, at runtime
```

Confirmed against the live service with a real task token returned. The graph can hand back `spec_json` and we can run it. **The pre-registered-pipeline-ID fallback in our risk register was never needed.**

**What the live catalogue corrected.** Three things we would otherwise have shipped wrong:
- Bare `response` is not a provider. `use()` accepts it, then the task silently self-terminates. The real egress is `response_text`.
- Only `ner` and `anonymize_text` carry text→text. An `anonymize_text` chain fails to start.
- Component ids must be unique per project+source, or the second `use()` answers "Pipeline is already running".

**Where the boundary honestly sits.** No RocketRide provider runs Cypher, calls Guild, or opens a pull request. So the remote does not — and cannot — execute our traversal. What happens: the graph-selected spec is compiled and genuinely loaded on their engine at runtime, the traversal executes locally against the ports, and the run summary is pushed into that task, with the components named as the five traversal stages so their own trace panel reads correctly. Anything beyond that would be theatre, and it is commented as such in the source.

`traceUrl()` returns a local base rather than a guessed dashboard URL. Neither the SDK nor the docs define a shareable trace page, and a link that 404s on stage is worse than no link.

---

### Guild.ai — governance, not just agents

**How.** A Guild-compatible control plane — Workspace, Session, Credentials, human-in-the-loop Approvals, readable session traces — implemented locally behind the `AgentsPort` interface, with every call site ready for the real SDK. `@guild-ai/sdk` is a 404 on npm; we did not fake an import that doesn't exist.

**Four agents, all graph-grounded:**

| | agent | role |
|---|---|---|
| **G1** | Reachability Analyst | dependency path + telemetry → `{reachable, confidence, call_path}` |
| **G2** | Patch Engineer | version ranges + `PatchAttempt` precedent → `{safe_bump, target, breaking_risk}` |
| **G3** | Obligation Officer | customer/contract/clause subgraph → `{clauses[], deadline_utc, notice_draft}` |
| **G4** | Arbiter | reconciles, resolves conflict, decides auto vs. human |

**G5 — staged disagreement.** Three agents agreeing proves nothing. The Reachability Analyst says patch now; the Patch Engineer cites a `PatchAttempt` that broke staging ninety seconds ago; the Arbiter escalates to a human.

Critically, **the conflict arises from data, not from a branch on the hero advisory id.** No advisory id appears anywhere in `patch-engineer.ts` or `arbiter.ts` — the trigger is a filter on precedent recency and outcome. Two controls prove it: an *identical* precedent aged three days produces no conflict, and an unrelated advisory with a fresh failure fires the same one.

**G6 — the HITL gate.** A customer notification cannot execute without a human click. Proved two ways: at runtime (a pending approval holds no token; a forged token on a returned copy does not persist; reject never mints one), and by a **static audit of the package's own source** asserting that every `token` write lies inside the single marked mint region inside `approve()`.

**G7 — scoped credentials.** Tokens never enter an agent context window. Proved with a *positive control* rather than a vacuous absence check: a sentinel value is planted in a `PatchAttempt` note that the Patch Engineer quotes verbatim. It comes out `[redacted:GITHUB_TOKEN]` in the verdict, appears nowhere in the result, transcript, session trace, graph writes, bus or approval body — while `credential('GITHUB_TOKEN')` still resolves it.

**G8 — dual-write.** Every verdict lands in the Guild session trace *and* in FalkorDB as an `AgentVerdict`. Their trace is the operational record; our graph is the regulator audit log.

**Why it matters.** The difference between decorative and load-bearing is whether the approve button is yours or theirs. Ours is a primitive with an auditable invariant, not a disabled button.

---

## Architecture

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

**Every package depends on `@hopper/contracts` and nothing else.** Collaborators arrive through port interfaces. That constraint is what let six agents build in parallel without interface drift — the contracts were frozen and gate-verified *before* any implementation began, and no package ever imported another.

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

`MOCK=true` is the default and runs everything with no network and no credentials. `MOCK=false` arms the live RocketRide bridge and the real advisory pull.

---

## The demo, in three beats

**Beat 1 — the hit.** `brace-expansion`, six hops, landing on clause §7.3. PR opens, on-call paged, clock starts at `T-21:28:26`, customer notice held at the gate.

**Beat 2 — the restraint.** High severity, zero hops. The screen turns teal.
*"Under 9.5% of vulnerabilities are actually reachable. This isn't a guess — it's a proof of no-path. You can only prove absence in a graph."*

**Beat 3 — memory.** The Patch Engineer's verdict changes: it cites a `PatchAttempt` this system wrote ninety seconds earlier, during beat 1, when the pull request came back red from CI.
*"Nothing about that is in the prompt. It's an edge this system wrote ninety seconds ago."*

That precedent is **earned, not scripted** — beat 1's PR genuinely fails CI, which writes the edge that beat 3 finds. Its age is however long the presenter took to get there.

---

## Verification

Every slice wrote its gate **before** its implementation. All of these are reproducible with `npm run gate`.

| slice | gate | headline |
|---|---|---|
| graph | **30/30 ×2 backends** | identical results on FalkorDB and the in-memory fallback |
| ingest | **19/19** | 50 real advisories, clock monotonic, no leaked timers |
| orchestrate | **56/56** mock · **65/65** live | runtime pipeline loading proved against the real service |
| agents | **70/70** | HITL and credential containment proved statically *and* at runtime |
| meta | **91/91** | two classes select different pipelines; selection flips on failures |
| ui | **89 checks** | full arc renders from fixture with no backend |
| **integration** | **24/24** | the spec's Definition of Done, executed as assertions |

**Stability:** three consecutive runs, byte-identical — `escalated / suppressed / escalated`, two conflict lines, `53 ingested → 49 suppressed → 4 escalated` every time.

**The cost argument, measured:** suppression costs **7.0 ms and 0 tokens**; escalation costs **298 ms and 903 tokens**. That is **42× cheaper**, and the agents are never woken. The graph is a cost filter as much as an accuracy filter — LLM calls fire per *escalation*, not per *advisory*.

---

## How a customer adopts this

Progressive, and nothing valuable is gated behind the hard part.

**Layer 1 — install the GitHub App. About 30 seconds.**
No SDK, no code change, nothing running in your production runtime. Hopper reads your lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `go.sum`, `poetry.lock`, `Cargo.lock`) and builds the transitive graph from deps.dev and OSV. You immediately get suppression and hop paths. **This layer alone is the pitch:** Dependabot opens 40 PRs a month; Hopper opens 2.

**Layer 2 — map repos to services.** A short `hopper.yml` per repo, or read from an existing catalog such as Backstage, or from Kubernetes and Terraform labels.

**Layer 3 — map customers and contracts.** One row per customer: which service they use, and the notice window as a dropdown. Everyone defaults to **72h (the GDPR baseline)**, so the clock exists before anyone does the boring work. Optionally sync from Salesforce or HubSpot. Hopper deliberately does **not** parse contract PDFs on day one.

**Layer 4 — reachability (optional).** The only part that touches your runtime: an OpenTelemetry exporter reporting which functions actually executed. This is what turns "95% of your dependencies are vulnerable" into "9.5% are actually reachable." Without it Hopper still works — it proves path existence rather than live reachability.

**Output goes where your team already is:** pull requests into your repo, Slack or PagerDuty pages, Jira tickets, drafted customer notices. And one rule that never bends — **the customer notification always waits on a human signature.**

---

## Business model

| tier | price | what |
|---|---|---|
| **Watch** | Free | 1 repo · hop paths · suppression log · no actions |
| **Solo** | **$20**/user/mo | 10 repos · auto-PR · Slack paging · precedent memory · reachability filtering |
| **Team** | $99/user/mo | unlimited repos · **customer + contract graph** · obligation clock · audit export · SSO |
| **Enterprise** | custom | self-hosted FalkorDB · VEX/SBOM export · DORA/NIS2 templates · regulator audit trail |

Snyk is worth $7.4B for answering *"is it vulnerable."* Nobody answers *"does it cost me a customer."* That question has a bigger budget attached, because it is legal exposure rather than an engineering chore.

---

## What is real, and what is not

Stated plainly, because a judge will ask.

**Real:**
- FalkorDB, live, with 445 packages of genuine transitive dependency data from deps.dev
- 50 advisories pulled live from the GitHub Advisory API and OSV; CISA KEV at 1,657 CVEs
- RocketRide Cloud — authenticated, pipeline objects loaded at runtime, real task tokens, a real payload processed end to end
- The hop path, the suppression proof, the precedent conflict, the HITL invariant, the pipeline selection — all computed, none hardcoded

**Local implementations, and why:**
- **Guild** — `@guild-ai/sdk` does not exist on npm. Built compatible behind the port.
- **LaserData transport** — the cluster is provisioned and healthy, but the SDK's `connect()` hangs. Degrades to the in-process bus, which is complete and carries all six topics.
- **Outbound actions** — mocked when the credential store is empty, each receipt stamped `mock: true`. Everything upstream stays live.

**Honest imperfections we chose not to hide:**
- The hero chain is six hops, not the five in the pitch. No published `jest` depends on `glob` directly; deps.dev routes it through `@jest/core` and `@jest/reporters`. We kept the real edges.
- `brace-expansion` ranks 41/445 on betweenness, not top five.
- Root versions are pinned so `brace-expansion` resolves `1.1.18` and agrees with the advisory's range instead of contradicting it.

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

Colour is state, never decoration: amber, oxide and teal appear only as in-flight, breached and cleared. The countdown is the only large type on the page. No emoji anywhere in product output.

**The signature element** is the hop path — one ring per 300ms, so you *watch* the shockwave travel from CVE to contract clause. On suppression the wave dies at hop two and turns teal. That single animation is the whole product in one image.

`SUPPRESSED · zero hops` reads more confident than any alert.

---

## Built with

Node 25 · TypeScript · npm workspaces · `tsx` (no build step) · React 18 · Vite
`falkordb` · `@laserdata/laser-sdk` · `rocketride` · `@anthropic-ai/sdk`
