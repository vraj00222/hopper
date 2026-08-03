import { useMemo } from 'react';
import { Rise } from '../components';
import { useInView } from '../hooks';

/** 3,536 ticks. One tick is ten CVEs. Eight of them are the whole KEV list. */
const TICKS = 3536;
const KEV_AT = new Set([214, 601, 1042, 1488, 1875, 2337, 2803, 3311]);

function TickField() {
  const [ref, seen] = useInView<HTMLDivElement>('0px 0px -12% 0px');
  const ticks = useMemo(
    () =>
      Array.from({ length: TICKS }, (_, i) => (
        <i key={i} className={KEV_AT.has(i) ? 'kev' : undefined} />
      )),
    [],
  );

  return (
    <div ref={ref}>
      <div className={`field ${seen ? 'is-on' : ''}`} aria-hidden="true">
        {ticks}
      </div>
      <p className="field__key">
        <span>
          <i className="swatch" style={{ background: 'var(--line-hard)' }} />
          one tick = 10 CVEs published Jan–Jun 2026
        </span>
        <span>
          <i className="swatch" style={{ background: 'var(--c-signal)', height: 17 }} />
          the 85 that reached CISA KEV
        </span>
      </p>
    </div>
  );
}

export function Volume() {
  return (
    <section className="section band" id="volume">
      <div className="wrap">
        <div className="head">
          <span className="lbl head__eyebrow">volume</span>
          <h2>If everything is critical, your team stops reading.</h2>
          <p className="lead">
            Thirty-five thousand advisories arrived in six months. Eighty-five of them
            were ever used against anyone. Every tool you own is built to report the
            first number. None of them is built to get you down to the second one.
          </p>
        </div>

        <Rise>
          <TickField />
        </Rise>

        <div className="stats">
          <Rise className="stat">
            <span className="stat__v">
              35,364<em>CVEs</em>
            </span>
            <span className="stat__t">
              Published in the first half of 2026 — one every 7.4 minutes, and 49.5% more
              than the same period last year.
            </span>
          </Rise>
          <Rise className="stat" delay={90}>
            <span className="stat__v">0.24%</span>
            <span className="stat__t">
              Reached CISA's Known Exploited Vulnerabilities catalogue. Eighty-five, out
              of thirty-five thousand.
            </span>
          </Rise>
          <Rise className="stat" delay={180}>
            <span className="stat__v">
              29,000<em>queued</em>
            </span>
            <span className="stat__t">
              Entries in the National Vulnerability Database now marked "Not Scheduled".
              NIST moved to triage in April 2026. Nobody is coming to enrich them.
            </span>
          </Rise>
        </div>

        <Rise>
          <p className="rule" style={{ maxWidth: '30em' }}>
            The window is closing from both ends.
            <small>
              Median time to exploit: 32 days → 5. Median time to fix: 171 days → 252.
              Triage by severity cannot survive that arithmetic.
            </small>
          </p>
        </Rise>
      </div>
    </section>
  );
}
