/**
 * The four verdicts, arriving one at a time, with the agent bus underneath.
 * The CONFLICT row is the beat that wins — the Patch Engineer disagreeing, in
 * oxide, citing a precedent this system wrote ninety seconds ago.
 */
import { useEffect, useRef } from 'react';
import type { AgentBusEvent, FocusView } from '@hopper/contracts';

type Row = {
  key: 'reachability' | 'patch' | 'obligation' | 'arbiter';
  label: string;
  verdict?: { verdict: string; confidence: number; detail: string; conflict?: boolean };
};

const LABELS: Array<[Row['key'], string]> = [
  ['reachability', 'Reachability'],
  ['patch', 'Patch Eng.'],
  ['obligation', 'Obligation'],
  ['arbiter', 'Arbiter'],
];

/** a drawn mark, not a dingbat — nothing on this page is an emoji */
function ConflictMark() {
  return (
    <svg className="conflict-mark" width="11" height="10" viewBox="0 0 11 10" aria-hidden="true">
      <path
        d="M5.5 0.6 L10.6 9.4 H0.4 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M5.5 3.6 V6.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function rowClass(r: Row): string {
  if (!r.verdict) return 'is-pending';
  if (r.verdict.conflict === true) return 'is-conflict';
  if (r.key === 'arbiter' && r.verdict.verdict.toUpperCase().includes('SUPPRESS')) return 'is-clear';
  if (r.verdict.verdict.toUpperCase().startsWith('NOT REACHABLE')) return 'is-clear';
  return '';
}

/** fixed-width agent tags keep the bus reading like a tape, not a chat log */
const BUS_TAG: Record<string, string> = {
  reachability: 'REACH',
  'patch-engineer': 'PATCH',
  'obligation-officer': 'OBLIG',
  arbiter: 'ARBIT',
};

function Transcript({ events }: { events: AgentBusEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div className="transcript scroll" ref={ref}>
      {events.length === 0 && <div className="empty">agent bus idle</div>}
      {events.map((e, i) => (
        <div
          key={`${e.agent}-${e.phase}-${i}`}
          className={`transcript-line is-${e.phase}`}
        >
          <span className="transcript-agent">
            {String(i + 1).padStart(2, '0')} {BUS_TAG[e.agent] ?? e.agent}
          </span>
          <span className="transcript-msg">
            {e.message}
            {typeof e.confidence === 'number' ? `  ${e.confidence.toFixed(2)}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

export function AgentsPanel({ focus }: { focus: FocusView | null }) {
  const rows: Row[] = LABELS.map(([key, label]) => ({
    key,
    label,
    verdict: focus?.verdicts[key],
  }));
  const arrived = rows.filter((r) => r.verdict);

  return (
    <section className="panel agents-panel">
      <div className="panel-head">
        <h2 className="panel-title">Agents</h2>
        <span className="panel-note">
          via Guild {arrived.length > 0 ? `· ${arrived.length}/4` : ''}
        </span>
      </div>

      <div className="agent-rows">
        {rows.map((r) =>
          r.verdict ? (
            <div key={r.key} className={`agent-row ${rowClass(r)}`}>
              <span className="agent-caret">&#9656;</span>
              <span className="agent-name">{r.label}</span>
              <span className="agent-verdict">
                {r.verdict.conflict === true && <ConflictMark />}
                {r.verdict.verdict}
              </span>
              <span className="agent-conf">{r.verdict.confidence.toFixed(2)}</span>
              <span className="agent-detail">{r.verdict.detail}</span>
            </div>
          ) : (
            <div key={r.key} className="agent-row is-pending">
              <span className="agent-caret">&#9656;</span>
              <span className="agent-name">{r.label}</span>
              <span className="agent-verdict">&mdash;</span>
              <span className="agent-conf" />
            </div>
          ),
        )}
      </div>

      <Transcript events={focus?.transcript ?? []} />
    </section>
  );
}
