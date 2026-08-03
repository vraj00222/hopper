/**
 * The RocketRide-compatible pipeline runtime.
 *
 * `@rocketride/sdk` is not published (npm 404 as of build day), so this is a
 * real local implementation of the same contract rather than a faked dependency:
 * pipelines are portable JSON `.pipe` specs, executed node-by-node from
 * `spec.entry` along `next[]`/`branches[]`, with per-node tracing of latency and
 * token spend. It sits behind `PipelineRuntimePort`, so a real SDK drops in
 * without touching a caller.
 *
 * If `MOCK=false` and `ROCKETRIDE_URL` is set, `run()` first offers the spec to
 * that server over HTTP and falls back to the local executor on any failure —
 * the demo never depends on a service that may not answer.
 */
import {
  isMock,
  nowIso,
  type Advisory,
  type NodeTrace,
  type PipelineNodeSpec,
  type PipelineRun,
  type PipelineRuntimePort,
  type PipelineSpec,
  type RunContext,
} from '@hopper/contracts';

import { PipelineRunError, PipelineSpecError } from './errors.js';
import { evaluate, isElse, validateExpression } from './expr.js';
import { createRegistry, type OpHandler, type OpRegistry } from './ops/index.js';
import type { RunState } from './ops/types.js';
import { DEFAULT_SPEC, readSpecDir } from './specs/index.js';

const KINDS = new Set([
  'source',
  'cypher',
  'branch',
  'agent',
  'tool',
  'writeback',
  'sink',
]);

function ms(from: number): number {
  return Math.round((performance.now() - from) * 1000) / 1000;
}

function runId(): string {
  return `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// ─── validation ─────────────────────────────────────────────────────────────

function validate(spec: unknown, registry: OpRegistry): PipelineSpec {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new PipelineSpecError('spec must be a JSON object');
  }
  const s = spec as Partial<PipelineSpec>;
  for (const field of ['id', 'name', 'entry'] as const) {
    if (typeof s[field] !== 'string' || (s[field] as string).length === 0) {
      throw new PipelineSpecError(`spec is missing required string field '${field}'`);
    }
  }
  if (!Array.isArray(s.nodes) || s.nodes.length === 0) {
    throw new PipelineSpecError(`spec '${s.id}' has no nodes`);
  }

  const ids = new Set<string>();
  for (const n of s.nodes as PipelineNodeSpec[]) {
    if (n === null || typeof n !== 'object') {
      throw new PipelineSpecError(`spec '${s.id}' contains a non-object node`);
    }
    if (typeof n.id !== 'string' || n.id.length === 0) {
      throw new PipelineSpecError(`spec '${s.id}' contains a node without an id`);
    }
    if (ids.has(n.id)) {
      throw new PipelineSpecError(`duplicate node id '${n.id}'`, n.id);
    }
    ids.add(n.id);
    if (typeof n.kind !== 'string' || !KINDS.has(n.kind)) {
      throw new PipelineSpecError(
        `node '${n.id}' has unknown kind '${String(n.kind)}' (expected one of ${[...KINDS].join(', ')})`,
        n.id,
      );
    }
    if (typeof n.op !== 'string' || !registry.has(n.op)) {
      throw new PipelineSpecError(
        `node '${n.id}' has unknown op '${String(n.op)}' — registered ops: ${[...registry.keys()].sort().join(', ')}`,
        n.id,
      );
    }
    if (n.next !== undefined && !Array.isArray(n.next)) {
      throw new PipelineSpecError(`node '${n.id}': 'next' must be an array of node ids`, n.id);
    }
    if (n.branches !== undefined && !Array.isArray(n.branches)) {
      throw new PipelineSpecError(`node '${n.id}': 'branches' must be an array`, n.id);
    }
    if (n.kind === 'branch' && (!n.branches || n.branches.length === 0)) {
      throw new PipelineSpecError(`branch node '${n.id}' declares no branches`, n.id);
    }
  }

  if (!ids.has(s.entry as string)) {
    throw new PipelineSpecError(
      `entry '${s.entry}' does not resolve to a node (nodes: ${[...ids].join(', ')})`,
    );
  }

  for (const n of s.nodes as PipelineNodeSpec[]) {
    for (const t of n.next ?? []) {
      if (typeof t !== 'string' || !ids.has(t)) {
        throw new PipelineSpecError(
          `node '${n.id}': next target '${String(t)}' does not resolve to a node`,
          n.id,
        );
      }
    }
    for (const b of n.branches ?? []) {
      if (b === null || typeof b !== 'object') {
        throw new PipelineSpecError(`node '${n.id}': malformed branch entry`, n.id);
      }
      validateExpression(b.when, n.id);
      if (typeof b.to !== 'string' || !ids.has(b.to)) {
        throw new PipelineSpecError(
          `node '${n.id}': branch target '${String(b.to)}' does not resolve to a node`,
          n.id,
        );
      }
    }
    const params = n.params;
    if (params !== undefined && (params === null || typeof params !== 'object' || Array.isArray(params))) {
      throw new PipelineSpecError(`node '${n.id}': 'params' must be an object`, n.id);
    }
    // a params-declared jump target must resolve too (branch.suppress uses one)
    const to = (params as Record<string, unknown> | undefined)?.to;
    if (typeof to === 'string' && !ids.has(to)) {
      throw new PipelineSpecError(
        `node '${n.id}': params.to '${to}' does not resolve to a node`,
        n.id,
      );
    }
  }

  if (s.version !== undefined && typeof s.version !== 'string') {
    throw new PipelineSpecError(`spec '${s.id}': 'version' must be a string`);
  }

  return {
    id: s.id as string,
    name: s.name as string,
    version: (s.version as string) ?? '1.0.0',
    description: (s.description as string) ?? '',
    entry: s.entry as string,
    nodes: s.nodes as PipelineNodeSpec[],
    handles: s.handles,
  };
}

// ─── the runtime ────────────────────────────────────────────────────────────

export interface RuntimeOptions {
  mock?: boolean;
  url?: string;
  /** extra op handlers, registered alongside the built-ins */
  ops?: Record<string, OpHandler>;
  /**
   * Also register every spec found in /pipelines. That directory belongs to
   * @hopper/meta — we read it, we never write it. Default true.
   */
  loadPipelineDir?: boolean;
  maxRuns?: number;
}

export function createRuntime(opts: RuntimeOptions = {}): PipelineRuntimePort {
  const registry = createRegistry(opts.ops);
  const mock = opts.mock ?? isMock();
  const url = opts.url ?? process.env.ROCKETRIDE_URL ?? '';
  const maxRuns = opts.maxRuns ?? 200;

  const specs = new Map<string, PipelineSpec>();
  const history: PipelineRun[] = [];
  let remoteDown = false;

  function register(spec: PipelineSpec): void {
    const valid = validate(spec, registry);
    specs.set(valid.id, valid);
  }

  function loadFromJson(json: string): PipelineSpec {
    if (typeof json !== 'string') {
      throw new PipelineSpecError('loadFromJson expects a JSON string');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      throw new PipelineSpecError(`invalid JSON: ${(e as Error).message}`);
    }
    return validate(parsed, registry);
  }

  register(DEFAULT_SPEC);
  if (opts.loadPipelineDir ?? true) {
    for (const { file, json } of readSpecDir()) {
      try {
        register(loadFromJson(json));
      } catch (e) {
        console.warn(`[orchestrate] ignoring ${file}: ${(e as Error).message}`);
      }
    }
  }

  /** R7 — the trace lives in RocketRide's own observability panel when it is up */
  function traceUrl(id: string): string {
    const base = url || 'http://localhost:7788';
    return `${base.replace(/\/$/, '')}/traces/${id}`;
  }

  /**
   * Offer the run to a real RocketRide server. Only ever attempted with
   * MOCK=false and ROCKETRIDE_URL set; any failure falls back to local
   * execution and is never fatal.
   */
  async function tryRemote(
    spec: PipelineSpec,
    advisory: Advisory,
    ctx: RunContext,
  ): Promise<PipelineRun | null> {
    if (mock || !url || remoteDown) return null;
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/v1/pipelines/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spec, input: { advisory, advisory_class: ctx.advisory_class } }),
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const run = (await res.json()) as PipelineRun;
      if (!run || !Array.isArray(run.traces)) throw new Error('malformed run payload');
      ctx.log(`rocketride: remote run ${run.run_id} via ${url}`);
      return run;
    } catch (e) {
      remoteDown = true;
      ctx.log(
        `rocketride: ${url} unavailable (${(e as Error).message}) — executing locally`,
      );
      return null;
    }
  }

  async function run(
    spec: PipelineSpec,
    advisory: Advisory,
    ctx: RunContext,
  ): Promise<PipelineRun> {
    const valid = validate(spec, registry);
    specs.set(valid.id, valid);

    const remote = await tryRemote(valid, advisory, ctx);
    if (remote) {
      history.push(remote);
      return remote;
    }

    const id = runId();
    const startedWall = nowIso();
    const started = performance.now();

    const state: RunState = {
      advisory,
      vars: { pipeline_id: valid.id, ghsa_id: advisory.ghsa_id, mock: ctx.mock },
      hop_paths: [],
      absence: null,
      deployment: null,
      obligation: null,
      precedents: [],
      oncall: [],
      telemetry: [],
      agent: null,
      receipts: [],
      outcome: 'escalated',
      statement: null,
      started_ms: started,
      notes: [],
    };

    const byId = new Map(valid.nodes.map((n) => [n.id, n]));
    const traces: NodeTrace[] = [];
    const executed = new Set<string>();
    let pending: string[] = [valid.entry];
    let ok = true;
    const budget = valid.nodes.length * 4 + 8;
    let steps = 0;

    while (pending.length > 0) {
      steps += 1;
      if (steps > budget) {
        throw new PipelineRunError(
          `pipeline '${valid.id}' exceeded ${budget} steps — cycle in next[]/branches[]`,
        );
      }
      const nodeId = pending.shift() as string;
      if (executed.has(nodeId)) continue;
      const node = byId.get(nodeId);
      if (!node) {
        throw new PipelineRunError(`node '${nodeId}' vanished mid-run in '${valid.id}'`);
      }
      const handler = registry.get(node.op);
      if (!handler) {
        throw new PipelineRunError(`node '${node.id}': op '${node.op}' is not registered`);
      }
      executed.add(nodeId);

      const t0 = performance.now();
      const startedAt = nowIso();
      let result;
      let nodeOk = true;
      try {
        result = await handler(node.params ?? {}, state, ctx);
      } catch (e) {
        nodeOk = false;
        ok = false;
        state.outcome = 'error';
        result = { summary: `error: ${(e as Error).message}`, tokens: 0, ok: false };
        ctx.log(`node ${node.id} failed: ${(e as Error).message}`);
      }

      const trace: NodeTrace = {
        node_id: node.id,
        kind: node.kind,
        op: node.op,
        started_at: startedAt,
        ended_at: nowIso(),
        latency_ms: ms(t0),
        tokens: Math.max(0, Math.round(result.tokens ?? 0)),
        ok: nodeOk && result.ok !== false,
        short_circuit: result.short_circuit === true,
        summary: result.summary || `${node.op} completed`,
        output: result.output,
      };
      traces.push(trace);
      ctx.log(
        `[${valid.id}] ${node.id} (${node.op}) ${trace.latency_ms.toFixed(1)}ms ` +
          `${trace.tokens} tok${trace.short_circuit ? ' SHORT-CIRCUIT' : ''} — ${trace.summary}`,
      );

      if (!nodeOk) break;

      // where next
      if (typeof result.goto === 'string' && result.goto.length > 0) {
        if (!byId.has(result.goto)) {
          throw new PipelineRunError(
            `node '${node.id}' jumped to '${result.goto}', which is not in '${valid.id}'`,
          );
        }
        // a short circuit skips everything queued — that is the point of it
        pending = [result.goto];
        continue;
      }

      if (node.kind === 'branch' && node.branches && node.branches.length > 0) {
        const hit =
          node.branches.find((b) => !isElse(b.when) && evaluate(b.when, state.vars)) ??
          node.branches.find((b) => isElse(b.when));
        if (!hit) {
          throw new PipelineRunError(
            `branch '${node.id}' matched no condition and declares no else`,
          );
        }
        pending = [hit.to, ...pending];
        continue;
      }

      if (node.next && node.next.length > 0) {
        pending = [...node.next, ...pending];
      }
    }

    const latency = ms(started);
    const receiptCount = state.receipts.length;
    const run: PipelineRun = {
      run_id: id,
      pipeline_id: valid.id,
      ghsa_id: advisory.ghsa_id,
      advisory_class: ctx.advisory_class?.id ?? 'unknown',
      started_at: startedWall,
      ended_at: nowIso(),
      latency_ms: latency,
      ok: ok && state.outcome !== 'error',
      outcome: state.outcome,
      traces,
      hop_paths: state.hop_paths,
      agent_result: state.agent ?? undefined,
      receipts: state.receipts,
      selection_reason: ctx.selection_reason,
    };

    ctx.log(
      `run ${id} ${run.outcome} in ${latency.toFixed(1)}ms · ${traces.length} nodes · ` +
        `${traces.reduce((a, t) => a + t.tokens, 0)} tokens · ${receiptCount} receipts`,
    );

    history.push(run);
    if (history.length > maxRuns) history.splice(0, history.length - maxRuns);
    return run;
  }

  return {
    register,
    registered: () => [...specs.values()],
    loadFromJson,
    run,
    runs: () => [...history],
    traceUrl,
  };
}
