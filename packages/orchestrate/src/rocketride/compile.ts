/**
 * Compile our internal `PipelineSpec` into a real RocketRide pipeline object.
 *
 * §4.3 IS CONFIRMED. `client.use({ pipeline })` accepts a pipeline OBJECT at
 * runtime — verified against the live service, which returned a real task token
 * for a pipeline that had never been deployed or registered. That is the whole
 * meta move: FalkorDB hands us `Pipeline.spec_json` as a string, we parse it,
 * compile it here, and RocketRide runs it. No pre-registered pipeline IDs, no
 * fallback to a fixed set of harnesses — the graph really does choose.
 *
 * ── The mapping, and where it is honest about itself ──────────────────────
 *
 * Our internal spec stays the execution model: it is what the graph stores and
 * what the local executor walks node by node. This module is a compile step at
 * dispatch time, nothing more.
 *
 * RocketRide has no provider that runs a Cypher traversal, calls Guild, or
 * opens a GitHub PR through our ports — so there is no honest one-to-one
 * mapping for our ops. What their vocabulary does have is a text lane that
 * flows from a `webhook` ingress through text→text components to a
 * `response_text` egress. So each of our nodes becomes one component on that
 * lane, carrying our op name in `name` and our node identity in `description`.
 * The result is a pipeline that really runs on their engine and reads, in their
 * canvas and their trace panel, as the five traversal stages in order (R7).
 *
 * Everything below was verified against the live catalogue (`getServices()`,
 * 140 providers) and by starting real tasks:
 *   · `webhook`       — ingress; emits lanes tags/text/json/audio/video/image
 *   · `ner`           — lanes {"text": ["text"]}; the text→text carrier
 *   · `response_text` — lanes {"text": []}; the egress
 *   · `response` (no suffix) is NOT in the catalogue. `use()` accepts it but the
 *     task self-terminates, so we do not emit it.
 *   · `input[].lane` is a DATA LANE ('text'), never a port name.
 *   · component ids must be unique per project+source or `use()` answers
 *     "Pipeline is already running" — hence the per-dispatch tag.
 */
import type { Advisory, PipelineNodeSpec, PipelineSpec } from '@hopper/contracts';

export interface RocketRideInput {
  /** data lane name — 'text' | 'data' | 'image', NOT a port name */
  lane: string;
  from: string;
}

export interface RocketRideComponent {
  id: string;
  provider: string;
  name?: string;
  description?: string;
  config: Record<string, unknown>;
  input?: RocketRideInput[];
}

export interface RocketRidePipeline {
  name: string;
  description?: string;
  project_id: string;
  source: string;
  components: RocketRideComponent[];
}

/** the ingress every `send()` goes through */
export const SOURCE_PROVIDER = 'webhook';
/** the egress that closes the text lane */
export const SINK_PROVIDER = 'response_text';
/** text→text carrier for stages that have no RocketRide equivalent */
export const CARRIER_PROVIDER = 'ner';
export const LANE = 'text';

/** RocketRide component ids are identifier-shaped; ours already nearly are */
function safeId(raw: string, tag: string): string {
  const base = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '') || 'node';
  return `${base}_${tag}`;
}

function shortTag(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/**
 * Presentation order. Our spec is a DAG with a short-circuit branch; the text
 * lane is linear. We emit components in the spec's authored node order (entry
 * hoisted), which is the order an operator reads the traversal in: source,
 * reachability, the suppression branch, the four remaining stages, dispatch,
 * the tools, write-back. The branch DECISION is not compiled — our runtime
 * makes it, and our own NodeTrace is where you see which way it went.
 */
function ordered(spec: PipelineSpec): PipelineNodeSpec[] {
  const entry = spec.nodes.find((n) => n.id === spec.entry);
  const rest = spec.nodes.filter((n) => n.id !== spec.entry);
  return entry ? [entry, ...rest] : [...spec.nodes];
}

function providerFor(node: PipelineNodeSpec, isFirst: boolean, isLast: boolean): string {
  if (isFirst) return SOURCE_PROVIDER;
  if (isLast || node.kind === 'sink') return SINK_PROVIDER;
  return CARRIER_PROVIDER;
}

export interface CompileOptions {
  projectId?: string;
  /** unique suffix for this dispatch; generated when omitted */
  tag?: string;
}

/**
 * Translate a HOPPER spec into a runnable RocketRide pipeline object.
 * The returned object is exactly what `client.use({ pipeline })` takes.
 */
export function compileToRocketRide(
  spec: PipelineSpec,
  advisory: Advisory,
  opts: CompileOptions = {},
): RocketRidePipeline {
  const tag = opts.tag ?? shortTag();
  const projectId = opts.projectId ?? 'hopper';
  const nodes = ordered(spec);

  const components: RocketRideComponent[] = [];
  let previous: string | null = null;

  nodes.forEach((node, i) => {
    const isFirst = i === 0;
    const isLast = i === nodes.length - 1;
    const id = safeId(node.id, tag);
    const component: RocketRideComponent = {
      id,
      provider: providerFor(node, isFirst, isLast),
      // this is the string an operator reads in RocketRide's own panel
      name: node.op,
      description: `HOPPER ${node.kind} · node '${node.id}' · ${advisory.ghsa_id} (${advisory.package_name})`,
      config: {},
    };
    if (previous) component.input = [{ lane: LANE, from: previous }];
    components.push(component);
    previous = id;
  });

  // if the spec's last node was not a sink, close the lane with a real egress
  const last = components[components.length - 1];
  if (last && last.provider !== SINK_PROVIDER) {
    components.push({
      id: safeId('response', tag),
      provider: SINK_PROVIDER,
      name: 'sink.response',
      description: 'HOPPER egress — closes the text lane',
      config: {},
      input: [{ lane: LANE, from: last.id }],
    });
  }

  return {
    name: `HOPPER ${spec.name} · ${advisory.ghsa_id}`,
    description:
      `${spec.description || spec.name} — compiled from HOPPER spec '${spec.id}' v${spec.version}. ` +
      `The spec itself is stored in FalkorDB and was selected by the graph for this advisory class.`,
    project_id: projectId,
    source: components[0]?.id ?? safeId(spec.entry, tag),
    components,
  };
}
