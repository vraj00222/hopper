import { Rise } from '../components';
import { REGIMES, SYSTEMS } from '../data';

export function Join() {
  return (
    <section className="section band" id="join">
      <div className="wrap">
        <div className="head">
          <span className="lbl head__eyebrow">join</span>
          <h2>Four systems that have never shared a database.</h2>
          <p className="lead">
            The answer you need is a join across your build output, your platform, your
            revenue team and your legal agreements. Hopper holds all four as one graph
            and walks it. That is the entire product.
          </p>
        </div>

        <div className="tbl">
          {SYSTEMS.map((s, i) => (
            <Rise key={s.band} delay={i * 60}>
              <div className="trow">
                <span className="trow__band">{s.band}</span>
                <span className="trow__c trow__c--strong">{s.reads}</span>
                <span className="trow__c">{s.gives}</span>
                <span className="trow__src">{s.from}</span>
              </div>
            </Rise>
          ))}
        </div>

        <Rise>
          <p className="joinline">
            Nothing else in your stack can see all four at once. That is why the answer
            takes three days and four people, and why it usually arrives after the
            deadline it was needed for.
          </p>
        </Rise>

        <div className="head" style={{ marginTop: 'clamp(56px, 6vw, 88px)' }}>
          <span className="lbl head__eyebrow">the deadlines you are already under</span>
        </div>

        <div className="regimes">
          {REGIMES.map((r) => (
            <div className="regime" key={r.name}>
              <span className="regime__n">{r.name}</span>
              <span className="regime__w num">{r.window}</span>
              <span className="regime__s">{r.scope}</span>
            </div>
          ))}
        </div>

        <Rise>
          <p className="body" style={{ marginTop: 26, maxWidth: '46em' }}>
            These run in parallel with whatever your own contracts say, and the shortest
            one wins. Hopper records the window per customer, so the clock that appears is
            the one that actually binds you — not the most generous one.
          </p>
        </Rise>
      </div>
    </section>
  );
}
