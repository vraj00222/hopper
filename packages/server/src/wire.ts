/**
 * HOPPER — the join.
 *
 * Four systems that have never shared a database, wired through the ports in
 * @hopper/contracts. Nothing here knows how any of them are implemented.
 */
import {
  type AgentsPort,
  type EventBusPort,
  type GraphPort,
  type IngestPort,
  type MetaPort,
  type OrchestratorPort,
  type PipelineRuntimePort,
  type ToolsPort,
  isMock,
} from '@hopper/contracts';

import { createGraph } from '@hopper/graph';
import { createBus, createIngest } from '@hopper/ingest';
import { createAgents } from '@hopper/agents';
import { createMeta } from '@hopper/meta';
import { createOrchestrator, createRuntime, createTools } from '@hopper/orchestrate';

export interface Hopper {
  graph: GraphPort;
  bus: EventBusPort;
  ingest: IngestPort;
  agents: AgentsPort;
  meta: MetaPort;
  runtime: PipelineRuntimePort;
  tools: ToolsPort;
  orchestrator: OrchestratorPort;
  mock: boolean;
  graphConnected: boolean;
  startedAt: string;
  shutdown(): Promise<void>;
}

export interface BootOptions {
  mock?: boolean;
  /** skip seeding — the graph is already populated */
  skipSeed?: boolean;
  memoryGraph?: boolean;
  log?: (msg: string) => void;
}

export async function boot(opts: BootOptions = {}): Promise<Hopper> {
  const mock = opts.mock ?? isMock();
  const log = opts.log ?? ((m: string) => console.log(m));
  const startedAt = new Date().toISOString();

  // ── MEMORY ────────────────────────────────────────────────────────────────
  let graph = createGraph({ memory: opts.memoryGraph });
  let graphConnected = true;
  try {
    await graph.connect();
    await graph.applySchema();
    log('graph      falkordb · connected · schema applied');
  } catch (err) {
    log(`graph      falkordb unreachable (${(err as Error).message}) - falling back to in-memory`);
    graph = createGraph({ memory: true });
    await graph.connect();
    await graph.applySchema();
    graphConnected = false;
    log('graph      in-memory · connected');
  }

  // ── MOTION IN ─────────────────────────────────────────────────────────────
  const bus = createBus({ mock });
  await bus.connect();
  log(`bus        ${bus.transport()} · 6 topics`);

  const ingest = createIngest(bus, { mock });

  // ── GOVERNANCE ────────────────────────────────────────────────────────────
  const agents = createAgents({ mock, graph, bus });

  // ── THE META LAYER ────────────────────────────────────────────────────────
  const meta = createMeta({ graph, mock });
  const specs = await meta.seedPipelines();
  log(`meta       ${specs.length} pipelines in the graph`);

  // ── MOTION OUT ────────────────────────────────────────────────────────────
  const runtime = createRuntime({ mock });
  for (const spec of specs) runtime.register(spec);

  const tools = createTools({
    mock,
    credential: (name) => agents.credential(name),
  });

  const orchestrator = createOrchestrator({
    graph,
    bus,
    agents,
    meta,
    runtime,
    tools,
    mock,
  });

  // ── L6: persist every event to FalkorDB. Live in, memory out. ─────────────
  bus.subscribe('advisories', async (e) => {
    const payload = e.payload as { advisory?: unknown };
    if (payload?.advisory) {
      await graph.upsertAdvisory(payload.advisory as never).catch(() => {});
    }
  });

  bus.subscribe('kev-delta', async (e) => {
    const p = e.payload as { cve_id?: string; ghsa_id?: string | null; action?: string };
    if (p?.ghsa_id && p.action === 'escalate') {
      await graph
        .recordObservation(p.ghsa_id, `KEV escalation: ${p.cve_id} added to CISA KEV`, e.ts)
        .catch(() => {});
    }
  });

  await orchestrator.start();
  await ingest.start();
  log(`hopper     up · mock=${mock}`);

  return {
    graph,
    bus,
    ingest,
    agents,
    meta,
    runtime,
    tools,
    orchestrator,
    mock,
    graphConnected,
    startedAt,
    async shutdown() {
      await ingest.stop().catch(() => {});
      await orchestrator.stop().catch(() => {});
      await bus.close().catch(() => {});
      await graph.close().catch(() => {});
    },
  };
}
