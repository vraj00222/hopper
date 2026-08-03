import { Rise } from '../components';
import { PLANS } from '../data';

export function Plans() {
  return (
    <section className="section band" id="plans">
      <div className="wrap">
        <div className="head">
          <span className="lbl head__eyebrow">plans</span>
          <p className="prowline">
            Dependabot opens <i>40</i> pull requests a month. Hopper opens <i>2</i>.
          </p>
          <p className="lead">
            You are not paying for detection — detection is free and there is far too much
            of it. You are paying for the thirty-eight it decided not to show you, and for
            the two it can prove reach a customer.
          </p>
        </div>

        <div>
          {PLANS.map((p, i) => (
            <Rise key={p.name} delay={i * 60}>
              <div className={`plan ${p.accent ? 'plan--pick' : ''}`}>
                <span>
                  <span className="plan__n">{p.name}</span>
                  <span className="plan__note">{p.note}</span>
                </span>
                <span className="plan__p">
                  {p.price}
                  {p.unit ? <em>{p.unit}</em> : null}
                </span>
                <span className="plan__l">
                  {p.lines.map((l) => (
                    <span key={l}>{l}</span>
                  ))}
                </span>
              </div>
            </Rise>
          ))}
        </div>

        <Rise>
          <p className="body" style={{ marginTop: 28 }}>
            The customer and contract graph starts on Team, because that is the layer that
            produces a legal deadline. Everything below it is engineering hygiene and
            should be cheap.
          </p>
        </Rise>
      </div>
    </section>
  );
}
