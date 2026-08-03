/**
 * Receipts with their refs, and the one row that cannot execute: telling a
 * customer runs through Guild's approval primitive. Until a human clicks, no
 * token exists and nothing happens.
 */
import type { ActionKind, ActionReceipt, ApprovalRequest } from '@hopper/contracts';

const TITLES: Record<ActionKind, string> = {
  open_pr: 'Pull request',
  page_oncall: 'Page on-call',
  notify_customer: 'Notify customer',
  open_ticket: 'Ticket',
};

/** drawn, not a dingbat — there is no emoji anywhere in this product */
function DoneMark() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
      <path
        d="M1.4 5.9 L4.2 8.6 L9.6 2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeldMark() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.7" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 6 V3.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M6 6 L8.2 7.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function ActionsPanel({
  receipts,
  approvals,
  onApprove,
}: {
  receipts: ActionReceipt[];
  approvals: ApprovalRequest[];
  onApprove: (id: string) => void;
}) {
  const pending = approvals.filter((a) => a.status === 'pending');
  const settled = approvals.filter((a) => a.status !== 'pending');

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Actions</h2>
        <span className="panel-note">
          {receipts.length} executed{pending.length > 0 ? ` · ${pending.length} gated` : ''}
        </span>
      </div>

      <div className="scroll">
        {receipts.length === 0 && pending.length === 0 && (
          <div className="empty">no actions taken</div>
        )}

        {/* the gated row goes first: it is the only thing on this screen that
            is waiting on a person, and it must never scroll out of reach */}
        {pending.map((a) => (
          <div key={a.id}>
            <div className="action-row is-gated">
              <span className="action-mark is-pending">
                <HeldMark />
              </span>
              <span className="action-body">
                <span className="action-title">{a.title}</span>
                <span className="action-ref">{a.body}</span>
              </span>
              <button type="button" className="approve-btn" onClick={() => onApprove(a.id)}>
                Approve
              </button>
            </div>
            <div className="gate-note">
              <span className="arrow">&uarr;</span>
              <span>Guild HITL gate · no token until a human signs</span>
            </div>
          </div>
        ))}

        {receipts.map((r) => {
          const gated = settled.some((a) => a.action === r.action);
          return (
            <div className="action-row" key={`${r.action}-${r.ref}`}>
              <span className="action-mark">
                <DoneMark />
              </span>
              <span className="action-body">
                <span className="action-title">{r.detail || TITLES[r.action]}</span>
                <span className="action-ref">
                  {r.ref} · {r.latency_ms}ms{r.mock ? ' · mock' : ''}
                </span>
              </span>
              <span className={`action-tag${gated ? ' is-signed' : ''}`}>
                {gated ? 'approved' : 'auto'}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
