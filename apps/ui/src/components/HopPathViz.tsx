/**
 * The signature element.
 *
 * One ring per HOP_INTERVAL_MS. You watch the shockwave leave the package and
 * arrive at a contract clause — amber while it propagates, oxide when it lands
 * on the clause. On suppression the wave dies at hop 2 and the whole trace
 * turns teal. Hand-rolled SVG; honours prefers-reduced-motion; re-playable.
 */
import type { FocusView } from '@hopper/contracts';
import type { HopWave } from '../lib/types.js';

const VB_W = 1000;
const VB_H = 190;
const PAD = 70;
/** slot pitch is fixed at the 7-node layout, so a shallower path draws a
 *  visibly shorter trace instead of stretching to fill the panel */
const PITCH = (VB_W - PAD * 2) / 6;
const CY = 96;
const R = 11;

function x(i: number): number {
  return PAD + i * PITCH;
}

function indexLabel(i: number, total: number, suppressed: boolean): string {
  if (i === 0) return 'PKG';
  if (!suppressed && i === total - 1) return 'CLAUSE';
  return String(i).padStart(2, '0');
}

function Terminal({ cx, on }: { cx: number; on: boolean }) {
  const h = R * 1.55;
  const w = R * 1.5;
  return (
    <path
      className={`hop-node is-terminal${on ? ' is-on' : ''}`}
      d={`M ${cx} ${CY - h} L ${cx + w} ${CY + h * 0.72} L ${cx - w} ${CY + h * 0.72} Z`}
    />
  );
}

export function HopPathViz({ wave, focus }: { wave: HopWave | null; focus: FocusView | null }) {
  const total = wave?.total ?? 0;
  const suppressed = wave?.suppressed === true;
  const arrived = wave?.arrived ?? 0;
  const nonce = wave?.nonce ?? 0;

  const ticks = Array.from({ length: 7 }, (_, i) => x(i));

  return (
    <div className="hop-stage">
      <svg className="hop-svg" viewBox={`0 0 ${VB_W} ${VB_H}`} role="img"
        aria-label={
          wave === null
            ? 'hop path — standing by'
            : suppressed
              ? 'hop path — suppressed, zero hops'
              : `hop path — ${wave.chain.filter(Boolean).join(' to ')}`
        }
      >
        {/* the instrument: a resting baseline and its graticule */}
        <line className="hop-baseline" x1={24} y1={CY} x2={VB_W - 24} y2={CY} />
        {ticks.map((tx, i) => (
          <line key={`t${i}`} className="hop-graticule" x1={tx} y1={CY - 34} x2={tx} y2={CY - 28} />
        ))}

        {/* connectors */}
        {Array.from({ length: Math.max(0, total - 1) }, (_, i) => {
          const from = x(i) + R + 4;
          const to = x(i + 1) - R - 4;
          const len = Math.max(1, to - from);
          const on = arrived > i + 1;
          const terminal = !suppressed && i + 1 === total - 1;
          return (
            <line
              key={`l${nonce}-${i}`}
              className={[
                'hop-link',
                on ? 'is-on' : '',
                terminal ? 'is-terminal' : '',
                suppressed ? 'is-suppressed' : '',
              ].join(' ')}
              x1={from}
              y1={CY}
              x2={to}
              y2={CY}
              strokeDasharray={len}
              strokeDashoffset={on ? 0 : len}
            />
          );
        })}

        {/* the probe that found nothing — a decaying tail, not an error */}
        {suppressed && arrived >= 2 && (
          <line
            className="hop-link is-suppressed is-on"
            x1={x(1) + R + 4}
            y1={CY}
            x2={x(1) + PITCH * 0.75}
            y2={CY}
            strokeDasharray="2 7"
            strokeDashoffset={0}
            opacity={0.4}
          />
        )}

        {/* rings */}
        {Array.from({ length: total }, (_, i) => {
          const on = arrived > i;
          const terminal = !suppressed && i === total - 1;
          const dead = suppressed && i === 1;
          const cx = x(i);
          const cls = [
            'hop-node',
            i === 0 ? 'is-origin' : '',
            suppressed ? 'is-suppressed' : '',
            dead ? 'is-dead' : '',
            on ? 'is-on' : '',
          ].join(' ');
          return (
            <g key={`n${nonce}-${i}`}>
              {on && (
                <circle
                  key={`p${nonce}-${i}`}
                  className={`hop-pulse${terminal ? ' is-terminal' : ''}${suppressed ? ' is-suppressed' : ''}`}
                  cx={cx}
                  cy={CY}
                  r={R}
                />
              )}
              {terminal ? <Terminal cx={cx} on={on} /> : <circle className={cls} cx={cx} cy={CY} r={R} />}
              <text
                className={`hop-index${on ? ' is-on' : ''}`}
                x={cx}
                y={CY - 46}
              >
                {indexLabel(i, total, suppressed)}
              </text>
              <text
                className={[
                  'hop-label',
                  terminal ? 'is-terminal' : '',
                  suppressed ? 'is-suppressed' : '',
                  on ? 'is-on' : '',
                ].join(' ')}
                x={cx}
                y={CY + 46}
              >
                {wave?.chain[i] || ''}
              </text>
            </g>
          );
        })}

        {total === 0 && (
          <text className="hop-index" x={VB_W / 2} y={CY + 46}>
            STANDING BY · PRESS 1
          </text>
        )}
      </svg>
    </div>
  );
}

/** the line under the trace: the verdict in one sentence, or nothing */
export function HopVerdict({ wave, focus }: { wave: HopWave | null; focus: FocusView | null }) {
  if (!wave) return <div className="hop-verdict" />;
  if (wave.suppressed) {
    const a = focus?.absence;
    return (
      <div className="hop-verdict">
        <span>{a?.statement ?? 'SUPPRESSED · zero hops from any repo'}</span>
        {a && (
          <span className="hop-verdict-note mono">
            {a.repos_checked} repos checked · depth {a.max_depth} · {a.paths} paths
          </span>
        )}
      </div>
    );
  }
  if (!wave.terminal) return <div className="hop-verdict" />;
  const p = focus?.hop_paths[0];
  return (
    <div className="hop-verdict is-breach">
      <span>
        {p ? `${p.clause_ref} · ${p.clause_type.replace('_', ' ')} · ${p.notice_window}h notice` : 'CLAUSE REACHED'}
      </span>
      {p && (
        <span className="hop-verdict-note mono">
          {p.customer} · {p.contract_id} · {p.governing_law}
        </span>
      )}
    </div>
  );
}
