/**
 * The meta reveal, on one line. RocketRide pipelines are nodes in FalkorDB and
 * the graph picks which one runs — so when beat 3 runs a different pipeline
 * than beat 1, that change has to be legible from the back of the room.
 */
import { pct } from '@hopper/contracts';
import type { Selection } from '../lib/types.js';

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function PipelineStrip({
  selection,
  previous,
  trace,
  children,
}: {
  selection: Selection | null;
  previous: Selection | null;
  trace: string;
  children?: React.ReactNode;
}) {
  const changed =
    selection !== null && previous !== null && previous.pipeline_id !== selection.pipeline_id;

  return (
    <footer className={`strip${changed ? ' is-changed' : ''}`}>
      <span className="label">Pipeline</span>

      {selection ? (
        <>
          <span className="strip-selection mono">
            <span className="strip-class">{selection.advisory_class}</span>
            <span className="strip-arrow">&rarr;</span>
            <span className="strip-pipe">
              {selection.pipeline_id} · {selection.name}
            </span>
            <span className="strip-perf">
              ({pct(selection.success_rate)} · {seconds(selection.avg_latency)})
            </span>
          </span>
          {changed && previous && (
            <span className="strip-was mono" key={selection.pipeline_id}>
              was {previous.pipeline_id}
            </span>
          )}
          <span className="strip-reason">{selection.reason}</span>
        </>
      ) : (
        <span className="strip-reason">no pipeline selected</span>
      )}

      <a className="vlink" href={trace} target="_blank" rel="noreferrer">
        RocketRide &#9656;
      </a>

      {children}
    </footer>
  );
}
