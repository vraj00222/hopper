/**
 * @hopper/orchestrate — RocketRide.
 *
 * PipelineRuntimePort + OrchestratorPort + ToolsPort. Depends on
 * @hopper/contracts and nothing else; every collaborator arrives as a port.
 *
 * The SDK is the npm package `rocketride` (v1.3.0) — `@rocketride/sdk` is a 404.
 * With MOCK=false and ROCKETRIDE_AUTH set, each run compiles its spec into a
 * real RocketRide pipeline object and loads it on https://api.rocketride.ai at
 * runtime (§4.3, verified). The traversal itself executes here against the
 * ports; the remote task is the traced dispatch, and any failure falls back to
 * local silently. Pipelines stay portable JSON either way.
 */
export {
  closeRuntime,
  createRuntime,
  flushRemote,
  remoteTaskOf,
  renderRunForRocketRide,
  type RuntimeOptions,
} from './runtime.js';
export {
  compileToRocketRide,
  createRocketRideBridge,
  CARRIER_PROVIDER,
  LANE,
  SINK_PROVIDER,
  SOURCE_PROVIDER,
} from './rocketride/index.js';
export type {
  BridgeOptions,
  CompileOptions,
  RemoteTask,
  RocketRideBridge,
  RocketRideComponent,
  RocketRidePipeline,
} from './rocketride/index.js';
export { createTools, deliveriesOf, isValidApprovalToken, type ToolsOptions } from './tools.js';
export { createOrchestrator, type OrchestratorDeps } from './router.js';

export { DEFAULT_SPEC, DEFAULT_SPEC_JSON, DEFAULT_PIPELINE_ID, readSpecDir } from './specs/index.js';
export { PipelineRunError, PipelineSpecError } from './errors.js';
export { createRegistry, opNames, TRAVERSE_OPS, estimateTokens } from './ops/index.js';
export { evaluate as evaluateWhen, isElse } from './expr.js';

export type { OpHandler, OpResult, RunState, DeploymentFacts, ObligationFacts } from './ops/index.js';
