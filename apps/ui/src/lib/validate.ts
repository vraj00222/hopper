/**
 * Runtime structural validator for the frozen AppState contract.
 *
 * TypeScript proves this at compile time; the gate has to prove it at runtime,
 * because the same shape has to survive a JSON round-trip from a real server.
 * Returns a list of problems — empty means structurally complete.
 */
import { NODE_LABELS } from '@hopper/contracts';
import type { AppState } from '@hopper/contracts';

type Any = Record<string, unknown>;

const SEVERITIES = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
const FEED_STATES = [
  'ingested',
  'traversing',
  'suppressed',
  'escalated',
  'awaiting_approval',
];
const CLOCK_STATES = ['running', 'satisfied', 'breached', 'paused'];
const APPROVAL_STATES = ['pending', 'approved', 'rejected', 'expired'];
const ACTION_KINDS = ['open_pr', 'page_oncall', 'notify_customer', 'open_ticket'];
const AGENT_NAMES = ['reachability', 'patch-engineer', 'obligation-officer', 'arbiter'];
const AGENT_PHASES = ['started', 'verdict', 'conflict', 'resolved', 'error'];
const AUDIT_KINDS = ['verdict', 'decision', 'observation', 'suppression', 'approval'];

class Check {
  readonly problems: string[] = [];

  fail(path: string, why: string) {
    this.problems.push(`${path}: ${why}`);
  }

  obj(path: string, v: unknown): Any | null {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      this.fail(path, `expected object, got ${describe(v)}`);
      return null;
    }
    return v as Any;
  }

  arr(path: string, v: unknown): unknown[] | null {
    if (!Array.isArray(v)) {
      this.fail(path, `expected array, got ${describe(v)}`);
      return null;
    }
    return v;
  }

  str(path: string, v: unknown) {
    if (typeof v !== 'string') this.fail(path, `expected string, got ${describe(v)}`);
  }

  nonEmpty(path: string, v: unknown) {
    this.str(path, v);
    if (typeof v === 'string' && v.trim() === '') this.fail(path, 'empty string');
  }

  num(path: string, v: unknown) {
    if (typeof v !== 'number' || Number.isNaN(v)) {
      this.fail(path, `expected number, got ${describe(v)}`);
    }
  }

  bool(path: string, v: unknown) {
    if (typeof v !== 'boolean') this.fail(path, `expected boolean, got ${describe(v)}`);
  }

  nullableStr(path: string, v: unknown) {
    if (v !== null && typeof v !== 'string') {
      this.fail(path, `expected string|null, got ${describe(v)}`);
    }
  }

  oneOf(path: string, v: unknown, allowed: string[]) {
    if (typeof v !== 'string' || !allowed.includes(v)) {
      this.fail(path, `expected one of ${allowed.join('|')}, got ${describe(v)}`);
    }
  }

  iso(path: string, v: unknown) {
    if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
      this.fail(path, `expected ISO-8601 timestamp, got ${describe(v)}`);
    }
  }

  unit(path: string, v: unknown) {
    this.num(path, v);
    if (typeof v === 'number' && (v < 0 || v > 1)) this.fail(path, `expected 0..1, got ${v}`);
  }
}

function describe(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function checkAdvisory(c: Check, p: string, v: unknown) {
  const a = c.obj(p, v);
  if (!a) return;
  c.nonEmpty(`${p}.ghsa_id`, a.ghsa_id);
  c.nullableStr(`${p}.cve_id`, a.cve_id);
  c.oneOf(`${p}.severity`, a.severity, SEVERITIES);
  c.num(`${p}.cvss`, a.cvss);
  c.iso(`${p}.published_at`, a.published_at);
  c.nonEmpty(`${p}.summary`, a.summary);
  c.bool(`${p}.in_kev`, a.in_kev);
  c.nonEmpty(`${p}.ecosystem`, a.ecosystem);
  c.nonEmpty(`${p}.package_name`, a.package_name);
  c.nonEmpty(`${p}.vulnerable_range`, a.vulnerable_range);
  c.nullableStr(`${p}.fixed_in`, a.fixed_in);
}

function checkFeedItem(c: Check, p: string, v: unknown) {
  const f = c.obj(p, v);
  if (!f) return;
  c.nonEmpty(`${p}.ghsa_id`, f.ghsa_id);
  c.nullableStr(`${p}.cve_id`, f.cve_id);
  c.nonEmpty(`${p}.package`, f.package);
  c.oneOf(`${p}.severity`, f.severity, SEVERITIES);
  c.iso(`${p}.published_at`, f.published_at);
  c.iso(`${p}.received_at`, f.received_at);
  c.num(`${p}.hops`, f.hops);
  c.oneOf(`${p}.state`, f.state, FEED_STATES);
  c.num(`${p}.customers`, f.customers);
  c.bool(`${p}.in_kev`, f.in_kev);
  c.nonEmpty(`${p}.summary`, f.summary);
}

function checkClock(c: Check, p: string, v: unknown) {
  const t = c.obj(p, v);
  if (!t) return;
  if (t.kind !== 'clock') c.fail(`${p}.kind`, `expected "clock", got ${describe(t.kind)}`);
  c.nonEmpty(`${p}.customer`, t.customer);
  c.nonEmpty(`${p}.ghsa_id`, t.ghsa_id);
  c.iso(`${p}.deadline_utc`, t.deadline_utc);
  c.num(`${p}.remaining_seconds`, t.remaining_seconds);
  c.num(`${p}.window_hours`, t.window_hours);
  c.nonEmpty(`${p}.clause_ref`, t.clause_ref);
  c.oneOf(`${p}.state`, t.state, CLOCK_STATES);
}

function checkApproval(c: Check, p: string, v: unknown) {
  const a = c.obj(p, v);
  if (!a) return;
  c.nonEmpty(`${p}.id`, a.id);
  c.oneOf(`${p}.action`, a.action, ACTION_KINDS);
  c.nonEmpty(`${p}.ghsa_id`, a.ghsa_id);
  c.nonEmpty(`${p}.title`, a.title);
  c.nonEmpty(`${p}.body`, a.body);
  c.iso(`${p}.requested_at`, a.requested_at);
  c.oneOf(`${p}.status`, a.status, APPROVAL_STATES);
}

function checkReceipt(c: Check, p: string, v: unknown) {
  const r = c.obj(p, v);
  if (!r) return;
  c.oneOf(`${p}.action`, r.action, ACTION_KINDS);
  c.bool(`${p}.ok`, r.ok);
  c.bool(`${p}.mock`, r.mock);
  c.nonEmpty(`${p}.ref`, r.ref);
  c.nonEmpty(`${p}.detail`, r.detail);
  c.iso(`${p}.ts`, r.ts);
  c.num(`${p}.latency_ms`, r.latency_ms);
}

function checkHopPath(c: Check, p: string, v: unknown) {
  const h = c.obj(p, v);
  if (!h) return;
  c.nonEmpty(`${p}.customer`, h.customer);
  c.oneOf(`${p}.customer_tier`, h.customer_tier, ['enterprise', 'growth', 'starter']);
  c.num(`${p}.arr`, h.arr);
  c.nonEmpty(`${p}.service`, h.service);
  c.nonEmpty(`${p}.repo`, h.repo);
  c.num(`${p}.notice_window`, h.notice_window);
  c.nonEmpty(`${p}.clause_ref`, h.clause_ref);
  c.oneOf(`${p}.clause_type`, h.clause_type, [
    'breach_notification',
    'sla_uptime',
    'data_residency',
    'audit_right',
  ]);
  c.num(`${p}.hops`, h.hops);
  const chain = c.arr(`${p}.chain`, h.chain);
  if (chain) chain.forEach((n, i) => c.nonEmpty(`${p}.chain[${i}]`, n));
  c.nonEmpty(`${p}.contract_id`, h.contract_id);
  c.nonEmpty(`${p}.governing_law`, h.governing_law);
}

function checkRun(c: Check, p: string, v: unknown) {
  const r = c.obj(p, v);
  if (!r) return;
  c.nonEmpty(`${p}.run_id`, r.run_id);
  c.nonEmpty(`${p}.pipeline_id`, r.pipeline_id);
  c.nonEmpty(`${p}.ghsa_id`, r.ghsa_id);
  c.nonEmpty(`${p}.advisory_class`, r.advisory_class);
  c.iso(`${p}.started_at`, r.started_at);
  c.iso(`${p}.ended_at`, r.ended_at);
  c.num(`${p}.latency_ms`, r.latency_ms);
  c.bool(`${p}.ok`, r.ok);
  c.oneOf(`${p}.outcome`, r.outcome, ['escalated', 'suppressed', 'error']);
  const traces = c.arr(`${p}.traces`, r.traces);
  if (traces) {
    traces.forEach((t, i) => {
      const n = c.obj(`${p}.traces[${i}]`, t);
      if (!n) return;
      c.nonEmpty(`${p}.traces[${i}].node_id`, n.node_id);
      c.nonEmpty(`${p}.traces[${i}].kind`, n.kind);
      c.nonEmpty(`${p}.traces[${i}].op`, n.op);
      c.num(`${p}.traces[${i}].latency_ms`, n.latency_ms);
      c.num(`${p}.traces[${i}].tokens`, n.tokens);
      c.bool(`${p}.traces[${i}].ok`, n.ok);
      c.bool(`${p}.traces[${i}].short_circuit`, n.short_circuit);
      c.nonEmpty(`${p}.traces[${i}].summary`, n.summary);
    });
  }
  const hp = c.arr(`${p}.hop_paths`, r.hop_paths);
  if (hp) hp.forEach((h, i) => checkHopPath(c, `${p}.hop_paths[${i}]`, h));
  const rec = c.arr(`${p}.receipts`, r.receipts);
  if (rec) rec.forEach((x, i) => checkReceipt(c, `${p}.receipts[${i}]`, x));
  c.nonEmpty(`${p}.selection_reason`, r.selection_reason);
}

function checkFocus(c: Check, p: string, v: unknown) {
  const f = c.obj(p, v);
  if (!f) return;
  checkAdvisory(c, `${p}.advisory`, f.advisory);

  const cls = c.obj(`${p}.advisory_class`, f.advisory_class);
  if (cls) {
    c.nonEmpty(`${p}.advisory_class.id`, cls.id);
    c.nonEmpty(`${p}.advisory_class.ecosystem`, cls.ecosystem);
    c.oneOf(`${p}.advisory_class.severity_band`, cls.severity_band, [
      'low',
      'moderate',
      'high',
      'critical',
    ]);
    c.oneOf(`${p}.advisory_class.depth_band`, cls.depth_band, [
      'direct',
      'shallow',
      'deep',
      'none',
    ]);
  }

  const paths = c.arr(`${p}.hop_paths`, f.hop_paths);
  if (paths) paths.forEach((h, i) => checkHopPath(c, `${p}.hop_paths[${i}]`, h));

  if (f.absence !== null) {
    const ab = c.obj(`${p}.absence`, f.absence);
    if (ab) {
      c.nonEmpty(`${p}.absence.package`, ab.package);
      c.num(`${p}.absence.paths`, ab.paths);
      c.oneOf(`${p}.absence.decision`, ab.decision, ['SUPPRESSED', 'ESCALATE']);
      c.nonEmpty(`${p}.absence.statement`, ab.statement);
      c.num(`${p}.absence.repos_checked`, ab.repos_checked);
      c.num(`${p}.absence.max_depth`, ab.max_depth);
    }
  }

  const precedents = c.arr(`${p}.precedents`, f.precedents);
  if (precedents) {
    precedents.forEach((x, i) => {
      const pr = c.obj(`${p}.precedents[${i}]`, x);
      if (!pr) return;
      c.nonEmpty(`${p}.precedents[${i}].package`, pr.package);
      c.nonEmpty(`${p}.precedents[${i}].from_v`, pr.from_v);
      c.nonEmpty(`${p}.precedents[${i}].to_v`, pr.to_v);
      c.oneOf(`${p}.precedents[${i}].outcome`, pr.outcome, [
        'success',
        'broke_staging',
        'rolled_back',
        'pending',
      ]);
      c.iso(`${p}.precedents[${i}].ts`, pr.ts);
      c.nonEmpty(`${p}.precedents[${i}].notes`, pr.notes);
      c.num(`${p}.precedents[${i}].age_seconds`, pr.age_seconds);
    });
  }

  const oncall = c.arr(`${p}.oncall`, f.oncall);
  if (oncall) {
    oncall.forEach((x, i) => {
      const o = c.obj(`${p}.oncall[${i}]`, x);
      if (!o) return;
      c.nonEmpty(`${p}.oncall[${i}].person`, o.person);
      c.nonEmpty(`${p}.oncall[${i}].email`, o.email);
      c.nonEmpty(`${p}.oncall[${i}].slack_handle`, o.slack_handle);
      c.nonEmpty(`${p}.oncall[${i}].team`, o.team);
      c.nonEmpty(`${p}.oncall[${i}].slack_channel`, o.slack_channel);
      c.nonEmpty(`${p}.oncall[${i}].service`, o.service);
      c.nullableStr(`${p}.oncall[${i}].oncall_until`, o.oncall_until);
    });
  }

  const transcript = c.arr(`${p}.transcript`, f.transcript);
  if (transcript) {
    transcript.forEach((x, i) => {
      const e = c.obj(`${p}.transcript[${i}]`, x);
      if (!e) return;
      if (e.kind !== 'agent-bus') c.fail(`${p}.transcript[${i}].kind`, 'expected "agent-bus"');
      c.oneOf(`${p}.transcript[${i}].agent`, e.agent, AGENT_NAMES);
      c.nonEmpty(`${p}.transcript[${i}].ghsa_id`, e.ghsa_id);
      c.oneOf(`${p}.transcript[${i}].phase`, e.phase, AGENT_PHASES);
      c.nonEmpty(`${p}.transcript[${i}].message`, e.message);
    });
  }

  const verdicts = c.obj(`${p}.verdicts`, f.verdicts);
  if (verdicts) {
    for (const key of ['reachability', 'patch', 'obligation', 'arbiter']) {
      const v2 = verdicts[key];
      if (v2 === undefined) continue;
      const vv = c.obj(`${p}.verdicts.${key}`, v2);
      if (!vv) continue;
      c.nonEmpty(`${p}.verdicts.${key}.verdict`, vv.verdict);
      c.unit(`${p}.verdicts.${key}.confidence`, vv.confidence);
      c.nonEmpty(`${p}.verdicts.${key}.detail`, vv.detail);
      if (key === 'patch') c.bool(`${p}.verdicts.patch.conflict`, vv.conflict);
    }
  }

  const clocks = c.arr(`${p}.clocks`, f.clocks);
  if (clocks) clocks.forEach((x, i) => checkClock(c, `${p}.clocks[${i}]`, x));

  const approvals = c.arr(`${p}.approvals`, f.approvals);
  if (approvals) approvals.forEach((x, i) => checkApproval(c, `${p}.approvals[${i}]`, x));

  const receipts = c.arr(`${p}.receipts`, f.receipts);
  if (receipts) receipts.forEach((x, i) => checkReceipt(c, `${p}.receipts[${i}]`, x));

  if (f.run !== null) checkRun(c, `${p}.run`, f.run);

  const audit = c.arr(`${p}.audit`, f.audit);
  if (audit) {
    audit.forEach((x, i) => {
      const a = c.obj(`${p}.audit[${i}]`, x);
      if (!a) return;
      c.iso(`${p}.audit[${i}].ts`, a.ts);
      c.oneOf(`${p}.audit[${i}].kind`, a.kind, AUDIT_KINDS);
      c.nonEmpty(`${p}.audit[${i}].actor`, a.actor);
      c.nonEmpty(`${p}.audit[${i}].detail`, a.detail);
      c.nonEmpty(`${p}.audit[${i}].ghsa_id`, a.ghsa_id);
    });
  }
}

export function validateAppState(value: unknown): string[] {
  const c = new Check();
  const s = c.obj('state', value);
  if (!s) return c.problems;

  const status = c.obj('state.status', s.status);
  if (status) {
    c.bool('state.status.live', status.live);
    c.bool('state.status.mock', status.mock);
    c.oneOf('state.status.transport', status.transport, ['laserdata', 'local']);
    c.bool('state.status.graph_connected', status.graph_connected);
    c.num('state.status.advisories_24h', status.advisories_24h);
    c.num('state.status.kev_count', status.kev_count);
    c.nonEmpty('state.status.falkor_ui', status.falkor_ui);
    c.nonEmpty('state.status.rocketride_trace', status.rocketride_trace);
    c.iso('state.status.started_at', status.started_at);
  }

  const feed = c.arr('state.feed', s.feed);
  if (feed) {
    if (feed.length === 0) c.fail('state.feed', 'empty — the demo needs a populated feed');
    feed.forEach((f, i) => checkFeedItem(c, `state.feed[${i}]`, f));
  }

  const funnel = c.obj('state.funnel', s.funnel);
  if (funnel) {
    for (const k of [
      'ingested',
      'deduped',
      'traversed',
      'suppressed',
      'escalated',
      'actions',
      'p99_ms',
    ]) {
      c.num(`state.funnel.${k}`, funnel[k]);
    }
    c.iso('state.funnel.window_started_at', funnel.window_started_at);
  }

  const clocks = c.arr('state.clocks', s.clocks);
  if (clocks) clocks.forEach((x, i) => checkClock(c, `state.clocks[${i}]`, x));

  const approvals = c.arr('state.approvals', s.approvals);
  if (approvals) approvals.forEach((x, i) => checkApproval(c, `state.approvals[${i}]`, x));

  const receipts = c.arr('state.receipts', s.receipts);
  if (receipts) receipts.forEach((x, i) => checkReceipt(c, `state.receipts[${i}]`, x));

  const runs = c.arr('state.runs', s.runs);
  if (runs) runs.forEach((x, i) => checkRun(c, `state.runs[${i}]`, x));

  const pipelines = c.arr('state.pipelines', s.pipelines);
  if (pipelines) {
    if (pipelines.length < 2) {
      c.fail('state.pipelines', 'need >= 2 pipelines for the graph to have a choice');
    }
    pipelines.forEach((x, i) => {
      const p = c.obj(`state.pipelines[${i}]`, x);
      if (!p) return;
      c.nonEmpty(`state.pipelines[${i}].pipeline_id`, p.pipeline_id);
      c.nonEmpty(`state.pipelines[${i}].name`, p.name);
      c.unit(`state.pipelines[${i}].success_rate`, p.success_rate);
      c.num(`state.pipelines[${i}].avg_latency`, p.avg_latency);
      c.num(`state.pipelines[${i}].runs`, p.runs);
    });
  }

  const gs = c.obj('state.graph_stats', s.graph_stats);
  if (gs) {
    for (const k of [
      'nodes',
      'edges',
      'advisories',
      'packages',
      'customers',
      'chokepoints',
    ]) {
      c.num(`state.graph_stats.${k}`, gs[k]);
    }
  }

  const chokes = c.arr('state.chokepoints', s.chokepoints);
  if (chokes) {
    chokes.forEach((x, i) => {
      const p = c.obj(`state.chokepoints[${i}]`, x);
      if (!p) return;
      c.nonEmpty(`state.chokepoints[${i}].package`, p.package);
      c.num(`state.chokepoints[${i}].betweenness`, p.betweenness);
      c.num(`state.chokepoints[${i}].dependents`, p.dependents);
      c.bool(`state.chokepoints[${i}].is_chokepoint`, p.is_chokepoint);
    });
  }

  if (!('focus' in s)) c.fail('state.focus', 'missing (must be FocusView or null)');
  else if (s.focus !== null) checkFocus(c, 'state.focus', s.focus);

  return c.problems;
}

/** sanity: we are validating against the same contract everyone else compiled */
export function contractLoaded(): boolean {
  return NODE_LABELS.includes('Clause') && NODE_LABELS.includes('Pipeline');
}

export type { AppState };
