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

function receiptTitle(r: ActionReceipt): string {
  return r.detail || TITLES[r.action];
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

        {receipts.map((r) => {
          const wasGated = settled.some((a) => a.action === r.action);
          return (
            <div className="action-row" key={`${r.action}-${r.ref}`}>
              <span className="action-mark">&#10003;</span>
              <span>
                <span className="action-title">{receiptTitle(r)}</span>
                <br />
                <span className="action-ref">
                  {r.ref} · {r.latency_ms}ms{r.mock ? ' · mock' : ''}
                </span>
              </span>
              <span className="action-tag">{wasGated ? 'approved' : 'auto'}</span>
            </div>
          );
        })}

        {pending.map((a) => (
          <div key={a.id}>
            <div className="action-row">
              <span className="action-mark is-pending">&#8987;</span>
              <span>
                <span className="action-title">{a.title}</span>
                <br />
                <span className="action-ref">{a.body}</span>
              </span>
              <button type="button" className="approve-btn" onClick={() => onApprove(a.id)}>
                Approve
              </button>
            </div>
            <div className="gate-note">
              <span className="arrow">&uarr;</span>
              <span>Guild HITL gate · no token issued until a human signs</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
