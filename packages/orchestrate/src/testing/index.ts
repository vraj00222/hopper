/**
 * Port stubs so this package runs standalone. Deliberately NOT re-exported from
 * src/index.ts — nothing in the product should be able to reach them.
 */
export { createStubGraph, HERO_HOP_PATHS } from './stub-graph.js';
export type { StubGraph, StubGraphOptions, StubGraphCalls } from './stub-graph.js';
export { createStubBus } from './stub-bus.js';
export type { StubBus } from './stub-bus.js';
export { createStubAgents } from './stub-agents.js';
export type { StubAgents } from './stub-agents.js';
export { createStubMeta } from './stub-meta.js';
export type { StubMeta } from './stub-meta.js';
