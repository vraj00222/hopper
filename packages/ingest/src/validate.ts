/**
 * Runtime validators for everything that crosses the bus.
 *
 * The contract types are compile-time only; the bus carries data that came off
 * the network, out of a fixture, or from another package. Everything published
 * is checked against the shape declared in contracts/src/events.ts.
 */
import { NODE_LABELS, TOPICS } from '@hopper/contracts';
import type {
  Advisory,
  AgentBusEvent,
  AdvisoryEvent,
  ClockTick,
  DecisionEvent,
  EventEnvelope,
  HopperEvent,
  KevDeltaEvent,
  TelemetryEvent,
  Topic,
} from '@hopper/contracts';

export interface Validation {
  ok: boolean;
  kind: string;
  errors: string[];
}

const SEVERITIES = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
const ECOSYSTEMS = ['npm', 'pypi', 'go', 'maven', 'cargo', 'rubygems'];
const CLOCK_STATES = ['running', 'satisfied', 'breached', 'paused'];
const AGENTS = ['reachability', 'patch-engineer', 'obligation-officer', 'arbiter'];
const PHASES = ['started', 'verdict', 'conflict', 'resolved', 'error'];
const ACTIONS = ['open_pr', 'page_oncall', 'notify_customer', 'open_ticket'];
const DECISION_STATES = ['proposed', 'pending_approval', 'executed', 'rejected'];

/** topic -> the only `kind` allowed on it */
export const TOPIC_KIND: Record<Topic, HopperEvent['kind']> = {
  advisories: 'advisory',
  telemetry: 'telemetry',
  clock: 'clock',
  'kev-delta': 'kev-delta',
  'agent-bus': 'agent-bus',
  decisions: 'decision',
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isIso(v: unknown): boolean {
  return typeof v === 'string' && v.length >= 20 && !Number.isNaN(Date.parse(v));
}

function req(errors: string[], cond: boolean, msg: string): void {
  if (!cond) errors.push(msg);
}

export function validateAdvisory(a: unknown, prefix = 'advisory'): string[] {
  const e: string[] = [];
  if (!isObj(a)) return [`${prefix} is not an object`];
  req(e, typeof a.ghsa_id === 'string' && a.ghsa_id.startsWith('GHSA-'), `${prefix}.ghsa_id must be a GHSA- id`);
  req(e, a.cve_id === null || typeof a.cve_id === 'string', `${prefix}.cve_id must be string|null`);
  req(e, SEVERITIES.includes(String(a.severity)), `${prefix}.severity must be one of ${SEVERITIES.join('|')}`);
  req(e, typeof a.cvss === 'number' && a.cvss >= 0 && a.cvss <= 10, `${prefix}.cvss must be 0..10`);
  req(e, isIso(a.published_at), `${prefix}.published_at must be ISO-8601`);
  req(e, typeof a.summary === 'string' && a.summary.length > 0, `${prefix}.summary must be a non-empty string`);
  req(e, typeof a.in_kev === 'boolean', `${prefix}.in_kev must be boolean`);
  req(e, ECOSYSTEMS.includes(String(a.ecosystem)), `${prefix}.ecosystem must be one of ${ECOSYSTEMS.join('|')}`);
  req(e, typeof a.package_name === 'string' && a.package_name.length > 0, `${prefix}.package_name required`);
  req(e, typeof a.vulnerable_range === 'string', `${prefix}.vulnerable_range must be a string`);
  req(e, a.fixed_in === null || typeof a.fixed_in === 'string', `${prefix}.fixed_in must be string|null`);
  req(
    e,
    a.source === undefined || ['github', 'osv', 'fixture', 'synthetic'].includes(String(a.source)),
    `${prefix}.source must be github|osv|fixture|synthetic`,
  );
  return e;
}

export function validateEvent(p: unknown): Validation {
  if (!isObj(p)) return { ok: false, kind: 'unknown', errors: ['payload is not an object'] };
  const kind = String(p.kind);
  const e: string[] = [];
  switch (kind) {
    case 'advisory': {
      const ev = p as unknown as AdvisoryEvent;
      e.push(...validateAdvisory(ev.advisory, 'advisory.advisory'));
      req(e, isIso(ev.received_at), 'advisory.received_at must be ISO-8601');
      break;
    }
    case 'telemetry': {
      const ev = p as unknown as TelemetryEvent;
      req(e, typeof ev.service === 'string' && ev.service.length > 0, 'telemetry.service required');
      req(e, typeof ev.package === 'string' && ev.package.length > 0, 'telemetry.package required');
      req(e, typeof ev.symbol === 'string' && ev.symbol.length > 0, 'telemetry.symbol required');
      req(e, Number.isInteger(ev.calls) && ev.calls >= 0, 'telemetry.calls must be a non-negative integer');
      req(e, Number.isFinite(ev.window_seconds) && ev.window_seconds > 0, 'telemetry.window_seconds must be > 0');
      req(e, isIso(ev.observed_at), 'telemetry.observed_at must be ISO-8601');
      break;
    }
    case 'clock': {
      const ev = p as unknown as ClockTick;
      req(e, typeof ev.customer === 'string' && ev.customer.length > 0, 'clock.customer required');
      req(e, typeof ev.ghsa_id === 'string' && ev.ghsa_id.startsWith('GHSA-'), 'clock.ghsa_id must be a GHSA- id');
      req(e, isIso(ev.deadline_utc), 'clock.deadline_utc must be ISO-8601');
      req(
        e,
        Number.isInteger(ev.remaining_seconds) && ev.remaining_seconds >= 0,
        'clock.remaining_seconds must be a non-negative integer',
      );
      req(e, Number.isFinite(ev.window_hours) && ev.window_hours > 0, 'clock.window_hours must be > 0');
      req(e, typeof ev.clause_ref === 'string' && ev.clause_ref.length > 0, 'clock.clause_ref required');
      req(e, CLOCK_STATES.includes(String(ev.state)), `clock.state must be one of ${CLOCK_STATES.join('|')}`);
      break;
    }
    case 'kev-delta': {
      const ev = p as unknown as KevDeltaEvent;
      req(e, typeof ev.cve_id === 'string' && ev.cve_id.startsWith('CVE-'), 'kev-delta.cve_id must be a CVE- id');
      req(e, ev.ghsa_id === null || typeof ev.ghsa_id === 'string', 'kev-delta.ghsa_id must be string|null');
      req(e, isIso(ev.added_at), 'kev-delta.added_at must be ISO-8601');
      req(e, typeof ev.known_ransomware === 'boolean', 'kev-delta.known_ransomware must be boolean');
      req(e, ['escalate', 'noop'].includes(String(ev.action)), 'kev-delta.action must be escalate|noop');
      break;
    }
    case 'agent-bus': {
      const ev = p as unknown as AgentBusEvent;
      req(e, AGENTS.includes(String(ev.agent)), `agent-bus.agent must be one of ${AGENTS.join('|')}`);
      req(e, typeof ev.ghsa_id === 'string' && ev.ghsa_id.startsWith('GHSA-'), 'agent-bus.ghsa_id must be a GHSA- id');
      req(e, PHASES.includes(String(ev.phase)), `agent-bus.phase must be one of ${PHASES.join('|')}`);
      req(e, typeof ev.message === 'string', 'agent-bus.message must be a string');
      req(
        e,
        ev.confidence === undefined || (typeof ev.confidence === 'number' && ev.confidence >= 0 && ev.confidence <= 1),
        'agent-bus.confidence must be 0..1',
      );
      break;
    }
    case 'decision': {
      const ev = p as unknown as DecisionEvent;
      req(e, typeof ev.ghsa_id === 'string' && ev.ghsa_id.startsWith('GHSA-'), 'decision.ghsa_id must be a GHSA- id');
      req(e, ACTIONS.includes(String(ev.action)), `decision.action must be one of ${ACTIONS.join('|')}`);
      req(e, typeof ev.auto === 'boolean', 'decision.auto must be boolean');
      req(e, typeof ev.requires_approval === 'boolean', 'decision.requires_approval must be boolean');
      req(e, DECISION_STATES.includes(String(ev.status)), `decision.status must be one of ${DECISION_STATES.join('|')}`);
      req(e, isIso(ev.ts), 'decision.ts must be ISO-8601');
      break;
    }
    default:
      return { ok: false, kind, errors: [`unknown event kind "${kind}"`] };
  }
  return { ok: e.length === 0, kind, errors: e };
}

export function validateEnvelope(env: unknown): Validation {
  if (!isObj(env)) return { ok: false, kind: 'unknown', errors: ['envelope is not an object'] };
  const e: string[] = [];
  req(e, typeof env.id === 'string' && env.id.length > 0, 'envelope.id required');
  req(e, TOPICS.includes(env.topic as Topic), `envelope.topic must be one of ${TOPICS.join('|')}`);
  req(e, isIso(env.ts), 'envelope.ts must be ISO-8601');
  req(e, Number.isInteger(env.seq) && (env.seq as number) >= 0, 'envelope.seq must be a non-negative integer');
  const inner = validateEvent(env.payload);
  if (TOPICS.includes(env.topic as Topic) && inner.ok) {
    const want = TOPIC_KIND[env.topic as Topic];
    req(e, inner.kind === want, `topic ${String(env.topic)} carries kind "${inner.kind}", expected "${want}"`);
  }
  return { ok: e.length === 0 && inner.ok, kind: inner.kind, errors: [...e, ...inner.errors] };
}

/** exported so callers can assert the contract's label list is intact */
export const CONTRACT_NODE_LABELS = NODE_LABELS;

export type { Advisory };
