/**
 * The single reducer. Every ServerMessage — websocket or fixture — goes
 * through here. Pure, no DOM, no timers: the gate replays the whole demo arc
 * through this exact function.
 */
import { DEFAULT_APPROVER } from '@hopper/contracts';
import type {
  ActionReceipt,
  AppState,
  ApprovalRequest,
  ClockTick,
  FeedItem,
  ServerMessage,
} from '@hopper/contracts';
import type { HopWave, Selection, UiState } from './types.js';

export function initialUi(app: AppState): UiState {
  return {
    app,
    wave: null,
    selection: null,
    prev_selection: null,
    selection_seq: 0,
    logs: [],
  };
}

const clockKey = (t: ClockTick) => `${t.ghsa_id}::${t.customer}::${t.clause_ref}`;

function upsertClock(list: ClockTick[], tick: ClockTick): ClockTick[] {
  const i = list.findIndex((c) => clockKey(c) === clockKey(tick));
  if (i === -1) return [...list, tick];
  const next = list.slice();
  next[i] = tick;
  return next;
}

function upsertFeed(list: FeedItem[], item: FeedItem): FeedItem[] {
  const i = list.findIndex((f) => f.ghsa_id === item.ghsa_id);
  if (i === -1) return [item, ...list];
  const next = list.slice();
  next[i] = item;
  return next;
}

function upsertApproval(
  list: ApprovalRequest[],
  a: ApprovalRequest,
): ApprovalRequest[] {
  const i = list.findIndex((x) => x.id === a.id);
  if (i === -1) return [...list, a];
  const next = list.slice();
  next[i] = a;
  return next;
}

function addReceipt(list: ActionReceipt[], r: ActionReceipt): ActionReceipt[] {
  const dupe = list.some((x) => x.ref === r.ref && x.action === r.action);
  return dupe ? list : [...list, r];
}

function advanceWave(prev: HopWave | null, msg: Extract<ServerMessage, { type: 'hop' }>): HopWave {
  const fresh =
    prev === null || prev.ghsa_id !== msg.ghsa_id || msg.hop === 0;
  const base: HopWave = fresh
    ? {
        ghsa_id: msg.ghsa_id,
        total: msg.total,
        chain: new Array<string>(msg.total).fill(''),
        arrived: 0,
        suppressed: msg.suppressed,
        terminal: false,
        nonce: (prev?.nonce ?? 0) + 1,
      }
    : { ...prev, chain: prev.chain.slice() };

  const chain = base.chain.slice();
  while (chain.length < msg.total) chain.push('');
  chain[msg.hop] = msg.node;

  return {
    ...base,
    total: msg.total,
    chain,
    arrived: Math.max(base.arrived, msg.hop + 1),
    suppressed: base.suppressed || msg.suppressed,
    terminal: base.terminal || msg.terminal,
  };
}

export function reduce(ui: UiState, msg: ServerMessage): UiState {
  const app = ui.app;
  const focus = app.focus;

  switch (msg.type) {
    case 'state':
      return { ...ui, app: msg.state };

    case 'feed':
      return { ...ui, app: { ...app, feed: upsertFeed(app.feed, msg.item) } };

    case 'funnel':
      return { ...ui, app: { ...app, funnel: msg.funnel } };

    case 'clock': {
      const clocks = upsertClock(app.clocks, msg.tick);
      const nextFocus =
        focus && focus.advisory.ghsa_id === msg.tick.ghsa_id
          ? { ...focus, clocks: upsertClock(focus.clocks, msg.tick) }
          : focus;
      return { ...ui, app: { ...app, clocks, focus: nextFocus } };
    }

    case 'focus':
      return { ...ui, app: { ...app, focus: msg.focus } };

    case 'agent': {
      if (!focus || focus.advisory.ghsa_id !== msg.event.ghsa_id) return ui;
      return {
        ...ui,
        app: { ...app, focus: { ...focus, transcript: [...focus.transcript, msg.event] } },
      };
    }

    case 'hop':
      return { ...ui, wave: advanceWave(ui.wave, msg) };

    case 'approval': {
      const approvals = upsertApproval(app.approvals, msg.approval);
      const nextFocus =
        focus && focus.advisory.ghsa_id === msg.approval.ghsa_id
          ? { ...focus, approvals: upsertApproval(focus.approvals, msg.approval) }
          : focus;
      return { ...ui, app: { ...app, approvals, focus: nextFocus } };
    }

    case 'receipt': {
      const receipts = addReceipt(app.receipts, msg.receipt);
      const nextFocus = focus
        ? { ...focus, receipts: addReceipt(focus.receipts, msg.receipt) }
        : focus;
      return { ...ui, app: { ...app, receipts, focus: nextFocus } };
    }

    case 'run': {
      const i = app.runs.findIndex((r) => r.run_id === msg.run.run_id);
      const runs = i === -1 ? [msg.run, ...app.runs] : app.runs.slice();
      if (i !== -1) runs[i] = msg.run;
      const nextFocus =
        focus && focus.advisory.ghsa_id === msg.run.ghsa_id
          ? { ...focus, run: msg.run }
          : focus;
      return { ...ui, app: { ...app, runs, focus: nextFocus } };
    }

    case 'pipeline': {
      const sel: Selection = msg.selection;
      const changed = ui.selection !== null && ui.selection.pipeline_id !== sel.pipeline_id;
      return {
        ...ui,
        selection: sel,
        prev_selection: changed ? ui.selection : ui.prev_selection,
        selection_seq: ui.selection_seq + 1,
      };
    }

    case 'log':
      return {
        ...ui,
        logs: [
          ...ui.logs.slice(-40),
          { level: msg.level, message: msg.message, seq: ui.logs.length },
        ],
      };

    default:
      return ui;
  }
}

export function reduceAll(ui: UiState, msgs: ServerMessage[]): UiState {
  return msgs.reduce(reduce, ui);
}

// ─── the Guild HITL gate ────────────────────────────────────────────────────

export function pendingApproval(ui: UiState, id: string): ApprovalRequest | null {
  return ui.app.approvals.find((a) => a.id === id) ?? null;
}

/** true while the action is gated — nothing may execute */
export function isBlocked(ui: UiState, id: string): boolean {
  const a = pendingApproval(ui, id);
  return a !== null && a.status === 'pending';
}

export function receiptFor(ui: UiState, action: string): ActionReceipt | null {
  return ui.app.receipts.find((r) => r.action === action) ?? null;
}

const APPROVAL_COPY: Record<string, { ref: string; detail: string }> = {
  notify_customer: {
    ref: 'msg_01K9QF4W2ZC7',
    detail: 'Breach notice delivered · security@northwind.example · §7.3',
  },
  open_pr: { ref: 'https://github.com/northwind/build-api/pull/4472', detail: 'PR opened' },
  page_oncall: { ref: 'slack:C04TS9K/1754239099.0001', detail: 'On-call paged' },
  open_ticket: { ref: 'NW-2292', detail: 'Ticket opened' },
};

/**
 * Approving is the same code path online and offline: it produces the two
 * ServerMessages a server would have sent, and they go through `reduce`.
 * Guild issues the token; only then may an executor act.
 */
export function approvalMessages(
  ui: UiState,
  approval_id: string,
  approver: string = DEFAULT_APPROVER,
  at: string = new Date().toISOString(),
): ServerMessage[] {
  const a = pendingApproval(ui, approval_id);
  if (!a || a.status !== 'pending') return [];
  const copy = APPROVAL_COPY[a.action] ?? { ref: `ref_${a.id}`, detail: a.title };
  const approved: ApprovalRequest = {
    ...a,
    status: 'approved',
    approved_by: approver,
    decided_at: at,
    token: `gld_${a.id}_ok`,
  };
  const receipt: ActionReceipt = {
    action: a.action,
    ok: true,
    mock: true,
    ref: copy.ref,
    detail: copy.detail,
    ts: at,
    latency_ms: 618,
  };
  return [
    { type: 'approval', approval: approved },
    { type: 'receipt', receipt },
    { type: 'log', level: 'info', message: `guild: ${a.action} approved by ${approver}` },
  ];
}

// ─── derived selectors used by the component tree ───────────────────────────

/** the clock the OBLIGATION panel shows: the most urgent one still running */
export function primaryClock(ui: UiState): ClockTick | null {
  const running = ui.app.clocks.filter((c) => c.state === 'running');
  const pool = running.length > 0 ? running : ui.app.clocks;
  if (pool.length === 0) return null;
  return pool.reduce((a, b) => (b.remaining_seconds < a.remaining_seconds ? b : a));
}

export const CLOCK_ALARM_SECONDS = 4 * 3600;

export function clockIsUrgent(t: ClockTick | null): boolean {
  return t !== null && t.remaining_seconds <= CLOCK_ALARM_SECONDS;
}

/** one second of wall clock, applied to every running countdown */
export function tickMessages(ui: UiState): ServerMessage[] {
  return ui.app.clocks
    .filter((c) => c.state === 'running' && c.remaining_seconds > 0)
    .map((c) => ({
      type: 'clock',
      tick: { ...c, remaining_seconds: c.remaining_seconds - 1 },
    }));
}

/**
 * FEED display rule: nothing that escalated is ever hidden, the two most
 * recent suppressions stay visible for context, and the rest collapse into one
 * quiet line. `…47 suppressed` is the whole thesis in three words.
 */
export const FEED_VISIBLE_SUPPRESSED = 2;

export function splitFeed(feed: FeedItem[]): { shown: FeedItem[]; collapsed: FeedItem[] } {
  const shown: FeedItem[] = [];
  const collapsed: FeedItem[] = [];
  let quiet = 0;
  for (const item of feed) {
    if (item.state === 'suppressed') {
      if (quiet < FEED_VISIBLE_SUPPRESSED) {
        quiet += 1;
        shown.push(item);
      } else {
        collapsed.push(item);
      }
    } else {
      shown.push(item);
    }
  }
  return { shown, collapsed };
}
