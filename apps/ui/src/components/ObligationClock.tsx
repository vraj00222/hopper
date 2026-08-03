/**
 * The obligation clock. 1Hz off ClockTick, rendered with fmtCountdown from the
 * contract. Archivo Expanded — the only display type on the page besides the
 * hop count. Goes oxide under four hours.
 */
import { fmtCountdown } from '@hopper/contracts';
import type { ClockTick } from '@hopper/contracts';
import { CLOCK_ALARM_SECONDS } from '../lib/reducer.js';

function hhmmUtc(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export function ObligationClock({ tick }: { tick: ClockTick | null }) {
  const urgent = tick !== null && tick.remaining_seconds <= CLOCK_ALARM_SECONDS;
  const elapsed = tick
    ? Math.min(1, Math.max(0, 1 - tick.remaining_seconds / (tick.window_hours * 3600)))
    : 0;

  return (
    <section className="panel clock-panel">
      <div className="panel-head">
        <h2 className="panel-title">Obligation</h2>
        <span className="panel-note">contract graph</span>
      </div>

      <div className={`clock-box${urgent ? ' is-urgent' : ''}`}>
        <div className="clock-customer">
          {tick ? tick.customer.toUpperCase() : 'NO OPEN OBLIGATION'}
        </div>
        <div className={`clock-face display${urgent ? ' is-urgent' : ''}${tick ? '' : ' is-idle'}`}>
          {tick ? fmtCountdown(tick.remaining_seconds) : 'STANDING BY'}
        </div>
        <div className="clock-sub">
          <span>
            {tick
              ? `contractual notice · ${tick.window_hours}h · ${tick.clause_ref}`
              : 'no clause in range'}
          </span>
          <span>{tick ? `due ${hhmmUtc(tick.deadline_utc)}` : ''}</span>
        </div>
        <div className="clock-track">
          <div
            className={`clock-track-fill${urgent ? ' is-urgent' : ''}`}
            style={{ width: `${(elapsed * 100).toFixed(3)}%` }}
          />
        </div>
      </div>
    </section>
  );
}
