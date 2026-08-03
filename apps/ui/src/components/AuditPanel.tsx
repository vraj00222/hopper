/**
 * The regulator artifact. AuditEntry rows in ts order, plain and readable,
 * collapsed until someone asks. Nothing decorative belongs here.
 */
import { useState } from 'react';
import type { AuditEntry } from '@hopper/contracts';

function hhmmss(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export function AuditPanel({ audit }: { audit: AuditEntry[] }) {
  const [open, setOpen] = useState(false);
  const rows = audit.slice().sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  return (
    <section className="panel audit-panel">
      <button type="button" className="audit-toggle" onClick={() => setOpen((v) => !v)}>
        <span className="label">Audit</span>
        <span className="audit-count">
          {rows.length} entries · {open ? 'hide' : 'show'} {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="audit-list scroll">
          {rows.length === 0 && <div className="empty">no entries for this advisory</div>}
          {rows.map((e, i) => (
            <div className={`audit-row is-${e.kind}`} key={`${e.ts}-${i}`}>
              <span>{hhmmss(e.ts)}</span>
              <span className="audit-kind">{e.kind}</span>
              <span className="audit-detail">
                {e.actor} · {e.detail}
                {typeof e.confidence === 'number' ? ` · ${e.confidence.toFixed(2)}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
