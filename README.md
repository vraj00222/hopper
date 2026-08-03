# HOPPER

**Every alert is five hops from a customer. Nobody walks them.**

Memory Meets Motion · Frontier Tower SF · August 2026
FalkorDB · LaserData · RocketRide.ai · Guild.ai

---

> Every tool says this package is broken.
> None can say it will breach a contract by 6pm.
> That answer is five hops away, across four systems that have never shared a database.

---

## What this solves

A new security bug appears every 7 minutes. Only 1 in 400 is real.

In April 2026 NIST stopped scoring most of them, so the sorting layer the industry
depended on is gone. The bugs that matter are buried four layers deep in libraries
nobody chose to install. Attackers get in within 5 days. Teams take 252 to patch.

And if a customer is affected, your contract may give you **24 hours to tell them**.

Every scanner answers *"is this package vulnerable."* Hopper answers a different
question: **"does this cost me a customer, and by when must I tell them."**

---

## Two things that confuse people

### 1. "Library using a library" — yes, that is the problem

You install `jest` to run your tests. `jest` installs `@jest/core`. That installs
`@jest/reporters`, which installs `glob`, which installs `minimatch`, which installs
`brace-expansion`.

You chose one package. You got six hundred.

When a bug lands in `brace-expansion`, it is in your product — but you never typed
its name, it is not in your `package.json`, and most scanners stop looking before
they reach it. **95% of vulnerable dependencies arrive this way.**

That is what "five hops" means. It is not a metaphor.

### 2. The contract thing — what it actually is

When you sell software to another business, you sign a contract with them. Inside it
is a clause that reads roughly:

> *"Provider shall notify Customer within 24 hours of becoming aware of any
> security incident affecting Customer Data."*

Three things about that clause matter:

**It is per-customer.** Your enterprise customer negotiated 24 hours. Your mid-market
customer got 72. Nobody has a list of which is which.

**The clock starts when you *know*, not when you *fix*.** You cannot patch first and
notify later. Finding out you are affected starts the timer.

**Regulation stacks on top of it.** GDPR gives 72 hours, NIS2 gives 24, DORA gives 4,
the SEC gives 4 business days. Whichever is tightest wins.

**To be precise:** a CVE existing is not automatically a reportable breach. The duty
usually triggers on an actual incident. What Hopper does is tell you **which customers
are in scope, immediately** — so you spend your 24 hours deciding, instead of spending
20 of them finding out who is affected.

---

## Why this is worth building — two real cases

**MOVEit, June 2023.** A SQL injection flaw in Progress Software's file-transfer tool.

```
MOVEit → Zellis (payroll) → British Airways · BBC · Boots → employees' salary and bank data
```

British Airways and the BBC never installed MOVEit. They found out because Zellis was
contractually obligated to tell them — and **Zellis's clock started the moment Zellis
knew.** Around 2,700 organisations were in scope.

**If you sell software to businesses, you are Zellis.**

**Equifax, 2017.** Apache Struts, `CVE-2017-5638`. The patch existed the day the bug
was disclosed in March. It was not applied. Attackers were inside by May. Nobody
noticed until late July. It was disclosed in September — six months from patch to
notification. 147 million people. Settlement north of $700M.

The vulnerability was not the failure. **The traversal was.**

---

## How it works

An advisory arrives. Here is what happens to it.

**1. It comes in live.** GitHub's advisory API first, falling through to OSV if GitHub
is rate limited, falling through to a local fixture if both are down. The fixture path
re-stamps every record `source: fixture`, so a caller is never told it got live data
when it did not.

**2. The graph walks it.**

```
Advisory → Package → …transitive dependencies… → Repo → Service → Customer → Contract → Clause
```

Sub-100ms in Cypher. Returns every affected customer with their notice window,
tightest deadline first.

**3. Most advisories die here — and that is the product.** If the walk returns nothing,
that is not an empty result, it is a **proof**: no route exists from any repository to
that package at depth 5. Costs 7ms and zero tokens. 99% of advisories end this way.

**4. The 1% get worked.** Four agents decide: is it reachable, is it safe to patch,
what do we owe the customer, and does a human need to sign. A pull request opens,
on-call is paged, a countdown starts per customer.

**5. Telling the customer always waits for a human.** That is legal exposure, so it is
enforced structurally, not by convention.

**6. The loop closes.** Every verdict, decision and patch outcome is written back. Next
time, the system argues from what happened last time.

---

## The four systems

### FalkorDB — memory

**How.** Docker locally, raw Cypher through the `falkordb` driver. Not the REST API.

**Why that way.** The traversals are the product. A REST layer adds a hop to the
hottest query in the system, and the browser UI on `:3000` came free.

**What it buys us.** Real transitive ingestion from deps.dev — **445 packages, 904
dependency edges** from six roots. Q1 finds the customer. Q2 proves absence. Q3
recalls precedent. Q7 selects the pipeline. Betweenness flags choke points. Every
verdict written back, so memory compounds during the demo.

**No vector store.** Every byte of agent context comes from Cypher. That is not a
preference — our core output is a *negative*, and "nothing similar was retrieved" is
not a proof. "No path exists at depth ≤ 5 from any of six repositories" is.

### LaserData — what is true right now

**How.** `@laserdata/laser-sdk` over Apache Iggy, behind a port with a full in-process
implementation on the other side.

**Why that way.** Every module must run with `MOCK=true` and no network, because at a
hackathon one service will be down. The port makes transport a runtime choice.

**What it buys us.** Six topics. Advisories in. Telemetry — which functions actually
ran, the signal that turns "95% vulnerable" into "9.5% reachable". A 1Hz obligation
clock. KEV escalation. An agent bus, so every multi-agent run is replayable.

FalkorDB knows everything that has ever been true. **LaserData knows what is true
right now.** Without it you have a good archive and no reason to act today.

### RocketRide — motion, and the architectural move

**How.** The `rocketride` package v1.3.0 against `api.rocketride.ai`.

**The move.** RocketRide pipelines are portable JSON. JSON is data. Data belongs in
the graph. So pipelines are stored as nodes in FalkorDB, and **the graph selects which
one runs** based on what has performed best on that class of advisory. Outcomes are
written back as edges, so the next advisory picks a better pipeline.

**Memory doesn't just feed motion. Memory chooses the motion.**

That only works because their format is portable. We confirmed it against the live
API: `use({ pipeline })` accepts an object at runtime and returns a real task token.

**Where the boundary honestly sits.** No RocketRide provider runs Cypher or calls
Guild, so the remote does not execute our traversal. The graph-selected spec is
compiled and genuinely loaded on their engine at runtime, the traversal runs locally,
and the run summary is pushed into that task. Anything more would be theatre.

### Guild — who acts, and where a human signs

**How.** A Guild-compatible control plane behind a port. `@guild-ai/sdk` does not exist
on npm, so we did not fake an import — we built the shapes and the invariants.

**What it buys us.** Four agents with strict schemas. A staged disagreement, because
three agents agreeing proves nothing. Scoped credentials that never enter an agent
context. And a human gate on the one action that carries legal weight.

**The gate is an invariant, not a disabled button.** There is no code path that mints
an approval token without a human click, proved two ways: at runtime, and by a static
audit of our own source asserting every token write sits inside the single mint region.

---

## The six features

| | feature | what it survives |
|---|---|---|
| 1 | **Hop path** — which customer is exposed | two paths to one customer keeps the shortest, so nobody is paged twice |
| 2 | **Proof of absence** — which customers are safe | a timeout is never served as "zero paths"; zero paths is a claim, not a default |
| 3 | **Precedent memory** — have we been burned before | a 3-day-old precedent produces no conflict; a 60-second-old one does |
| 4 | **Obligation clock** — by when | no contract loaded defaults to 72h, the GDPR baseline, so the clock exists early |
| 5 | **Graph-selected pipelines** — the meta layer | widening a match never crosses onto a suppressor |
| 6 | **Human gate** — one action always waits | a forged token does not persist; a held action is not a failed run |

---

## Running it

```bash
npm install
npm run falkor:up     # docker, 6379 + 3000
npm run seed          # 489 nodes, 969 edges
npm run dev           # api 8787 · console 5173 · site 5174
```

| script | what it does |
|---|---|
| `npm run demo` | the three beats, headless |
| `npm run gate` | the full Definition of Done |
| `npm run pull-live` | pull real advisories, rewrite fixtures |
| `npm run replay` | the whole arc from a fixture, **zero network** |
| `npm run stop` | free the pinned ports |

`MOCK=true` is the default: no network, no credentials. `MOCK=false` arms the live
RocketRide bridge and the real advisory pull. Ports are pinned with `--strictPort` so
the console never silently moves; `predev` clears them first.

**Ports:** api `8787` · console `5173` · site `5174` · deck `5175`.

The deck also opens standalone — `open apps/deck/index.html`. One self-contained
file, no server, works offline.

---

## Verification

Every slice wrote its gate before its implementation.

| slice | gate |
|---|---|
| graph | **30/30** on both backends — FalkorDB and in-memory, identical results |
| ingest | **19/19** |
| orchestrate | **56/56** mock · **65/65** against the live service |
| agents | **70/70** |
| meta | **91/91** |
| ui | **89 checks** |
| **integration** | **24/24** |

Three consecutive runs, byte-identical. Suppression costs **7ms and 0 tokens**;
escalation costs **298ms and 903 tokens** — **42× cheaper**, and the agents are never
woken on the cheap path.

Every package depends on `@hopper/contracts` and nothing else; collaborators arrive
through ports. The contracts were frozen and gate-verified *before* any implementation
began. That is what let six agents build in parallel without interface drift.

---

## How a customer adopts it

Nothing valuable is gated behind the hard part.

**1 — Install the GitHub App. 30 seconds.** No SDK, nothing in your runtime. It reads
lockfiles and builds the graph. You get suppression and hop paths immediately.
*This layer alone is the pitch: Dependabot opens 40 PRs a month. Hopper opens 2.*

**2 — Map repos to services.** A short `hopper.yml`, or read it from Backstage or
Kubernetes labels.

**3 — Map customers to contracts.** One row per customer, notice window as a dropdown.
Everyone defaults to 72h so the clock exists before legal finishes the spreadsheet.
We deliberately do not parse contract PDFs on day one.

**4 — Reachability, optional.** An OpenTelemetry exporter. The only piece that touches
your runtime, and what turns "95% vulnerable" into "9.5% reachable".

Output goes where your team already is: pull requests, Slack, PagerDuty, Jira.

---

## Pricing

| tier | price | what |
|---|---|---|
| **Watch** | Free | 1 repo · hop paths · suppression log |
| **Solo** | **$20**/user/mo | 10 repos · auto-PR · paging · precedent memory |
| **Team** | $99/user/mo | unlimited repos · customer + contract graph · clock · audit export |
| **Enterprise** | custom | self-hosted · VEX/SBOM export · regulator audit trail |

Snyk is worth $7.4B for answering *"is it vulnerable."* Nobody answers *"does it cost
me a customer."* That question has a bigger budget, because it is legal exposure
rather than an engineering chore.

---

## What is real, and what is not

**Real.** FalkorDB with 445 packages of genuine deps.dev data. Advisories pulled live
from GitHub and OSV — the newest in our last run was 1h32m old. CISA KEV at 1,657 CVEs.
RocketRide Cloud authenticated, pipeline objects loaded at runtime, real task tokens, a
real payload processed end to end. The hop path, suppression proof, precedent conflict
and pipeline selection are all computed, none hardcoded.

**Local implementations.** Guild has no public SDK, so it is built compatible behind
the port. LaserData's cluster is provisioned and healthy, but the SDK's `connect()`
hangs with no error and no timeout — we added a TCP pre-flight and run the local bus,
and we say so rather than claim otherwise.

**Imperfections we chose not to hide.** The hero chain is six hops, not five: no
published `jest` depends on `glob` directly, so deps.dev routes it through
`@jest/core` and `@jest/reporters`, and we kept the real edges. `brace-expansion` ranks
41 of 445 on honest betweenness, not top five.

---

## Design

An instrument, not a dashboard. The product's job is to make you *less* alarmed,
correctly — so restraint is the whole personality.

```
ground  #0F141C    paper  #E8E4DA    muted  #7A8595
signal  #E8A33D    breach #C7433A    clear  #4A9B8E
```

Colour is state, never decoration. Amber, oxide and teal appear only as in-flight,
breached and cleared. The countdown is the only large type on the page. No emoji.

The signature is the hop path: one ring per 300ms, so you *watch* the shockwave travel
from CVE to contract clause. On suppression it dies at hop two and turns teal.

`SUPPRESSED · zero hops` reads more confident than any alert.

---

*Grace Hopper — naval, precise, found the first bug. And literally what the product
does: it hops the graph.*
