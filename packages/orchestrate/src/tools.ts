/**
 * R5 — the four tool executors.
 *
 * Every one honours MOCK (default true) and returns a contract ActionReceipt
 * with a believable ref and a real measured latency. Nothing here reads a token
 * out of process.env: credentials arrive through the injected `credential()`
 * callback, which is Guild's credential layer resolving them at execution time
 * (G7). A token is never logged, never put in a receipt, and never held.
 *
 * `notifyCustomer` cannot report success without an approval token (G6). The
 * check is the first statement in the function and the failure path returns
 * before any transport exists — there is no ordering in which a delivery
 * happens and the gate is skipped.
 */
import {
  isMock,
  nowIso,
  type ActionKind,
  type ActionReceipt,
  type ToolsPort,
} from '@hopper/contracts';

export interface ToolsOptions {
  mock?: boolean;
  /** Guild's credential layer. Never `process.env` inside an executor. */
  credential?: (name: string) => Promise<string | null>;
  /** default org for PR refs when the repo arrives unqualified */
  org?: string;
}

const APPROVAL_REQUIRED: ActionKind[] = ['notify_customer'];
const PLACEHOLDER_TOKENS = new Set(['', 'null', 'undefined', 'none', 'pending', 'false', '0']);

/** what actually left the building — the gate reads this to prove G6 */
const DELIVERIES = new WeakMap<object, string[]>();

export function deliveriesOf(tools: ToolsPort): string[] {
  return [...(DELIVERIES.get(tools as unknown as object) ?? [])];
}

function ms(from: number): number {
  return Math.round((performance.now() - from) * 1000) / 1000;
}

/** stable-ish pseudo ids so replays diff cleanly but still look real */
function shortHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function slackTs(): string {
  const now = Date.now();
  return `${Math.floor(now / 1000)}.${String(now % 1000).padStart(3, '0')}000`;
}

/** G6 — the only definition of an executable approval */
export function isValidApprovalToken(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  const t = token.trim();
  if (t.length < 4) return false;
  return !PLACEHOLDER_TOKENS.has(t.toLowerCase());
}

export function createTools(opts: ToolsOptions = {}): ToolsPort {
  const mock = opts.mock ?? isMock();
  const org = opts.org ?? 'hopper-demo';
  const credential = opts.credential ?? (async () => null);
  const receipts: ActionReceipt[] = [];
  const delivered: string[] = [];

  function receipt(
    action: ActionKind,
    ok: boolean,
    ref: string,
    detail: string,
    t0: number,
    /** force `mock:true` for executors that are simulated even outside MOCK */
    simulated = false,
  ): ActionReceipt {
    const r: ActionReceipt = {
      action,
      ok,
      mock: mock || simulated,
      ref,
      detail,
      ts: nowIso(),
      latency_ms: ms(t0),
    };
    receipts.push(r);
    return r;
  }

  /** simulated wire time so the mock demo has honest-looking latency */
  async function wire(minMs: number, maxMs: number): Promise<void> {
    const d = minMs + Math.random() * (maxMs - minMs);
    await new Promise((r) => setTimeout(r, d));
  }

  const tools: ToolsPort = {
    async openPr(input) {
      const t0 = performance.now();
      const repo = input.repo.includes('/') ? input.repo : `${org}/${input.repo}`;
      const title = `fix(deps): bump ${input.package} to ${input.to_v} (${input.ghsa_id})`;

      if (mock) {
        await wire(35, 70);
        const n = 1200 + (shortHash(`${repo}:${input.ghsa_id}`) % 700);
        return receipt(
          'open_pr',
          true,
          `https://github.com/${repo}/pull/${n}`,
          `${title} · branch hopper/${input.package}-${input.to_v}`,
          t0,
        );
      }

      // real mode — the token is resolved at execution time and never retained
      const token = await credential('GITHUB_TOKEN');
      if (!token) {
        return receipt('open_pr', false, '', 'no GITHUB_TOKEN from the credential layer', t0);
      }
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/vnd.github+json',
            'content-type': 'application/json',
            'user-agent': 'hopper',
          },
          body: JSON.stringify({
            title,
            head: `hopper/${input.package}-${input.to_v}`,
            base: 'main',
            body:
              `Automated by HOPPER for ${input.ghsa_id}.\n\n` +
              `\`${input.package}\` ${input.from_v} → ${input.to_v}\n`,
          }),
          signal: AbortSignal.timeout(8000),
        });
        const body = (await res.json()) as { html_url?: string; message?: string };
        if (!res.ok) {
          return receipt('open_pr', false, '', `github ${res.status}: ${body.message ?? ''}`, t0);
        }
        return receipt('open_pr', true, body.html_url ?? '', title, t0);
      } catch (e) {
        return receipt('open_pr', false, '', `github request failed: ${(e as Error).message}`, t0);
      }
    },

    async pageOncall(input) {
      const t0 = performance.now();
      const text = `${input.ghsa_id} · ${input.summary} · paging ${input.slack_handle}`;

      if (mock) {
        await wire(20, 45);
        return receipt(
          'page_oncall',
          true,
          `${input.channel}#${slackTs()}`,
          `paged ${input.person} (${input.slack_handle}) in ${input.channel}`,
          t0,
        );
      }

      const hook = await credential('SLACK_WEBHOOK');
      if (!hook) {
        return receipt('page_oncall', false, '', 'no SLACK_WEBHOOK from the credential layer', t0);
      }
      try {
        const res = await fetch(hook, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, channel: input.channel }),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          return receipt('page_oncall', false, '', `slack ${res.status}`, t0);
        }
        return receipt(
          'page_oncall',
          true,
          `${input.channel}#${slackTs()}`,
          `paged ${input.person} in ${input.channel}`,
          t0,
        );
      } catch (e) {
        return receipt('page_oncall', false, '', `slack request failed: ${(e as Error).message}`, t0);
      }
    },

    async notifyCustomer(input) {
      const t0 = performance.now();

      // G6 — first statement, before any transport. There is no path to a
      // delivery that does not pass this line.
      if (!isValidApprovalToken(input.approval_token)) {
        return receipt(
          'notify_customer',
          false,
          '',
          `HITL gate: customer notice for ${input.customer} (${input.clause_ref}) requires a ` +
            `human approval token from Guild; none was presented, so nothing was sent`,
          t0,
        );
      }

      const messageId = `msg_${shortHash(`${input.ghsa_id}:${input.customer}`).toString(36)}@hopper.dev`;
      if (mock) {
        await wire(25, 55);
        delivered.push(`${input.customer}:${input.ghsa_id}`);
        return receipt(
          'notify_customer',
          true,
          messageId,
          `breach notice to ${input.customer} under ${input.clause_ref}, due ${input.deadline_utc}` +
            ` · approved (token ${input.approval_token.slice(0, 3)}…)`,
          t0,
        );
      }

      // real mode is deliberately not wired to an outbound mail provider: sending
      // a contractual breach notice from a hackathon build is not a thing to do
      // by accident. The approval gate is the load-bearing part and it is real.
      delivered.push(`${input.customer}:${input.ghsa_id}`);
      return receipt(
        'notify_customer',
        true,
        messageId,
        `notice drafted and approved for ${input.customer} (${input.clause_ref}); ` +
          `outbound delivery is deliberately not enabled outside MOCK`,
        t0,
        true,
      );
    },

    async openTicket(input) {
      const t0 = performance.now();
      await wire(15, 35);
      const key = `HOP-${1000 + (shortHash(input.ghsa_id) % 9000)}`;
      return receipt(
        'open_ticket',
        true,
        key,
        `${input.title} → ${input.assignee}${mock ? '' : ' (local ticket id — no tracker configured)'}`,
        t0,
        true,
      );
    },

    receipts: () => [...receipts],

    requires(action: ActionKind): 'auto' | 'approval' {
      return APPROVAL_REQUIRED.includes(action) ? 'approval' : 'auto';
    },
  };

  DELIVERIES.set(tools as unknown as object, delivered);
  return tools;
}
