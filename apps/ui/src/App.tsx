/**
 * HOPPER — the Situation Room.
 *
 * The layout tells the story in order: an advisory lands and its severity is
 * legible immediately, the graph is walked to find who is exposed, agents
 * deliberate and sometimes disagree, consequences follow as a chain, and one
 * action waits on a person.
 *
 * Each act carries data-lit, so only the act in play sits at full contrast. The
 * screen does one thing at a time; that is the whole design.
 *
 * Nothing here knows whether the data arrived over a websocket or off the
 * fixture timeline.
 */
import { DEFAULT_APPROVER, HERO_GHSA, PRECEDENT_GHSA, SUPPRESSED_GHSA } from '@hopper/contracts';
import type { FocusView } from '@hopper/contracts';
import { AgentsPanel } from './components/AgentsPanel.js';
import { AuditPanel } from './components/AuditPanel.js';
import { ConsequencePanel } from './components/ConsequencePanel.js';
import { FeedPanel } from './components/FeedPanel.js';
import { GatePanel } from './components/GatePanel.js';
import { Header } from './components/Header.js';
import { HopPathViz, HopVerdict } from './components/HopPathViz.js';
import { PipelineStrip } from './components/PipelineStrip.js';
import { currentSelection, hopCountFor, primaryClock, splitReceipts, traceWave } from './lib/reducer.js';
import { useHopper } from './lib/useHopper.js';
import type { HopWave, UiState } from './lib/types.js';

/** clicking a demo advisory in the feed re-runs its beat */
const BEAT_BY_GHSA = new Map<string, number>([
  [HERO_GHSA, 1],
  [SUPPRESSED_GHSA, 2],
  [PRECEDENT_GHSA, 3],
]);

type Act = 'advisory' | 'deliberation' | 'consequence' | 'gate';
const ORDER: Act[] = ['advisory', 'deliberation', 'consequence', 'gate'];

/**
 * Which act is in play, derived from the data rather than from a timer, so a
 * live server and the fixture stage identically.
 */
function currentAct(ui: UiState): Act {
  const { app, wave } = ui;
  const focus = app.focus;
  const verdicts = focus ? Object.keys(focus.verdicts).length : 0;
  const settled = verdicts >= 4 || wave?.suppressed === true;
  const gated = app.approvals.some(
    (a) => a.status === 'pending' && (!focus?.advisory || a.ghsa_id === focus.advisory.ghsa_id),
  );

  if (settled && gated) return 'gate';
  if (settled) return 'consequence';
  if (verdicts > 0) return 'deliberation';
  return 'advisory';
}

function litFor(act: Act, current: Act): 'past' | 'now' | 'future' {
  const a = ORDER.indexOf(act);
  const c = ORDER.indexOf(current);
  if (a === c) return 'now';
  return a < c ? 'past' : 'future';
}

const SEVERITY_LEVEL: Record<string, number> = { LOW: 0.25, MODERATE: 0.5, HIGH: 0.75, CRITICAL: 1 };

/** severity has to read in the first 200ms, so it is drawn as a level */
function severityFraction(focus: FocusView | null): number {
  const adv = focus?.advisory;
  if (!adv) return 0;
  if (Number.isFinite(adv.cvss) && adv.cvss > 0) return Math.min(1, adv.cvss / 10);
  return SEVERITY_LEVEL[String(adv.severity).toUpperCase()] ?? 0.5;
}

function AdvisoryHead({
  focus,
  count,
}: {
  focus: FocusView | null;
  count: { value: string; tone: string };
}) {
  const adv = focus?.advisory;
  // built from what is actually present — real payloads are missing fields
  const ident = adv
    ? [
        adv.cve_id ?? adv.ghsa_id,
        Number.isFinite(adv.cvss) ? `cvss ${adv.cvss.toFixed(1)}` : null,
        adv.package_name,
        adv.vulnerable_range,
      ]
        .filter(Boolean)
        .join('  ·  ')
    : '';

  return (
    <div className="adv">
      <div className={`hop-count ${count.tone}`}>
        <span className="hop-count-n display">{count.value}</span>
        <span className="hop-count-label">HOPS</span>
      </div>
      <div className="adv-body">
        {adv ? (
          <>
            <div className="sev" key={`${adv.ghsa_id}-sev`}>
              <span className="sev-track">
                <span
                  className="sev-fill"
                  style={{ width: `${(severityFraction(focus) * 100).toFixed(1)}%` }}
                />
              </span>
              <span className="sev-word">{adv.severity}</span>
              {adv.in_kev && <span className="sev-num">IN KEV</span>}
            </div>
            <div className="adv-line" key={`${adv.ghsa_id}-id`}>
              {ident}
            </div>
            <div className="adv-summary" key={`${adv.ghsa_id}-sum`}>
              {adv.summary}
            </div>
          </>
        ) : (
          <div className="adv-line">waiting for an advisory</div>
        )}
      </div>
    </div>
  );
}

/**
 * The number next to HOPS is `HopPath.hops` from the contract, counted up as
 * the probe travels and never derived from the ring count — a real chain
 * carries repo, service, customer and clause nodes on top of the dependency
 * edges, so 10 rings and 6 hops is correct rather than a contradiction.
 */
function hopDisplay(wave: HopWave | null, hops: number | null): { value: string; tone: string } {
  if (wave?.suppressed || hops === 0) return { value: '0', tone: 'is-clear' };
  if (hops === null) return { value: '—', tone: 'is-idle' };
  if (!wave) return { value: String(hops), tone: '' };
  const shown = wave.terminal ? hops : Math.max(0, Math.min(wave.arrived - 1, hops));
  return { value: String(shown), tone: wave.terminal ? 'is-breach' : '' };
}

export function App() {
  const { ui, mode, activeBeat, playedBeats, send, runBeat, reset, reducedMotion } = useHopper();
  const { app, prev_selection } = ui;
  const wave = traceWave(ui);
  const selection = currentSelection(ui);
  const focus = app.focus;
  const clock = primaryClock(ui);
  const act = currentAct(ui);
  const { executed } = splitReceipts(app.receipts, app.approvals);
  const count = hopDisplay(wave, hopCountFor(ui));

  return (
    <div className={`shell${reducedMotion ? ' no-motion' : ''}`} data-stage={act}>
      <Header status={app.status} graph={app.graph_stats} mode={mode} />

      <div className="main">
        <div className="col-left">
          <section
            className={`panel${wave?.terminal ? ' is-breach' : ''}${wave?.suppressed ? ' is-clear' : ''}`}
            data-lit={litFor('advisory', act)}
          >
            <div className="panel-head">
              <h2 className="label">Advisory</h2>
              <span className="panel-note">
                {focus
                  ? `${focus.advisory_class?.id ?? ''} · ${focus.advisory?.ghsa_id ?? ''}`
                  : 'standing by'}
              </span>
            </div>

            <AdvisoryHead focus={focus} count={count} />
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
          <AgentsPanel focus={focus} lit={litFor('deliberation', act)} />
          <ConsequencePanel clock={clock} executed={executed} lit={litFor('consequence', act)} />
          <GatePanel
            receipts={app.receipts}
            approvals={app.approvals}
            onApprove={(id) =>
              send({ type: 'approve', approval_id: id, approver: DEFAULT_APPROVER })
            }
            lit={litFor('gate', act)}
            isGate={act === 'gate'}
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
