/**
 * Act 2 — deliberation.
 *
 * Four agents, shown working before they are shown deciding. A row that has not
 * reported yet carries a scan, not a dash, because "thinking" and "nothing
 * here" are different states and the screen should say which.
 *
 * The disagreement is drawn as structure: when the arbiter records a conflict,
 * a bracket ties the two rows that disagree together in the gutter. That is
 * read straight off the verdicts rather than decorating the oxide label.
 */
import { useEffect, useRef } from 'react';
import type { AgentBusEvent, FocusView } from '@hopper/contracts';

type Key = 'reachability' | 'patch' | 'obligation' | 'arbiter';

const ROWS: Array<[Key, string]> = [
  ['reachability', 'Reachability'],
  ['patch', 'Patch engineer'],
  ['obligation', 'Obligation'],
  ['arbiter', 'Arbiter'],
];

const BUS_TAG: Record<string, string> = {
  reachability: 'REACH',
  'patch-engineer': 'PATCH',
  'obligation-officer': 'OBLIG',
  arbiter: 'ARBIT',
};

const BUS_ROW: Record<string, Key> = {
  reachability: 'reachability',
  'patch-engineer': 'patch',
  'obligation-officer': 'obligation',
  arbiter: 'arbiter',
};

function Transcript({ events }: { events: AgentBusEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div className="transcript scroll" ref={ref}>
      {events.length === 0 && <div className="empty">bus quiet</div>}
      {events.map((e, i) => (
        <div key={`${e.agent}-${e.phase}-${i}`} className={`transcript-line is-${e.phase}`}>
          <span className="transcript-agent">
            {String(i + 1).padStart(2, '0')} {BUS_TAG[e.agent] ?? e.agent}
          </span>
          <span className="transcript-msg">{e.message}</span>
        </div>
      ))}
    </div>
  );
}

export function AgentsPanel({ focus, lit }: { focus: FocusView | null; lit: string }) {
  const verdicts = focus?.verdicts ?? {};
  const transcript = focus?.transcript ?? [];

  // an agent that has spoken on the bus but not yet returned a verdict is
  // working — that is the state worth showing
  const working = new Set<Key>();
  for (const e of transcript) {
    const row = BUS_ROW[e.agent];
    if (row && !verdicts[row]) working.add(row);
  }

  const settled = ROWS.filter(([k]) => verdicts[k]).length;
  const dissent = verdicts.patch?.conflict === true;
  const rowPct = 100 / ROWS.length;

  return (
    <section className="panel" data-lit={lit}>
      <div className="panel-head">
        <h2 className="label">Deliberation</h2>
        <span className="panel-note">
          Guild · {settled}/4{dissent ? ' · dissent' : ''}
        </span>
      </div>

      <div className="agent-rows">
        {/* the bracket spans reachability..patch — the two that disagree */}
        {dissent && (
          <>
            <div className="dissent" style={{ top: '3%', height: `${rowPct * 2 - 6}%` }} />
            <div className="dissent-tag" style={{ left: 9, top: '11%' }}>
              DISSENT
            </div>
          </>
        )}

        {ROWS.map(([key, label]) => {
          const v = verdicts[key];
          const isWorking = !v && working.has(key);
          const conflict = key === 'patch' && verdicts.patch?.conflict === true;
          const calm =
            (key === 'arbiter' && (v?.verdict ?? '').toUpperCase().includes('SUPPRESS')) ||
            (v?.verdict ?? '').toUpperCase().startsWith('NOT REACHABLE');

          return (
            <div
              key={key}
              className={[
                'agent-row',
                v ? 'is-settled' : 'is-idle',
                conflict ? 'is-conflict' : '',
                calm ? 'is-clear' : '',
              ].join(' ')}
            >
              <span />
              <span className="agent-name">{label}</span>
              <span className="agent-verdict">
                {v ? v.verdict : isWorking ? <span className="agent-working" /> : '—'}
              </span>
              <span className="agent-conf">{v ? v.confidence.toFixed(2) : ''}</span>
              {v && <span className="agent-detail">{v.detail}</span>}
            </div>
          );
        })}
      </div>

      <Transcript events={transcript} />
    </section>
  );
}
