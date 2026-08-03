/**
 * The signature element.
 *
 * One ring per HOP_INTERVAL_MS. You watch the shockwave leave the package and
 * arrive at a contract clause — amber while it propagates, oxide when it lands
 * on the clause. On suppression the wave dies at hop 2 and the whole trace
 * turns teal. Hand-rolled SVG; honours prefers-reduced-motion; re-playable.
 *
 * Geometry is computed from the chain length (see layoutTrace), because a
 * fixture chain is 7 nodes and real graph data is 10 or more. Nothing here may
 * ever escape the panel and land on the agents column.
 */
import type { FocusView } from '@hopper/contracts';
import { fitLabel, layoutTrace, ordinalsAreHops } from '../lib/hops.js';
import type { HopWave } from '../lib/types.js';

function indexLabel(i: number, total: number, suppressed: boolean, numbered: boolean): string {
  if (i === 0) return 'PKG';
  if (!suppressed && i === total - 1) return 'CLAUSE';
  return numbered ? String(i).padStart(2, '0') : '';
}

function Terminal({ cx, cy, r, on }: { cx: number; cy: number; r: number; on: boolean }) {
  const h = r * 1.55;
  const w = r * 1.5;
  return (
    <path
      className={`hop-node is-terminal${on ? ' is-on' : ''}`}
      d={`M ${cx} ${cy - h} L ${cx + w} ${cy + h * 0.72} L ${cx - w} ${cy + h * 0.72} Z`}
    />
  );
}

export function HopPathViz({ wave, focus }: { wave: HopWave | null; focus: FocusView | null }) {
  const total = wave?.total ?? 0;
  const suppressed = wave?.suppressed === true;
  const arrived = wave?.arrived ?? 0;
  const nonce = wave?.nonce ?? 0;

  const L = layoutTrace(total);
  const { cy, radius: R, fontSize, maxChars } = L;

  // ring ordinals are shown only when they genuinely equal hop numbers
  const declaredHops = focus?.hop_paths?.[0]?.hops ?? 0;
  const numbered = ordinalsAreHops(total, declaredHops);

  const restingTicks = Array.from({ length: 7 }, (_, i) => 58 + i * ((L.width - 116) / 6));

  return (
    <div className="hop-stage">
      <svg
        className="hop-svg"
        viewBox={`0 0 ${L.width} ${L.height}`}
        role="img"
        aria-label={
          wave === null
            ? 'hop path — standing by'
            : suppressed
              ? 'hop path — suppressed, zero hops'
              : `hop path — ${wave.chain.filter(Boolean).join(' to ')}`
        }
      >
        {/* the instrument: a resting baseline and its graticule */}
        <line className="hop-baseline" x1={24} y1={cy} x2={L.width - 24} y2={cy} />
        {(total === 0 ? restingTicks : L.rings.map((r) => r.x)).map((tx, i) => (
          <line key={`t${i}`} className="hop-graticule" x1={tx} y1={cy - 34} x2={tx} y2={cy - 28} />
        ))}

        {/* connectors */}
        {L.rings.slice(0, -1).map((ring, i) => {
          const from = ring.x + R + 3;
          const to = L.rings[i + 1].x - R - 3;
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
              y1={cy}
              x2={to}
              y2={cy}
              strokeDasharray={len}
              strokeDashoffset={on ? 0 : len}
            />
          );
        })}

        {/* the probe that found nothing — a decaying tail, not an error */}
        {suppressed && arrived >= 2 && L.rings[1] && (
          <line
            className="hop-link is-suppressed is-on"
            x1={L.rings[1].x + R + 3}
            y1={cy}
            x2={L.rings[1].x + L.pitch * 0.75}
            y2={cy}
            strokeDasharray="2 7"
            strokeDashoffset={0}
            opacity={0.4}
          />
        )}

        {/* the probe — a wavefront that travels the structure rather than a
            row of dots switching on. This is the product in one image. */}
        {wave && L.rings[Math.max(0, arrived - 1)] && (
          <g
            className={[
              'probe-group',
              suppressed ? 'is-suppressed' : '',
              wave.terminal ? 'is-arrived' : '',
              wave.terminal || (suppressed && arrived >= total) ? 'is-spent' : '',
            ].join(' ')}
            style={{ transform: `translateX(${L.rings[Math.max(0, arrived - 1)].x}px)` }}
          >
            <line className="probe-streak" x1={-L.pitch * 0.5} y1={cy} x2={-R - 2} y2={cy} />
            <circle className="probe-halo" cx={0} cy={cy} r={R + 5} />
            <circle className="probe-core" cx={0} cy={cy} r={3.4} />
          </g>
        )}

        {/* rings */}
        {L.rings.map((ring) => {
          const i = ring.index;
          const on = arrived > i;
          const terminal = !suppressed && i === total - 1;
          const dead = suppressed && i === 1;
          const cls = [
            'hop-node',
            i === 0 ? 'is-origin' : '',
            suppressed ? 'is-suppressed' : '',
            dead ? 'is-dead' : '',
            on ? 'is-on' : '',
          ].join(' ');
          // the origin ring names the package, not the advisory id — some
          // server paths label hop 0 with the GHSA
          const raw = wave?.chain[i] || '';
          const label = fitLabel(
            i === 0 && /^GHSA-/i.test(raw) ? focus?.advisory?.package_name || raw : raw,
            maxChars,
          );
          return (
            <g key={`n${nonce}-${i}`}>
              {on && (
                <circle
                  key={`p${nonce}-${i}`}
                  className={`hop-pulse${terminal ? ' is-terminal' : ''}${suppressed ? ' is-suppressed' : ''}`}
                  cx={ring.x}
                  cy={cy}
                  r={R}
                />
              )}
              {/* arrival at the clause gets a second, slower ring — the beat */}
              {on && terminal && (
                <circle key={`i${nonce}`} className="hop-impact" cx={ring.x} cy={cy} r={R} />
              )}
              {terminal ? (
                <Terminal cx={ring.x} cy={cy} r={R} on={on} />
              ) : (
                <circle className={cls} cx={ring.x} cy={cy} r={R} />
              )}
              <text
                className={`hop-index${on ? ' is-on' : ''}`}
                x={ring.x}
                y={cy - 44}
                fontSize={Math.max(8, fontSize - 2)}
              >
                {indexLabel(i, total, suppressed, numbered)}
              </text>
              {/* a staggered caption gets a leader line back to its ring */}
              {ring.lowerRow && on && (
                <line
                  className="hop-leader"
                  x1={ring.x}
                  y1={cy + R + 3}
                  x2={ring.x}
                  y2={ring.labelY - fontSize}
                />
              )}
              <text
                className={[
                  'hop-label',
                  terminal ? 'is-terminal' : '',
                  suppressed ? 'is-suppressed' : '',
                  on ? 'is-on' : '',
                ].join(' ')}
                x={ring.labelX}
                y={ring.labelY}
                fontSize={fontSize}
              >
                {label}
              </text>
            </g>
          );
        })}

        {total === 0 && (
          <text className="hop-index" x={L.width / 2} y={cy + 46} fontSize={10}>
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

  const paths = focus?.hop_paths ?? [];
  const p = paths[0];
  if (!p) {
    return (
      <div className="hop-verdict is-breach">
        <span>CLAUSE REACHED</span>
      </div>
    );
  }

  // chain length and hop count legitimately differ on real data — say so, so
  // the two numbers on screen never look like a contradiction
  const nodes = p.chain?.length ?? 0;
  const shape = nodes > 0 && nodes - 2 !== p.hops ? `${nodes} nodes · ${p.hops} dependency hops` : null;

  return (
    <div className="hop-verdict is-breach">
      <span>
        {p.clause_ref} · {p.clause_type.replace(/_/g, ' ')} · {p.notice_window}h notice
      </span>
      <span className="hop-verdict-note mono">
        {[
          p.customer,
          paths.length > 1 ? `+${paths.length - 1} more` : null,
          p.contract_id,
          shape,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </div>
  );
}
