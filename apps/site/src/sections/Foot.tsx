import { CONSOLE_URL, SOURCES } from '../data';

export function Foot() {
  return (
    <footer className="section foot band">
      <div className="wrap">
        <div className="foot__grid">
          <div style={{ display: 'grid', gap: 22, alignContent: 'start' }}>
            <h2 style={{ fontSize: 'clamp(1.5rem, 2.4vw, 2rem)' }}>
              Walk one advisory end to end.
            </h2>
            <p className="body" style={{ fontSize: 15.5 }}>
              The console replays a real traversal against a real dependency graph —
              suppression, escalation, the hop path and the clock. It runs locally and
              needs nothing connected.
            </p>
            <div className="cta-row">
              <a className="btn btn--solid" href={CONSOLE_URL}>
                <span className="btn__tick" />
                Open the console
              </a>
            </div>
          </div>

          <div>
            <span className="lbl" style={{ marginBottom: 16 }}>
              sources
            </span>
            <ol className="srcs">
              {SOURCES.map((s) => (
                <li key={s}>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="foot__end">
          <span className="mark" style={{ fontSize: 12 }}>
            HOPPER
          </span>
          <span>Every alert is five hops from a customer.</span>
          <span style={{ marginLeft: 'auto' }}>console on :5173 · site on :5174</span>
        </div>
      </div>
    </footer>
  );
}
