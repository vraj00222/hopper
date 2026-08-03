/**
 * @hopper/orchestrate — RocketRide.
 *
 * PipelineRuntimePort + OrchestratorPort + ToolsPort. Depends on
 * @hopper/contracts and nothing else; every collaborator arrives as a port.
 *
 * Note on the SDK: `@rocketride/sdk` is not published (npm 404), so this package
 * is a RocketRide-compatible runtime rather than a wrapper around one — portable
 * JSON `.pipe` specs, executed node-by-node, with per-node latency and token
 * tracing. `createRuntime({ mock: false, url })` (or MOCK=false + ROCKETRIDE_URL)
 * offers each run to a real server first and falls back to the local executor.
 */
export { createRuntime, type RuntimeOptions } from './runtime.js';
export { createTools, deliveriesOf, isValidApprovalToken, type ToolsOptions } from './tools.js';
export { createOrchestrator, type OrchestratorDeps } from './router.js';

export { DEFAULT_SPEC, DEFAULT_SPEC_JSON, DEFAULT_PIPELINE_ID, readSpecDir } from './specs/index.js';
export { PipelineRunError, PipelineSpecError } from './errors.js';
export { createRegistry, opNames, TRAVERSE_OPS, estimateTokens } from './ops/index.js';
export { evaluate as evaluateWhen, isElse } from './expr.js';

export type { OpHandler, OpResult, RunState, DeploymentFacts, ObligationFacts } from './ops/index.js';
