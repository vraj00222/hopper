/**
 * G3 — Obligation Officer.
 *
 * Customer / contract / clause subgraph → {clauses[], deadline_utc, notice_draft}.
 *
 * The deadline is arithmetic, not judgement: published_at + clause.hours, per clause,
 * sorted tightest first. The draft notice is a real one — short, factual, legally plain,
 * naming the CVE, the affected service, the clause reference and the deadline. No hype,
 * no apology theatre. A customer's lawyer is the reader.
 */
import { isoPlusHours, type HopPath, type ObligationVerdict } from '@hopper/contracts';

import { SYSTEM_PREFIX } from '../llm.js';
import {
  arrow,
  describeAdvisory,
  GROUNDING,
  orderedPaths,
  resolveVerdict,
  type AgentContext,
  type GroundedInput,
} from './context.js';

/** clause types that create a duty to tell the customer something */
const NOTICE_BEARING = new Set<HopPath['clause_type']>(['breach_notification']);

const NOTICE_FROM = 'Hopper · security@hopper.dev';

type Clause = ObligationVerdict['clauses'][number];

export function deriveObligation(g: GroundedInput): ObligationVerdict {
  const published = new Date(g.advisory.published_at);
  const paths = orderedPaths(g.hopPaths);
  const notice = paths.filter((p) => NOTICE_BEARING.has(p.clause_type));

  const seen = new Map<string, { clause: Clause; path: HopPath }>();
  for (const p of notice) {
    const key = `${p.customer}|${p.clause_ref}`;
    const clause: Clause = {
      customer: p.customer,
      clause_ref: p.clause_ref,
      hours: p.notice_window,
      deadline_utc: isoPlusHours(p.notice_window, published),
    };
    const prior = seen.get(key);
    // tightest window wins when the same clause is reached by several paths
    if (!prior || clause.hours < prior.clause.hours) seen.set(key, { clause, path: p });
  }

  const entries = [...seen.values()].sort(
    (a, b) =>
      a.clause.deadline_utc.localeCompare(b.clause.deadline_utc) ||
      a.clause.customer.localeCompare(b.clause.customer),
  );
  const clauses = entries.map((e) => e.clause);

  if (clauses.length === 0) {
    const otherTypes = [...new Set(paths.map((p) => p.clause_type))].sort();
    return {
      agent: 'obligation-officer',
      obligated: false,
      clauses: [],
      deadline_utc: null,
      notice_draft: '',
      confidence: paths.length === 0 ? 0.93 : 0.88,
      rationale:
        paths.length === 0
          ? `No customer is reached by ${g.advisory.package_name}, so no contractual notice window opens. ${GROUNDING}`
          : `${paths.length === 1 ? 'One customer path exists' : `${paths.length} customer paths exist`} but carry only ` +
            `${otherTypes.join(', ')} clauses, none of which create a duty to notify on a published advisory. ` +
            `No notice is drafted. ${GROUNDING}`,
    };
  }

  const lead = entries[0];
  const others = clauses.length - 1;
  return {
    agent: 'obligation-officer',
    obligated: true,
    clauses,
    deadline_utc: lead.clause.deadline_utc,
    notice_draft: draftNotice(g, lead.clause, lead.path),
    confidence: 0.95,
    rationale:
      `${clauses.length} breach-notification clause${clauses.length === 1 ? ' reaches' : 's reach'} this advisory. The tightest is ` +
      `${lead.clause.customer} ${lead.clause.clause_ref} at ${lead.clause.hours}h, which against a publication time of ` +
      `${g.advisory.published_at} puts the deadline at ${lead.clause.deadline_utc}` +
      (others > 0 ? `; ${others} further clause${others === 1 ? '' : 's'} follow` : '') +
      `. Deadlines are arithmetic on the contract subgraph, not inference. ${GROUNDING}`,
  };
}

/** the notice a customer actually receives, minus a human's signature */
export function draftNotice(g: GroundedInput, clause: Clause, path: HopPath): string {
  const a = g.advisory;
  const svcIdx = path.chain.indexOf(path.service);
  const intermediates = svcIdx > 1 ? path.chain.slice(1, svcIdx) : [];
  const reach =
    intermediates.length > 0
      ? `${a.package_name}, reached by ${path.service} via ${arrow(intermediates)}`
      : `${a.package_name}, a direct dependency of ${path.service}`;
  const remediation = a.fixed_in
    ? `A fixed version (${a.package_name} ${a.fixed_in}) has been published. We will confirm the remediation status of ${path.service} to you before the deadline above.`
    : `No fixed version has been published yet. We will confirm the mitigation in place for ${path.service} to you before the deadline above.`;

  return [
    `${clause.customer} — security notification under ${clause.clause_ref}`,
    '',
    `We are notifying you of a published security advisory affecting a component of ${path.service}, a service we operate for you.`,
    '',
    `Advisory   ${describeAdvisory(a)}, ${a.severity}, CVSS ${a.cvss}`,
    `Component  ${reach}`,
    `Published  ${a.published_at}`,
    `Clause     ${clause.clause_ref} — notification within ${clause.hours} hours of publication`,
    `Deadline   ${clause.deadline_utc}`,
    '',
    `Summary    ${a.summary}`,
    '',
    remediation,
    '',
    `This notice was prepared from the dependency and contract records for ${clause.customer} and is issued under ${path.governing_law} law, contract ${path.contract_id}.`,
    NOTICE_FROM,
  ].join('\n');
}

export async function runObligationOfficer(ctx: AgentContext): Promise<ObligationVerdict> {
  const deterministic = deriveObligation(ctx.grounded);
  return resolveVerdict<ObligationVerdict>(
    ctx,
    'obligation-officer',
    deterministic,
    () => ({
      system:
        `${SYSTEM_PREFIX} You are the Obligation Officer. Determine which contractual notice windows this advisory opens and ` +
        `draft the customer notice. The notice must name the CVE, the affected service, the clause reference and the deadline, ` +
        `and must not apologise, speculate or market. Schema: {"agent":"obligation-officer","obligated":boolean,` +
        `"clauses":[{"customer":string,"clause_ref":string,"hours":number,"deadline_utc":ISO}],"deadline_utc":ISO|null,` +
        `"notice_draft":string,"confidence":number 0..1,"rationale":string}.`,
      user: JSON.stringify(
        {
          advisory: ctx.grounded.advisory,
          hop_paths: ctx.grounded.hopPaths,
          computed_deadlines: deterministic.clauses,
        },
        null,
        2,
      ),
    }),
    // arithmetic, not judgement: a model does not get to move a contractual deadline
    {
      agent: 'obligation-officer',
      obligated: deterministic.obligated,
      clauses: deterministic.clauses,
      deadline_utc: deterministic.deadline_utc,
    },
  );
}
