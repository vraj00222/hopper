import type { AppState } from '@hopper/contracts';
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

export function Header({ status, graph, mode }: {
  status: AppState['status'];
  graph: AppState['graph_stats'];
  mode: Mode;
}) {
  const s = statusCopy(mode);
  return (
    <header className="header">
      <span className="wordmark">HOPPER</span>
      <div className="header-stats">
        <span className={`status ${s.klass}`}>
          <span className="status-dot" />
          {s.word}
        </span>
        <span className="sep">·</span>
        <span>{n(status.advisories_24h)} advisories/24h</span>
        <span className="sep">·</span>
        <span>{n(status.kev_count)} in KEV</span>
        <span className="sep">·</span>
        <span>
          {n(graph.nodes)} nodes / {n(graph.edges)} edges
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
