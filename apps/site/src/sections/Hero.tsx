import { useEffect, useState } from 'react';
import { HOP_INTERVAL_MS } from '@hopper/contracts';
import { Countdown, HopTrack } from '../components';
import { CONSOLE_URL, ESCALATED_PATH, HERO, SUPPRESSED_PATH } from '../data';
import { useStepper } from '../hooks';

export function Hero() {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), 420);
    return () => window.clearTimeout(t);
  }, []);

  const hit = useStepper(ESCALATED_PATH.length, HOP_INTERVAL_MS, armed);
  const supp = useStepper(SUPPRESSED_PATH.length, HOP_INTERVAL_MS, armed);

  const landed = hit >= ESCALATED_PATH.length;
  const settled = supp >= SUPPRESSED_PATH.length;

  return (
    <section className="section hero" id="signal">
      <div className="wrap">
        <div className="hero__grid">
          <div className="hero__copy">
            <p className="hero__stamp">
              <span className="dot" />
              npm advisory feed
              <span aria-hidden="true">·</span>
              <b>{HERO.advisory.cve_id}</b>
              <span aria-hidden="true">·</span>
              published 16:35:32Z
            </p>

            <h1>
              Every alert is five hops from a customer.
              <span className="hero__rebut">Nobody walks them.</span>
            </h1>

            <p className="lead">
              Hopper walks them. Down the transitive dependency tree, into the service
              that ships it, out to the customer who bought that service, and into the
              notice clause in their contract. Then it starts the clock you are
              contractually on.
            </p>

            <div className="cta-row">
              <a className="btn btn--solid" href={CONSOLE_URL}>
                <span className="btn__tick" />
                Open the console
              </a>
              <a className="btn" href="#adoption">
                See what adoption costs
              </a>
            </div>

            <p className="cta-note">
              No SDK. Nothing in your runtime. Read access to lockfiles, and the graph
              builds itself.
            </p>
          </div>

          <div className="panel">
            <div className="panel__bar">
              <span className="lbl">traversal · advisory → clause</span>
              <span className="mono">{HERO.advisory.ghsa_id}</span>
            </div>

            <HopTrack rows={ESCALATED_PATH} reached={hit} terminal="breach" />

            <div className={`verdict verdict--breach ${landed ? 'is-on' : ''}`}>
              <span className="lbl">
                notice due — {HERO.customer} · {HERO.clause}
              </span>
              <Countdown hours={HERO.windowHours} live={landed} />
            </div>

            <div className="panel__sub">
              <span className="lbl">same minute · second advisory</span>
              <span className="mono">{HERO.suppressed.cve_id}</span>
            </div>

            <HopTrack rows={SUPPRESSED_PATH} reached={supp} terminal="clear" />

            <div className={`verdict verdict--clear ${settled ? 'is-on' : ''}`}>
              <span className="verdict__flag">suppressed · zero hops</span>
              <p className="cta-note" style={{ marginTop: 8 }}>
                CVSS 8.1, and it reaches nothing you ship. Written to the log. Nobody is
                paged. This is what happens to 99% of them.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
