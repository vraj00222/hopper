/**
 * The header carries the identity of the advisory in focus, not a row of
 * counters:
 *
 *   HOPPER │ CVE-2026-69152  ▁▃▅▇ HIGH 7.5  brace-expansion < 1.1.18
 *
 * Counters do not change while you watch and none of them tells you what you
 * are looking at. This line does, and it stays put while every panel below it
 * restages — so the answer to "what is on screen right now" never scrolls away.
 *
 * Everything here is defensive about missing fields, because a live advisory is
 * routinely missing a CVE id, a CVSS score, or a version range, and the header
 * has to stay a straight line when they are absent.
 */
import type { AppState, FocusView } from '@hopper/contracts';
import type { Mode } from '../lib/types.js';

const n = (v: number) => v.toLocaleString('en-US');

/** the marketing surface lives in its own workspace on 5174 */
const SITE_URL = 'http://localhost:5174';

/**
 * The status word is the honest one: `live` only when a websocket is actually
 * open. Replaying the fixture says so.
 */
function statusCopy(mode: Mode): { word: string; klass: string } {
  if (mode === 'live') return { word: 'live', klass: 'is-live' };
  if (mode === 'connecting') return { word: 'connecting', klass: 'is-connecting' };
  return { word: 'replay · fixture', klass: 'is-replay' };
}

/** a severity is one of four things, not a position on a continuum, so it is
 *  drawn as a count of four rising bars rather than as a filled track */
const SEVERITY_TICKS: Record<string, number> = { LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4 };

function severity(focus: FocusView | null): { ticks: number; tone: string; label: string } {
  const adv = focus?.advisory;
  if (!adv) return { ticks: 0, tone: '', label: '' };

  const word = String(adv.severity ?? '').toUpperCase();
  const scored = Number.isFinite(adv.cvss) && adv.cvss > 0;

  // prefer the score when there is one — 7.5 and 9.4 are both alarming by word
  // and very different by obligation
  const ticks = scored
    ? adv.cvss >= 9
      ? 4
      : adv.cvss >= 7
        ? 3
        : adv.cvss >= 4
          ? 2
          : 1
    : (SEVERITY_TICKS[word] ?? 2);

  const tone = ticks >= 3 ? 'is-breach' : ticks === 1 ? 'is-clear' : '';
  const label = [word || null, scored ? adv.cvss.toFixed(1) : null].filter(Boolean).join(' ');
  return { ticks, tone, label };
}

function SeverityMeter({ ticks, tone }: { ticks: number; tone: string }) {
  return (
    <span className={`sev-meter ${tone}`} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={`sev-tick${i < ticks ? ' is-on' : ''}`} />
      ))}
    </span>
  );
}

export function Header({
  status,
  graph,
  mode,
  focus,
}: {
  status: AppState['status'];
  graph: AppState['graph_stats'];
  mode: Mode;
  focus: FocusView | null;
}) {
  const s = statusCopy(mode);
  const adv = focus?.advisory;
  const sev = severity(focus);

  // package and range read as one token; either may be missing on a live payload
  const subject = adv ? [adv.package_name, adv.vulnerable_range].filter(Boolean).join(' ') : '';

  return (
    <header className="header">
      <span className="wordmark">HOPPER</span>
      <span className="head-rule" />

      {adv ? (
        <div className="head-id" key={adv.ghsa_id}>
          <span className="head-cve mono">{adv.cve_id || adv.ghsa_id}</span>
          <SeverityMeter ticks={sev.ticks} tone={sev.tone} />
          {sev.label && <span className={`head-sev ${sev.tone}`}>{sev.label}</span>}
          {subject && <span className="head-subject">{subject}</span>}
          {adv.in_kev && <span className="head-kev">IN KEV</span>}
        </div>
      ) : (
        <span className="head-idle">standing by · no advisory in focus</span>
      )}

      <div className="header-stats">
        <span className={`status ${s.klass}`}>
          <span className="status-dot" />
          {s.word}
        </span>
        <span className="sep">·</span>
        <span>{n(status.advisories_24h)}/24h</span>
        <span className="sep">·</span>
        <span>{n(status.kev_count)} KEV</span>
        <span className="sep">·</span>
        <span>
          {n(graph.nodes)}n / {n(graph.edges)}e
        </span>
      </div>

      <nav className="vendor-links">
        <a className="vlink" href={status.falkor_ui} target="_blank" rel="noreferrer">
          FalkorDB &#9656;
        </a>
        <a className="vlink" href={status.rocketride_trace} target="_blank" rel="noreferrer">
          RocketRide &#9656;
        </a>
        {/* the operator already knows what Hopper is; this is just a way out */}
        <a className="vlink" href={SITE_URL} target="_blank" rel="noreferrer">
          Overview &#9656;
        </a>
      </nav>
    </header>
  );
}
