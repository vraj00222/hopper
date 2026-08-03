/**
 * Act 3 — consequence.
 *
 * A pull request opened, an engineer paged, a contractual deadline now running:
 * these are not three unrelated widgets, they are one causal chain, so they are
 * drawn on one spine. The countdown sits at the end of it because it is the
 * consequence that outlives all the others.
 */
import { fmtCountdown } from '@hopper/contracts';
import type { ActionReceipt, ClockTick } from '@hopper/contracts';
import { CLOCK_ALARM_SECONDS } from '../lib/reducer.js';

function hhmmUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

function Link({
  tone,
  title,
  sub,
  children,
  last,
}: {
  tone?: 'live' | 'breach';
  title?: string;
  sub?: string;
  children?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`chain-link${tone ? ` is-${tone}` : ''}${last ? ' is-last' : ''}`}>
      <span className="chain-rail">
        <span className="chain-node" />
      </span>
      <div className="chain-body">
        {title && <div className="chain-title">{title}</div>}
        {sub && <div className="chain-sub">{sub}</div>}
        {children}
      </div>
    </div>
  );
}

export function ConsequencePanel({
  clock,
  executed,
  lit,
}: {
  clock: ClockTick | null;
  executed: ActionReceipt[];
  lit: string;
}) {
  const urgent = clock !== null && clock.remaining_seconds <= CLOCK_ALARM_SECONDS;
  const elapsed = clock
    ? Math.min(1, Math.max(0, 1 - clock.remaining_seconds / Math.max(1, clock.window_hours * 3600)))
    : 0;

  // the same person paged twice by two runs is one consequence, not two
  const seen = new Set<string>();
  const unique = executed.filter((r) => {
    const key = `${r.action}::${r.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // remediation first, the human second, the obligation last — the order in
  // which these actually happen
  const ordered = [...unique].sort(
    (a, b) => (a.action === 'page_oncall' ? 1 : 0) - (b.action === 'page_oncall' ? 1 : 0),
  );

  return (
    <section className={`panel${urgent ? ' is-breach' : ''}`} data-lit={lit}>
      <div className="panel-head">
        <h2 className="label">Consequence</h2>
        <span className="panel-note">
          {ordered.length} taken{clock ? ' · 1 obligation' : ''}
        </span>
      </div>

      <div className="chain">
        {ordered.length === 0 && !clock && <div className="empty">nothing has happened yet</div>}

        {ordered.map((r) => (
          <Link
            key={`${r.action}-${r.ref}`}
            tone="live"
            title={r.detail || r.action.replace(/_/g, ' ')}
            sub={[r.ref, `${Math.round(r.latency_ms)}ms`, r.mock ? 'mock' : null]
              .filter(Boolean)
              .join(' · ')}
          />
        ))}

        {clock && (
          <Link tone="breach" last>
            <div className="chain-title">{clock.customer}</div>
            <div className={`clock-face display${urgent ? ' is-urgent' : ''}`}>
              {fmtCountdown(clock.remaining_seconds)}
            </div>
            <div className="clock-meta">
              <span>
                notice under {clock.clause_ref} · {clock.window_hours}h
              </span>
              <span>due {hhmmUtc(clock.deadline_utc)}</span>
            </div>
            <div className="clock-track">
              <div
                className={`clock-track-fill${urgent ? ' is-urgent' : ''}`}
                style={{ width: `${(elapsed * 100).toFixed(3)}%` }}
              />
            </div>
          </Link>
        )}

        {!clock && ordered.length > 0 && (
          <Link last title="No contractual deadline" sub="no clause in range for this advisory" />
        )}
      </div>
    </section>
  );
}
