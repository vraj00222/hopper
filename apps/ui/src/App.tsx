/**
 * HOPPER — the Situation Room.
 *
 * Layout is §8: hop path over feed on the left, obligation / agents / actions /
 * audit on the right, the pipeline strip across the bottom. Nothing here knows
 * whether the data arrived over a websocket or off the fixture timeline.
 */
import { DEFAULT_APPROVER, HERO_GHSA, PRECEDENT_GHSA, SUPPRESSED_GHSA } from '@hopper/contracts';
import type { FocusView } from '@hopper/contracts';
import { ActionsPanel } from './components/ActionsPanel.js';
import { AgentsPanel } from './components/AgentsPanel.js';
import { AuditPanel } from './components/AuditPanel.js';
import { FeedPanel } from './components/FeedPanel.js';
import { Header } from './components/Header.js';
import { HopPathViz, HopVerdict } from './components/HopPathViz.js';
import { ObligationClock } from './components/ObligationClock.js';
import { PipelineStrip } from './components/PipelineStrip.js';
import { primaryClock } from './lib/reducer.js';
import { useHopper } from './lib/useHopper.js';
import type { HopWave } from './lib/types.js';

/** clicking a demo advisory in the feed re-runs its beat */
const BEAT_BY_GHSA = new Map<string, number>([
  [HERO_GHSA, 1],
  [SUPPRESSED_GHSA, 2],
  [PRECEDENT_GHSA, 3],
]);

function hopCount(wave: HopWave | null, focus: FocusView | null): { value: string; tone: string } {
  if (!wave) return { value: '—', tone: 'is-idle' };
  if (wave.suppressed) return { value: '0', tone: 'is-clear' };
  const declared = focus?.hop_paths[0]?.hops ?? Math.max(0, wave.total - 2);
  const shown = Math.max(0, Math.min(wave.arrived - 1, declared));
  return { value: String(shown), tone: wave.terminal ? 'is-breach' : '' };
}

export function App() {
  const { ui, mode, activeBeat, playedBeats, send, runBeat, reset, reducedMotion } = useHopper();
  const { app, wave, selection, prev_selection } = ui;
  const focus = app.focus;
  const clock = primaryClock(ui);
  const count = hopCount(wave, focus);

  return (
    <div className={`shell${reducedMotion ? ' no-motion' : ''}`}>
      <Header status={app.status} graph={app.graph_stats} mode={mode} />

      <div className="main">
        <div className="col-left">
          <section className="panel hop-panel">
            <div className="panel-head">
              <h2 className="panel-title">Hop path</h2>
              <span className="panel-note">
                {focus ? `${focus.advisory_class.id} · ${focus.advisory.ghsa_id}` : 'falkordb Q1'}
              </span>
            </div>

            <div className="hop-figure">
              <div className={`hop-count ${count.tone}`}>
                <span className="hop-count-n display">{count.value}</span>
                <span className="hop-count-label">HOPS</span>
              </div>
              <div className="hop-meta">
                {focus ? (
                  <>
                    <div className="hop-meta-line">
                      {focus.advisory.cve_id ?? focus.advisory.ghsa_id} · {focus.advisory.severity} ·
                      cvss {focus.advisory.cvss.toFixed(1)} · {focus.advisory.package_name}
                      {' '}{focus.advisory.vulnerable_range}
                    </div>
                    <div className="hop-meta-summary">{focus.advisory.summary}</div>
                  </>
                ) : (
                  <div className="hop-meta-line">waiting for an advisory</div>
                )}
              </div>
            </div>

            <HopPathViz wave={wave} focus={focus} />
            <HopVerdict wave={wave} focus={focus} />
          </section>

          <FeedPanel
            feed={app.feed}
            funnel={app.funnel}
            selectable={new Set(BEAT_BY_GHSA.keys())}
            onSelect={(id) => {
              const step = BEAT_BY_GHSA.get(id);
              if (step) runBeat(step);
            }}
          />
        </div>

        <div className="col-right">
          <ObligationClock tick={clock} />
          <AgentsPanel focus={focus} />
          <ActionsPanel
            receipts={app.receipts}
            approvals={app.approvals}
            onApprove={(id) =>
              send({ type: 'approve', approval_id: id, approver: DEFAULT_APPROVER })
            }
          />
          <AuditPanel audit={focus?.audit ?? []} />
        </div>
      </div>

      <PipelineStrip
        selection={selection}
        previous={prev_selection}
        trace={app.status.rocketride_trace}
      >
        <div className="demo-bar">
          <span className="demo-hint">beat</span>
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              className={[
                'demo-key',
                activeBeat === n ? 'is-active' : '',
                playedBeats.includes(n) && activeBeat !== n ? 'is-played' : '',
              ].join(' ')}
              onClick={() => send({ type: 'demo', step: n })}
              title={`Beat ${n} — keyboard ${n}`}
            >
              {n}
            </button>
          ))}
          <button type="button" className="demo-key" onClick={reset} title="Reset — keyboard 0">
            0
          </button>
        </div>
      </PipelineStrip>
    </div>
  );
}
