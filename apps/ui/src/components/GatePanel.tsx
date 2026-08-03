/**
 * Act 4 — the gate.
 *
 * One action on this screen cannot execute on its own. While it is waiting,
 * everything else on the page recedes (see the data-stage rule in styles.css)
 * and this is the only lit thing left.
 *
 * A receipt with `ok === false` is a record that something did NOT happen. The
 * live server emits exactly that for the blocked notice, so it is never drawn
 * with a checkmark; when the same action still has a pending approval, the
 * failure and the gate are one fact and it is told once, as the gate.
 */
import type { ActionReceipt, ApprovalRequest } from '@hopper/contracts';
import { splitReceipts } from '../lib/reducer.js';

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
      <path d="M2 6 H10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function GatePanel({
  receipts,
  approvals,
  onApprove,
  lit,
  isGate,
}: {
  receipts: ActionReceipt[];
  approvals: ApprovalRequest[];
  onApprove: (id: string) => void;
  lit: string;
  isGate: boolean;
}) {
  const pending = approvals.filter((a) => a.status === 'pending');
  const signed = approvals.filter((a) => a.status === 'approved');
  const { executed, held } = splitReceipts(receipts, approvals);

  const signedReceipts = executed.filter((r) => signed.some((a) => a.action === r.action));

  return (
    <section className={`panel${isGate ? ' is-gate' : ''}`} data-lit={lit}>
      <div className="panel-head">
        <h2 className="label">Human sign-off</h2>
        <span className="panel-note">
          {executed.length} executed
          {pending.length > 0 ? ` · ${pending.length} held` : ''}
          {held.length > 0 ? ` · ${held.length} blocked` : ''}
        </span>
      </div>

      {pending.length === 0 && signedReceipts.length === 0 && held.length === 0 && (
        <div className="empty">nothing is waiting on a person</div>
      )}

      {/* one signature at a time — a queue of identical gates is noise, and the
          operator can only sign the one in front of them anyway */}
      {pending.slice(0, 1).map((a) => (
        <div className="gate-block" key={a.id}>
          <div className="gate-caption">
            <span className="gate-mark" aria-hidden="true" />
            Guild gate · no token until a human signs
          </div>
          <div className="gate-row">
            <div>
              <div className="gate-title">{a.title}</div>
              <div className="gate-body">{a.body}</div>
            </div>
            <button type="button" className="approve-btn" onClick={() => onApprove(a.id)}>
              Sign &amp; send
            </button>
          </div>
        </div>
      ))}
      {pending.length > 1 && (
        <div className="gate-queue">{pending.length - 1} more waiting behind this one</div>
      )}

      {signedReceipts.map((r) => (
        <div key={`signed-${r.ref}`}>
          <div className="act-row">
            <span className="act-mark">
              <DoneMark />
            </span>
            <span className="act-body">
              <span className="act-title">{r.detail || r.action.replace(/_/g, ' ')}</span>
              <span className="act-ref">{[r.ref, `${Math.round(r.latency_ms)}ms`].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="act-tag is-signed">signed</span>
          </div>
          <div className="signed-rule" />
        </div>
      ))}

      {held.map((r) => (
        <div className="act-row is-held" key={`held-${r.action}-${r.ts}`}>
          <span className="act-mark is-held">
            <HeldMark />
          </span>
          <span className="act-body">
            <span className="act-title">{r.detail || r.action.replace(/_/g, ' ')}</span>
            <span className="act-ref">not sent</span>
          </span>
          <span className="act-tag is-held">blocked</span>
        </div>
      ))}
    </section>
  );
}
