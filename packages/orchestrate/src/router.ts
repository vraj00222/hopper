/**
 * R1 — the event router that owns the whole loop.
 *
 *   advisories topic
 *      → dedupe by ghsa_id
 *      → one cheap pre-traversal (hop depth) so the classifier has real numbers
 *      → meta.classify()
 *      → meta.select(class)      ← §4.3: THE GRAPH SELECTS THE PIPELINE
 *      → runtime.run(spec)
 *      → DecisionEvent on the decisions topic
 *      → funnel
 *
 * The pre-traversal result is handed to the run through a per-run caching view
 * of GraphPort, so `traverse.reachability` reuses it instead of asking the graph
 * the same question twice.
 */
import {
  depthBand,
  nowIso,
  percentile,
  type ActionKind,
  type Advisory,
  type AdvisoryClass,
  type AdvisoryEvent,
  type AgentBusEvent,
  type AgentsPort,
  type ChokePoint,
  type DecisionEvent,
  type EventBusPort,
  type EventEnvelope,
  type FunnelStats,
  type GraphPort,
  type HopPath,
  type MetaPort,
  type OrchestratorPort,
  type PipelineRun,
  type PipelineRuntimePort,
  type RunContext,
  type ToolsPort,
  type Unsubscribe,
} from '@hopper/contracts';

export interface OrchestratorDeps {
  graph: GraphPort;
  bus: EventBusPort;
  agents: AgentsPort;
  meta: MetaPort;
  runtime: PipelineRuntimePort;
  tools: ToolsPort;
  mock?: boolean;
  /** stop keeping runs after this many (the UI only ever shows the recent ones) */
  maxRuns?: number;
  /** default false — the demo narrates through the bus and the server's logger */
  verbose?: boolean;
}

/**
 * A read-through view of the graph that answers the two questions the router
 * already asked, then delegates everything else untouched.
 */
function withRunCache(
  graph: GraphPort,
  ghsaId: string,
  paths: HopPath[] | null,
  chokepoints: ChokePoint[],
): GraphPort {
  return new Proxy(graph, {
    get(target, prop, receiver) {
      if (prop === 'hopPaths') {
        // `null` means the pre-traversal failed. Never serve that as an empty
        // result: an empty result is a suppression claim, and a suppression
        // claim has to come from the graph, not from a timeout.
        return async (id: string, maxDepth?: number) =>
          paths !== null && id === ghsaId ? paths : target.hopPaths(id, maxDepth);
      }
      if (prop === 'chokePoints') {
        return async (limit?: number) =>
          chokepoints.length > 0 ? chokepoints : target.chokePoints(limit);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as GraphPort;
}

export function createOrchestrator(deps: OrchestratorDeps): OrchestratorPort {
  const { graph, bus, agents, meta, runtime, tools } = deps;
  const mock = deps.mock ?? true;
  const maxRuns = deps.maxRuns ?? 200;

  const seen = new Map<string, number>();
  const history: PipelineRun[] = [];
  const latencies: number[] = [];
  let unsubscribe: Unsubscribe | null = null;
  let running = false;
  let chokepointCache: ChokePoint[] = [];

  const funnel: FunnelStats = {
    ingested: 0,
    deduped: 0,
    traversed: 0,
    suppressed: 0,
    escalated: 0,
    actions: 0,
    p99_ms: 0,
    window_started_at: nowIso(),
  };

  function log(msg: string): void {
    if (deps.verbose) console.log(`[orchestrate] ${msg}`);
  }

  /** progress the UI can narrate; the arbiter is the coordinator's voice */
  async function narrate(
    ghsaId: string,
    phase: AgentBusEvent['phase'],
    message: string,
    payload?: unknown,
  ): Promise<void> {
    const e: AgentBusEvent = {
      kind: 'agent-bus',
      agent: 'arbiter',
      ghsa_id: ghsaId,
      phase,
      message,
      payload,
    };
    try {
      await bus.publish('agent-bus', e);
    } catch {
      // the bus being down must never stop a traversal
    }
    log(`${ghsaId} ${phase} · ${message}`);
  }

  async function publishDecision(run: PipelineRun): Promise<void> {
    const executed = run.receipts.filter((r) => r.ok);
    const held = run.receipts.filter((r) => !r.ok);
    const approvals = run.agent_result?.approvals ?? [];

    const events: DecisionEvent[] = executed.map((r) => ({
      kind: 'decision',
      ghsa_id: run.ghsa_id,
      action: r.action,
      auto: tools.requires(r.action) === 'auto',
      requires_approval: tools.requires(r.action) === 'approval',
      approval_id: approvals.find((a) => a.action === r.action)?.id,
      approved_by: approvals.find((a) => a.action === r.action)?.approved_by ?? null,
      status: 'executed',
      receipt: r,
      ts: nowIso(),
    }));

    for (const r of held) {
      events.push({
        kind: 'decision',
        ghsa_id: run.ghsa_id,
        action: r.action,
        auto: false,
        requires_approval: true,
        approval_id: approvals.find((a) => a.action === r.action)?.id,
        approved_by: null,
        status: 'pending_approval',
        receipt: r,
        ts: nowIso(),
      });
    }

    if (events.length === 0) {
      // a suppression is still a decision: we declined to act, and why
      const proposed = (run.agent_result?.arbiter.actions[0] ?? 'open_ticket') as ActionKind;
      events.push({
        kind: 'decision',
        ghsa_id: run.ghsa_id,
        action: proposed,
        auto: true,
        requires_approval: false,
        approved_by: null,
        status: run.outcome === 'suppressed' ? 'rejected' : 'proposed',
        ts: nowIso(),
      });
    }

    for (const e of events) {
      try {
        await bus.publish('decisions', e);
      } catch {
        // never fatal
      }
    }
  }

  async function classOf(
    advisory: Advisory,
    paths: HopPath[] | null,
  ): Promise<{ cls: AdvisoryClass; isChokepoint: boolean }> {
    if (chokepointCache.length === 0) {
      try {
        chokepointCache = await graph.chokePoints(100);
      } catch {
        chokepointCache = [];
      }
    }
    const isChokepoint = chokepointCache.some(
      (c) => c.package === advisory.package_name && c.is_chokepoint,
    );
    const known = paths ?? [];
    const maxHops = known.length ? Math.max(...known.map((p) => p.hops)) : 0;
    const cls = meta.classify({
      advisory,
      maxHops,
      pathCount: known.length,
      isChokepoint,
    });
    return { cls, isChokepoint };
  }

  async function handle(advisory: Advisory): Promise<PipelineRun | null> {
    if (!advisory || typeof advisory.ghsa_id !== 'string' || advisory.ghsa_id.length === 0) {
      return null;
    }
    funnel.ingested += 1;

    const priorSightings = seen.get(advisory.ghsa_id) ?? 0;
    if (priorSightings > 0) {
      seen.set(advisory.ghsa_id, priorSightings + 1);
      funnel.deduped += 1;
      await narrate(
        advisory.ghsa_id,
        'resolved',
        `duplicate advisory dropped (sighting ${priorSightings + 1})`,
      );
      return null;
    }
    seen.set(advisory.ghsa_id, 1);

    await narrate(
      advisory.ghsa_id,
      'started',
      `ingested ${advisory.ghsa_id} · ${advisory.package_name} · ${advisory.severity}`,
    );

    // one cheap pre-traversal: the classifier needs real hop depth, and the run
    // reuses this exact result rather than re-asking the graph.
    let paths: HopPath[] | null = null;
    try {
      paths = await graph.hopPaths(advisory.ghsa_id, 5);
    } catch (e) {
      log(`pre-traversal failed for ${advisory.ghsa_id}: ${(e as Error).message} — retrying once`);
      try {
        paths = await graph.hopPaths(advisory.ghsa_id, 5);
      } catch (e2) {
        paths = null;
        log(
          `pre-traversal failed twice for ${advisory.ghsa_id}: ${(e2 as Error).message} — ` +
            `the pipeline will traverse for itself`,
        );
      }
    }

    const { cls } = await classOf(advisory, paths);
    const known = paths ?? [];
    await narrate(
      advisory.ghsa_id,
      'started',
      `class ${cls.id} · ${known.length} path(s) · depth ${depthBand(
        known.length ? Math.max(...known.map((p) => p.hops)) : 0,
        known.length,
      )}${paths === null ? ' (pre-traversal unavailable)' : ''}`,
      { advisory_class: cls },
    );

    // §4.3 — the graph selects the pipeline
    const selected = await meta.select(cls);
    await narrate(
      advisory.ghsa_id,
      'started',
      `pipeline ${selected.selection.pipeline_id} selected · ${selected.reason}`,
      {
        pipeline: {
          pipeline_id: selected.selection.pipeline_id,
          name: selected.spec.name,
          success_rate: selected.selection.success_rate,
          avg_latency: selected.selection.avg_latency,
          advisory_class: cls.id,
          reason: selected.reason,
        },
      },
    );

    const ctx: RunContext = {
      graph: withRunCache(graph, advisory.ghsa_id, paths, chokepointCache),
      bus,
      agents,
      meta,
      tools,
      selection_reason: selected.reason,
      advisory_class: cls,
      mock,
      log,
    };

    funnel.traversed += 1;
    let run: PipelineRun;
    try {
      run = await runtime.run(selected.spec, advisory, ctx);
    } catch (e) {
      await narrate(advisory.ghsa_id, 'error', `pipeline failed: ${(e as Error).message}`);
      throw e;
    }

    if (run.outcome === 'suppressed') funnel.suppressed += 1;
    else if (run.outcome === 'escalated') funnel.escalated += 1;
    funnel.actions += run.receipts.filter((r) => r.ok).length;
    latencies.push(run.latency_ms);
    funnel.p99_ms = Math.round(percentile(latencies, 99) * 1000) / 1000;

    history.push(run);
    if (history.length > maxRuns) history.splice(0, history.length - maxRuns);

    await publishDecision(run);
    await narrate(
      advisory.ghsa_id,
      run.outcome === 'suppressed' ? 'resolved' : 'verdict',
      run.outcome === 'suppressed'
        ? `${run.traces.find((t) => t.short_circuit)?.summary ?? 'suppressed'} · ${run.latency_ms.toFixed(1)}ms`
        : `escalated · ${run.receipts.filter((r) => r.ok).length} action(s) · ${run.latency_ms.toFixed(1)}ms`,
      { run_id: run.run_id, outcome: run.outcome, trace_url: runtime.traceUrl(run.run_id) },
    );

    return run;
  }

  return {
    async start() {
      if (running) return;
      running = true;
      try {
        await bus.connect();
      } catch (e) {
        log(`bus.connect failed (continuing): ${(e as Error).message}`);
      }
      unsubscribe = bus.subscribe<AdvisoryEvent>(
        'advisories',
        async (e: EventEnvelope<AdvisoryEvent>) => {
          const payload = e?.payload;
          if (!payload || payload.kind !== 'advisory' || !payload.advisory) return;
          try {
            await handle(payload.advisory);
          } catch (err) {
            log(`handle(${payload.advisory.ghsa_id}) threw: ${(err as Error).message}`);
          }
        },
      );
      log('subscribed to advisories');
    },

    async stop() {
      running = false;
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch {
          // nothing to do
        }
        unsubscribe = null;
      }
    },

    handle,
    runs: () => [...history],
    funnel: () => ({ ...funnel }),
  };
}
