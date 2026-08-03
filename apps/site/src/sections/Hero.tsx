import { useEffect, useState } from 'react';
import { HOP_INTERVAL_MS } from '@hopper/contracts';
import { HopTrack, Obligation, Status } from '../components';
import {
  CONSOLE_URL,
  ESCALATED_PATH,
  HERO,
  HOP_TOTAL,
  SUPPRESSED_PATH,
  hopsWalked,
} from '../data';
import { useHold, useStepper } from '../hooks';

/* The page runs one orchestrated sequence and these are its beats. The two
   traversals are deliberately not simultaneous: the escalation runs, lands on
   a clause and starts a clock, and only then — once the clock is visibly
   ticking — does the second advisory arrive and die one hop in. Played
   together they compete; played in order the second one is the argument. */
const ARM_MS = 600;
const HOLD_MS = 1700;
const STOP_BEAT_MS = 260;

export function Hero() {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), ARM_MS);
    return () => window.clearTimeout(t);
  }, []);

  const hit = useStepper(ESCALATED_PATH.length, HOP_INTERVAL_MS, armed);
  const landed = hit >= ESCALATED_PATH.length;

  const second = useHold(landed, HOLD_MS);
  const supp = useStepper(
    SUPPRESSED_PATH.length,
    HOP_INTERVAL_MS,
    second,
    STOP_BEAT_MS,
  );
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

          <div className="hero__panels">
            <div className="panel">
              <div className="panel__bar">
                <span className="lbl">
                  trace 01 · {HERO.advisory.cve_id}
                </span>
                <Status tone={landed ? 'breach' : hit === 0 ? 'idle' : 'live'}>
                  {landed ? 'obligation active' : hit === 0 ? 'standby' : 'propagating'}
                </Status>
              </div>

              <HopTrack rows={ESCALATED_PATH} reached={hit} terminal="breach" />

              <Obligation
                hours={HERO.windowHours}
                live={landed}
                hops={hopsWalked(hit)}
                total={HOP_TOTAL}
                customer={HERO.customer}
                clause={HERO.clause}
                contract={HERO.contract}
                regime={HERO.regime}
              />
            </div>

            <p className="hero__aside">
              Nobody installs <b>brace-expansion</b>. It arrives four layers down,
              through <b>minimatch</b> and <b>glob</b>, inside every JavaScript build
              tool on earth. The dangerous dependencies are the ones nobody chose.
            </p>

            <div className={`panel ${settled ? 'panel--clear' : ''}`}>
              <div className="panel__bar">
                <span className="lbl">
                  trace 02 · {HERO.suppressed.cve_id} · same minute
                </span>
                <Status tone={settled ? 'clear' : supp === 0 ? 'idle' : 'live'}>
                  {settled ? 'closed' : supp === 0 ? 'standby' : 'propagating'}
                </Status>
              </div>

              <HopTrack rows={SUPPRESSED_PATH} reached={supp} terminal="clear" />

              <div className={`verdict verdict--clear ${settled ? 'is-on' : ''}`}>
                <span className="verdict__flag">suppressed · zero hops</span>
                <p className="cta-note" style={{ marginTop: 8 }}>
                  CVSS 8.1, and it reaches nothing you ship. No service runs it, so no
                  customer is exposed and no clause applies. Written to the log. Nobody
                  is paged.
                </p>
                <p className="verdict__rate">99.76% of advisories end here.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
