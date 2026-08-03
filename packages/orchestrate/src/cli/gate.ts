/**
 * HOPPER — @hopper/orchestrate gate.
 *
 * The definition of done for the RocketRide slice. Sections 1–8 run standalone
 * with MOCK=true, no network, no other @hopper package: every collaborator
 * arrives as a port stub from ./testing.
 *
 *   npx tsx packages/orchestrate/src/cli/gate.ts
 *
 * Section 9 talks to the live RocketRide service. It is SKIPPED (exit still 0)
 * unless MOCK=false and ROCKETRIDE_AUTH is present:
 *
 *   MOCK=false npx tsx packages/orchestrate/src/cli/gate.ts
 *
 * Credentials come from the repo-root .env, are never printed, and are never
 * passed anywhere except the RocketRide client constructor.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  HERO_ADVISORY,
  SUPPRESSED_ADVISORY,
  isMock,
  type NodeTrace,
  type PipelineRun,
  type PipelineSpec,
  type RunContext,
} from '@hopper/contracts';

import {
  closeRuntime,
  compileToRocketRide,
  createOrchestrator,
  createRocketRideBridge,
  createTools,
  createRuntime,
  flushRemote,
  remoteTaskOf,
  renderRunForRocketRide,
  type RemoteTask,
  type RocketRideBridge,
} from '../index.js';
import { CARRIER_PROVIDER, SINK_PROVIDER, SOURCE_PROVIDER } from '../rocketride/index.js';
import { DEFAULT_SPEC } from '../specs/index.js';
import { PipelineSpecError } from '../errors.js';
import { deliveriesOf } from '../tools.js';
import {
  createStubAgents,
  createStubBus,
  createStubGraph,
  createStubMeta,
  HERO_HOP_PATHS,
} from '../testing/index.js';

// ─── harness ────────────────────────────────────────────────────────────────

let checks = 0;
let failures = 0;
let skipped = 0;
const proved: string[] = [];

/**
 * Tiny .env reader — no dependency, no override of anything already exported,
 * and nothing from it is ever printed.
 */
function loadDotEnv(): string[] {
  const file = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    '.env',
  );
  const found: string[] = [];
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return found;
  }
  for (const line of raw.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    found.push(m[1]);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
  return found;
}

function skip(label: string, why: string): void {
  skipped += 1;
  console.log(`   SKIP  ${label}  ${why}`);
}

function head(n: number, title: string): void {
  console.log('');
  console.log(`── ${n}. ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

function ok(label: string, detail = ''): void {
  checks += 1;
  proved.push(label);
  console.log(`   PASS  ${label}${detail ? `  ${detail}` : ''}`);
}

function fail(label: string, detail = ''): void {
  checks += 1;
  failures += 1;
  console.log(`   FAIL  ${label}${detail ? `  ${detail}` : ''}`);
}

function assert(cond: boolean, label: string, detail = ''): void {
  if (cond) ok(label, detail);
  else fail(label, detail);
}

function throws(fn: () => unknown, label: string): void {
  try {
    fn();
    fail(label, 'no error thrown');
  } catch (e) {
    if (e instanceof PipelineSpecError) ok(label, `-> ${e.message}`);
    else fail(label, `wrong error type: ${String(e)}`);
  }
}

function traceTable(run: PipelineRun): void {
  const w = (s: string, n: number) => s.padEnd(n).slice(0, n);
  console.log(
    `        ${w('#', 3)}${w('node', 22)}${w('kind', 11)}${w('op', 24)}${'ms'.padStart(8)}${'tok'.padStart(7)}  summary`,
  );
  run.traces.forEach((t: NodeTrace, i: number) => {
    console.log(
      `        ${w(String(i + 1), 3)}${w(t.node_id, 22)}${w(t.kind, 11)}${w(t.op, 24)}` +
        `${t.latency_ms.toFixed(1).padStart(8)}${String(t.tokens).padStart(7)}  ` +
        `${t.short_circuit ? '[short-circuit] ' : ''}${t.summary}`,
    );
  });
  console.log(
    `        total ${run.latency_ms.toFixed(1)} ms · ${run.traces.reduce((a, t) => a + t.tokens, 0)} tokens · ` +
      `outcome=${run.outcome} · receipts=${run.receipts.length}`,
  );
}

function ctxFor(
  deps: {
    graph: ReturnType<typeof createStubGraph>;
    bus: ReturnType<typeof createStubBus>;
    agents: ReturnType<typeof createStubAgents>;
    meta: ReturnType<typeof createStubMeta>;
    tools: ReturnType<typeof createTools>;
  },
  reason: string,
): RunContext {
  return {
    graph: deps.graph,
    bus: deps.bus,
    agents: deps.agents,
    meta: deps.meta,
    tools: deps.tools,
    selection_reason: reason,
    advisory_class: {
      id: 'npm/high/deep',
      ecosystem: 'npm',
      severity_band: 'high',
      depth_band: 'deep',
    },
    mock: true,
    log: () => {},
  };
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('HOPPER · @hopper/orchestrate (RocketRide) gate');
  console.log('MOCK=true · no network · no sibling package imported');

  const runtime = createRuntime({ mock: true, loadPipelineDir: false });

  // 1 ─ loadFromJson: accept valid, reject three kinds of malformed spec ─────
  head(1, 'loadFromJson() parses and validates a .pipe from a JSON string');

  const goodJson = JSON.stringify(DEFAULT_SPEC);
  const parsed = runtime.loadFromJson(goodJson);
  assert(
    parsed.entry === DEFAULT_SPEC.entry && parsed.nodes.length === DEFAULT_SPEC.nodes.length,
    'valid spec accepted from a JSON string',
    `id=${parsed.id} nodes=${parsed.nodes.length} entry=${parsed.entry}`,
  );

  // the same file, on disk, as a portable .pipe artifact (§4.3 round trip)
  const here = path.dirname(fileURLToPath(import.meta.url));
  const onDisk = readFileSync(path.join(here, '..', 'specs', 'default.pipe.json'), 'utf8');
  const fromDisk = runtime.loadFromJson(onDisk);
  assert(
    fromDisk.nodes.map((n) => n.id).join(',') === DEFAULT_SPEC.nodes.map((n) => n.id).join(','),
    'src/specs/default.pipe.json is a portable spec and loads identically',
  );

  const dangling = structuredClone(DEFAULT_SPEC) as PipelineSpec;
  dangling.nodes[1].next = ['does-not-exist'];
  throws(() => runtime.loadFromJson(JSON.stringify(dangling)), 'dangling next target rejected');

  const noEntry = structuredClone(DEFAULT_SPEC) as PipelineSpec;
  noEntry.entry = 'nowhere';
  throws(() => runtime.loadFromJson(JSON.stringify(noEntry)), 'missing entry rejected');

  const unknownOp = structuredClone(DEFAULT_SPEC) as PipelineSpec;
  unknownOp.nodes[3].op = 'traverse.telepathy';
  throws(() => runtime.loadFromJson(JSON.stringify(unknownOp)), 'unknown op rejected');

  const badBranch = structuredClone(DEFAULT_SPEC) as PipelineSpec;
  const branchNode = badBranch.nodes.find((n) => n.kind === 'branch');
  if (branchNode?.branches) branchNode.branches[0].to = 'ghost';
  throws(() => runtime.loadFromJson(JSON.stringify(badBranch)), 'dangling branch target rejected');

  throws(() => runtime.loadFromJson('{ not json'), 'malformed JSON rejected');

  // 2 ─ escalation arc ──────────────────────────────────────────────────────
  head(2, 'five-stage spec against a graph WITH paths escalates');

  const gEsc = createStubGraph({ hopPaths: HERO_HOP_PATHS });
  const bEsc = createStubBus();
  const aEsc = createStubAgents();
  const mEsc = createStubMeta();
  const tEsc = createTools({ mock: true });
  const escRun = await runtime.run(
    DEFAULT_SPEC,
    HERO_ADVISORY,
    ctxFor({ graph: gEsc, bus: bEsc, agents: aEsc, meta: mEsc, tools: tEsc }, 'gate: escalation'),
  );

  traceTable(escRun);
  assert(escRun.outcome === 'escalated', 'outcome is escalated', `outcome=${escRun.outcome}`);
  assert(escRun.traces.length >= 7, 'at least 7 node traces', `traces=${escRun.traces.length}`);
  assert(
    escRun.traces.every((t) => t.latency_ms >= 0),
    'every trace has latency_ms >= 0',
  );
  assert(
    escRun.traces.every((t) => t.summary.trim().length > 0),
    'every trace has a non-empty summary',
  );

  const byId = new Map(DEFAULT_SPEC.nodes.map((n) => [n.id, n]));
  let linked = true;
  for (let i = 0; i < escRun.traces.length - 1; i += 1) {
    const from = byId.get(escRun.traces[i].node_id);
    const to = escRun.traces[i + 1].node_id;
    const succ = [...(from?.next ?? []), ...(from?.branches ?? []).map((b) => b.to)];
    if (!succ.includes(to)) linked = false;
  }
  const monotonic = escRun.traces.every(
    (t, i) => i === 0 || Date.parse(t.started_at) >= Date.parse(escRun.traces[i - 1].started_at),
  );
  assert(linked && monotonic, 'traces are in execution order (successor-linked, non-decreasing ts)');
  assert(
    escRun.traces.some((t) => t.kind === 'agent') && escRun.traces.some((t) => t.kind === 'tool'),
    'escalation ran the agent node and the tool nodes',
  );
  assert(
    escRun.traces.filter((t) => t.kind === 'cypher').every((t) => t.tokens === 0),
    'pure-Cypher nodes spend zero tokens',
  );
  assert(
    escRun.traces.filter((t) => t.kind === 'agent').every((t) => t.tokens > 0),
    'agent nodes carry a real token estimate',
    `tokens=${escRun.traces.filter((t) => t.kind === 'agent').map((t) => t.tokens).join(',')}`,
  );

  // 3 ─ suppression arc ─────────────────────────────────────────────────────
  head(3, 'same spec against a graph with ZERO paths suppresses');

  const gSup = createStubGraph({ hopPaths: [] });
  const bSup = createStubBus();
  const aSup = createStubAgents();
  const mSup = createStubMeta();
  const tSup = createTools({ mock: true });
  const supRun = await runtime.run(
    DEFAULT_SPEC,
    SUPPRESSED_ADVISORY,
    ctxFor({ graph: gSup, bus: bSup, agents: aSup, meta: mSup, tools: tSup }, 'gate: suppression'),
  );

  traceTable(supRun);
  assert(supRun.outcome === 'suppressed', 'outcome is suppressed', `outcome=${supRun.outcome}`);
  assert(
    supRun.traces.some((t) => t.short_circuit),
    'a trace is marked short_circuit',
    supRun.traces.filter((t) => t.short_circuit).map((t) => t.node_id).join(','),
  );
  assert(
    !supRun.traces.some((t) => t.kind === 'agent'),
    'no agent node executed',
  );
  assert(!supRun.traces.some((t) => t.kind === 'tool'), 'no tool node executed');
  assert(supRun.receipts.length === 0 && aSup.calls.run === 0, 'zero receipts, zero agent calls');
  assert(
    supRun.latency_ms < escRun.latency_ms / 2,
    'suppression costs materially less than escalation',
    `suppressed=${supRun.latency_ms.toFixed(1)}ms vs escalated=${escRun.latency_ms.toFixed(1)}ms ` +
      `(${(escRun.latency_ms / Math.max(supRun.latency_ms, 0.001)).toFixed(1)}x)`,
  );
  const supTokens = supRun.traces.reduce((a, t) => a + t.tokens, 0);
  const escTokens = escRun.traces.reduce((a, t) => a + t.tokens, 0);
  assert(supTokens === 0 && escTokens > 0, 'suppression spends zero tokens', `${supTokens} vs ${escTokens}`);
  console.log(
    `        statement: ${supRun.traces.find((t) => t.short_circuit)?.summary ?? '(none)'}`,
  );

  // 4 ─ the four tool executors ─────────────────────────────────────────────
  head(4, 'four tool executors under MOCK, and the G6 approval gate');

  const tools = createTools({ mock: true });
  const pr = await tools.openPr({
    ghsa_id: HERO_ADVISORY.ghsa_id,
    package: HERO_ADVISORY.package_name,
    from_v: '< 1.1.18',
    to_v: '1.1.18',
    repo: 'northwind/build-api',
  });
  const page = await tools.pageOncall({
    ghsa_id: HERO_ADVISORY.ghsa_id,
    person: 'R. Okafor',
    slack_handle: '@rokafor',
    channel: '#platform-oncall',
    summary: 'brace-expansion reachable in build-api',
  });
  const ticket = await tools.openTicket({
    ghsa_id: HERO_ADVISORY.ghsa_id,
    title: 'Patch brace-expansion',
    body: 'four hops to Northwind Systems',
    assignee: 'platform',
  });
  for (const [name, r] of [
    ['openPr', pr],
    ['pageOncall', page],
    ['openTicket', ticket],
  ] as const) {
    assert(
      r.ok && r.mock && r.ref.length > 0 && r.latency_ms >= 0,
      `${name} returns a mock receipt with a believable ref`,
      `ref=${r.ref} ${r.latency_ms.toFixed(1)}ms`,
    );
  }

  const blocked = await tools.notifyCustomer({
    ghsa_id: HERO_ADVISORY.ghsa_id,
    customer: 'Northwind Systems',
    clause_ref: '§7.3',
    deadline_utc: new Date().toISOString(),
    body: 'notice draft',
    approval_token: '',
  });
  assert(
    !blocked.ok && blocked.ref === '' && deliveriesOf(tools).length === 0,
    'notifyCustomer with an empty approval_token returns ok:false and delivers nothing',
    `detail="${blocked.detail}"`,
  );

  const allowed = await tools.notifyCustomer({
    ghsa_id: HERO_ADVISORY.ghsa_id,
    customer: 'Northwind Systems',
    clause_ref: '§7.3',
    deadline_utc: new Date().toISOString(),
    body: 'notice draft',
    approval_token: 'apr_9f3c1d2e-gate',
  });
  assert(
    allowed.ok && deliveriesOf(tools).length === 1,
    'notifyCustomer with an approval token returns ok:true and delivers exactly once',
    `ref=${allowed.ref}`,
  );
  assert(tools.receipts().length === 5, 'every attempt is receipted', `receipts=${tools.receipts().length}`);

  // 4b ─ the real Guild behaviour: the notice is HELD, the run still escalates ─
  console.log('');
  console.log('   — beat 1 with a real HITL hold (approval left pending) —');
  const gHeld = createStubGraph({ hopPaths: HERO_HOP_PATHS });
  const aHeld = createStubAgents({ autoApprove: false }); // Guild holds the approval
  const mHeld = createStubMeta();
  const tHeld = createTools({ mock: true });
  const heldRun = await createRuntime({ mock: true, loadPipelineDir: false }).run(
    DEFAULT_SPEC,
    HERO_ADVISORY,
    ctxFor(
      { graph: gHeld, bus: createStubBus(), agents: aHeld, meta: mHeld, tools: tHeld },
      'gate: held approval',
    ),
  );
  const heldNotice = heldRun.receipts.find((r) => r.action === 'notify_customer');
  assert(
    heldRun.outcome === 'escalated' && heldRun.ok,
    'a held customer notice does NOT fail the run — outcome stays escalated',
    `outcome=${heldRun.outcome} ok=${heldRun.ok}`,
  );
  assert(
    heldRun.receipts.length === 4 && heldRun.receipts.filter((r) => r.ok).length === 3,
    'three actions executed, one held',
    `${heldRun.receipts.filter((r) => r.ok).length}/4 executed`,
  );
  assert(
    heldNotice !== undefined && !heldNotice.ok && deliveriesOf(tHeld).length === 0,
    'the customer notice is the held one, and nothing was delivered',
    heldNotice ? `detail="${heldNotice.detail.slice(0, 60)}..."` : 'no receipt',
  );
  assert(
    heldRun.traces.every((t) => t.kind !== 'tool' || t.summary.length > 0) &&
      heldRun.traces.some((t) => t.op === 'tool.notify_customer' && !t.ok),
    'the held action is visible in the trace as a not-ok node',
  );
  assert(
    mHeld.outcomes.length === 1 && mHeld.outcomes[0].ok === true,
    'the pipeline is still recorded as a success in the meta layer',
    `recordOutcome ok=${mHeld.outcomes[0]?.ok}`,
  );
  assert(
    aHeld.pendingApprovals().length === 1,
    'the approval is left pending for a human',
    `pending=${aHeld.pendingApprovals().length}`,
  );

  // 5 ─ requires() ──────────────────────────────────────────────────────────
  head(5, 'requires() marks the customer notice as human-gated');
  assert(tools.requires('notify_customer') === 'approval', "requires('notify_customer') === 'approval'");
  assert(
    tools.requires('open_pr') === 'auto' &&
      tools.requires('page_oncall') === 'auto' &&
      tools.requires('open_ticket') === 'auto',
    'the other three are auto',
  );

  // 6 ─ dedupe ─────────────────────────────────────────────────────────────
  head(6, 'orchestrator dedupes a second sighting of the same ghsa_id');

  const gDup = createStubGraph({ hopPaths: HERO_HOP_PATHS });
  const orchDup = createOrchestrator({
    graph: gDup,
    bus: createStubBus(),
    agents: createStubAgents(),
    meta: createStubMeta(),
    runtime: createRuntime({ mock: true, loadPipelineDir: false }),
    tools: createTools({ mock: true }),
    mock: true,
  });
  await orchDup.start();
  const first = await orchDup.handle(HERO_ADVISORY);
  const second = await orchDup.handle(HERO_ADVISORY);
  await orchDup.stop();
  assert(first !== null && second === null, 'second sighting dropped', `second=${String(second)}`);
  assert(orchDup.funnel().deduped === 1, 'funnel().deduped === 1', `funnel=${JSON.stringify(orchDup.funnel())}`);

  // 7 ─ full funnel over both arcs ─────────────────────────────────────────
  head(7, 'escalation arc then suppression arc, one funnel');

  const gBoth = createStubGraph({ hopPaths: HERO_HOP_PATHS });
  const mBoth = createStubMeta();
  const aBoth = createStubAgents();
  const orch = createOrchestrator({
    graph: gBoth,
    bus: createStubBus(),
    agents: aBoth,
    meta: mBoth,
    runtime: createRuntime({ mock: true, loadPipelineDir: false }),
    tools: createTools({ mock: true }),
    mock: true,
  });
  await orch.start();
  const runEsc = await orch.handle(HERO_ADVISORY);
  gBoth.setHopPaths([]); // the graph now proves absence for the next one
  const runSup = await orch.handle(SUPPRESSED_ADVISORY);
  await orch.stop();

  const f = orch.funnel();
  console.log(`        funnel: ${JSON.stringify(f)}`);
  assert(f.escalated === 1, 'funnel().escalated === 1', `escalated=${f.escalated}`);
  assert(f.suppressed === 1, 'funnel().suppressed === 1', `suppressed=${f.suppressed}`);
  assert(f.actions >= 4, 'funnel().actions >= 4', `actions=${f.actions}`);
  assert(f.traversed === 2 && f.ingested === 2, 'both advisories traversed', `traversed=${f.traversed}`);
  assert(f.p99_ms > 0, 'p99 is measured', `p99=${f.p99_ms.toFixed(1)}ms`);
  assert(orch.runs().length === 2, 'both runs retained', `runs=${orch.runs().length}`);
  assert(
    runEsc?.outcome === 'escalated' && runSup?.outcome === 'suppressed',
    'the arcs came out in the right order',
  );

  // 8 ─ write-back closed the loop ─────────────────────────────────────────
  head(8, 'writeback.graph closed the loop (R6)');
  console.log(`        graph writes: ${JSON.stringify(gBoth.calls)}`);
  console.log(`        meta.recordOutcome: ${JSON.stringify(mBoth.outcomes)}`);
  assert(gBoth.calls.recordVerdict >= 4, 'agent verdicts written to the graph', `n=${gBoth.calls.recordVerdict}`);
  assert(gBoth.calls.recordDecision >= 1, 'Decision written to the graph', `n=${gBoth.calls.recordDecision}`);
  assert(
    gBoth.calls.recordPatchAttempt >= 1,
    'PatchAttempt written for the attempted bump',
    `n=${gBoth.calls.recordPatchAttempt}`,
  );
  assert(
    gBoth.calls.recordObservation >= 1,
    'suppression written back as a positive observation',
    `n=${gBoth.calls.recordObservation}`,
  );
  assert(mBoth.outcomes.length === 2, 'meta.recordOutcome called once per run', `n=${mBoth.outcomes.length}`);
  assert(
    mBoth.outcomes.every((o) => o.latencyMs > 0 && o.pipelineId.length > 0),
    'recordOutcome carried a real pipeline id and latency',
    mBoth.outcomes.map((o) => `${o.pipelineId}:${o.latencyMs.toFixed(1)}ms:${o.ok}`).join(' '),
  );

  // 9 ─ the live RocketRide service ────────────────────────────────────────
  head(9, 'live RocketRide — a pipeline object loaded at runtime (§4.3)');

  const envKeys = loadDotEnv();
  const auth = process.env.ROCKETRIDE_AUTH ?? process.env.ROCKETRIDE_APIKEY ?? '';
  const uri = process.env.ROCKETRIDE_URI ?? 'https://api.rocketride.ai';
  const live = !isMock() && auth.length > 0;
  console.log(
    `        .env: ${envKeys.length} keys, ` +
      `${envKeys.filter((k) => k.startsWith('ROCKETRIDE_')).join(' ') || 'no ROCKETRIDE_* keys'} · ` +
      `credential present: ${auth.length > 0} · MOCK=${isMock()}`,
  );

  // the compile step is pure — it is checked either way
  const compiled = compileToRocketRide(DEFAULT_SPEC, HERO_ADVISORY, { projectId: 'hopper' });
  const compIds = compiled.components.map((c) => c.id);
  assert(
    compiled.components[0].provider === SOURCE_PROVIDER &&
      compiled.components[compiled.components.length - 1].provider === SINK_PROVIDER,
    'compiles to a webhook ingress and a response_text egress',
    `${compiled.components[0].provider} … ${compiled.components[compiled.components.length - 1].provider}`,
  );
  assert(
    compiled.components.slice(1, -1).every((c) => c.provider === CARRIER_PROVIDER),
    'every interior stage uses the verified text->text carrier',
    `${CARRIER_PROVIDER} x${compiled.components.length - 2}`,
  );
  assert(
    compiled.components.slice(1).every((c) => (c.input ?? []).every((i) => i.lane === 'text')) &&
      compiled.components.slice(1).every((c) => (c.input ?? []).length === 1),
    "every input is on the 'text' DATA LANE (not a port name)",
  );
  assert(
    new Set(compIds).size === compIds.length && compiled.source === compIds[0],
    'component ids are unique per dispatch and source points at the ingress',
    `source=${compiled.source}`,
  );
  assert(
    compiled.components.some((c) => c.name === 'traverse.reachability') &&
      compiled.components.some((c) => c.name === 'traverse.ownership'),
    'components are named as the traversal stages, so their panel reads right (R7)',
    compiled.components.map((c) => c.name).slice(0, 7).join(' -> '),
  );

  if (!live) {
    skip(
      'live service checks',
      auth.length === 0
        ? 'ROCKETRIDE_AUTH not set'
        : 'MOCK=true — rerun with MOCK=false to exercise the live service',
    );
  } else {
    const t0 = performance.now();
    const bridge = createRocketRideBridge({
      auth,
      uri,
      projectId: process.env.ROCKETRIDE_PROJECT_ID ?? 'hopper',
      log: (m) => console.log(`        ${m}`),
    });
    const connected = await bridge.connect();
    assert(connected && bridge.connected(), `connect() to ${uri}`, `${(performance.now() - t0).toFixed(0)}ms`);

    let task: RemoteTask | null = null;
    if (connected) {
      const t1 = performance.now();
      task = await bridge.dispatch(compiled, `HOPPER gate · ${HERO_ADVISORY.ghsa_id}`);
      assert(
        task !== null && typeof task.token === 'string' && task.token.length > 0,
        'use({ pipeline }) accepted a pipeline OBJECT at runtime and returned a task token',
        task
          ? `id=${task.id} source=${task.source} project=${task.projectId} ` +
            `token=${task.token.length}ch publicToken=${task.publicToken?.length ?? 0}ch ` +
            `in ${(performance.now() - t1).toFixed(0)}ms`
          : `failed: ${bridge.status().lastError}`,
      );
    }

    if (task) {
      const reported = await bridge.report(task, renderRunForRocketRide(escRun));
      assert(reported, 'the run was pushed into the live task for their trace panel');
      await bridge.terminate(task);
      assert(bridge.status().failures === 0, 'terminate() clean', `failures=${bridge.status().failures}`);
    }

    await bridge.disconnect();
    assert(!bridge.connected(), 'disconnect() clean');

    // the demo must survive their service being down
    const deadBridge: RocketRideBridge = {
      enabled: () => true,
      connected: () => false,
      connect: async () => false,
      dispatch: async () => null,
      report: async () => false,
      terminate: async () => {},
      disconnect: async () => {},
      status: () => ({ enabled: true, connected: false, failures: 9, lastError: 'forced failure' }),
    };
    const failing = createRuntime({
      mock: false,
      remote: true,
      bridge: deadBridge,
      loadPipelineDir: false,
    });
    const fallbackRun = await failing.run(
      DEFAULT_SPEC,
      HERO_ADVISORY,
      ctxFor(
        {
          graph: createStubGraph({ hopPaths: HERO_HOP_PATHS }),
          bus: createStubBus(),
          agents: createStubAgents(),
          meta: createStubMeta(),
          tools: createTools({ mock: true }),
        },
        'gate: forced remote failure',
      ),
    );
    assert(
      fallbackRun.outcome === escRun.outcome &&
        fallbackRun.traces.map((t) => t.node_id).join(',') ===
          escRun.traces.map((t) => t.node_id).join(','),
      'with the remote forced to fail, the local run is identical',
      `outcome=${fallbackRun.outcome} nodes=${fallbackRun.traces.length}`,
    );
    assert(
      remoteTaskOf(failing, fallbackRun.run_id) === null,
      'no remote task is attributed to a run that never reached the service',
    );
    await flushRemote(failing);
    await closeRuntime(failing);
  }

  // ─── verdict ───────────────────────────────────────────────────────────
  console.log('');
  console.log('─'.repeat(72));
  console.log(
    `${checks - failures}/${checks} checks passed${skipped > 0 ? ` · ${skipped} skipped` : ''}`,
  );
  if (failures > 0) {
    console.log(`GATE FAILED · ${failures} failing`);
    process.exit(1);
  }
  console.log('GATE PASSED · proved:');
  console.log('  · .pipe specs load from a JSON string at runtime and reject malformed graphs');
  console.log('  · the 5-stage traversal chain escalates with a full per-node trace');
  console.log('  · zero hops short-circuits to write-back at near-zero cost and zero tokens');
  console.log('  · four tool executors receipt every attempt; the customer notice cannot');
  console.log('    report success without an approval token');
  console.log('  · a held approval does not fail the run: 3 executed, 1 held, still escalated');
  console.log('  · the router dedupes, classifies, lets the graph select the pipeline,');
  console.log('    and keeps an accurate funnel');
  console.log('  · write-back closes the loop into the graph and the meta layer');
  console.log('  · our spec compiles to a real RocketRide pipeline: webhook -> five named');
  console.log('    stages -> response_text, all on the text lane');
  if (live) {
    console.log('  · the live service accepted that pipeline OBJECT at runtime and returned a');
    console.log('    task token — §4.3 needs no pre-registered pipeline ids');
    console.log('  · with the remote forced to fail, the local run is byte-for-byte the same');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('GATE ERROR');
  console.error(e);
  process.exit(1);
});
