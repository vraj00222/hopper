import { Rise } from '../components';
import { CHANNELS } from '../data';
import { useInView } from '../hooks';

function Channel({
  name,
  question,
  reach,
  stop,
  us,
}: {
  name: string;
  question: string;
  reach: number;
  stop: string;
  us: boolean;
}) {
  const [ref, seen] = useInView<HTMLDivElement>('0px 0px -20% 0px');
  return (
    <div ref={ref} className={`chan ${us ? 'chan--us' : ''}`}>
      <div>
        <span className="lbl">{name}</span>
        <p className="chan__q">{question}</p>
      </div>
      <div className="chan__scale">
        <div className="chan__cells" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <b
              key={i}
              className={seen && i < reach ? 'on' : undefined}
              style={{ transitionDelay: seen ? `${i * 55}ms` : undefined }}
            />
          ))}
        </div>
        <span className="chan__stop">{stop}</span>
      </div>
    </div>
  );
}

export function Boundary() {
  return (
    <section className="section band" id="boundary">
      <div className="wrap">
        <div className="head">
          <span className="lbl head__eyebrow">boundary</span>
          <h2>Every scanner stops before the question you have to answer.</h2>
          <p className="lead">
            Same eight-node path, three tools. The scale below is the distance from an
            advisory to a contractual obligation. Watch where each one gives up.
          </p>
        </div>

        <div>
          {CHANNELS.map((c) => (
            <Channel
              key={c.name}
              name={c.name}
              question={c.question}
              reach={c.reach}
              stop={c.stop}
              us={c.name === 'Hopper'}
            />
          ))}
        </div>

        <Rise>
          <p className="joinline">
            Knowing a package is vulnerable is not a decision. Knowing that Northwind is
            exposed and that you have twenty-four hours to say so — that is a decision,
            and it has an owner, a deadline and a signature.
          </p>
        </Rise>
      </div>
    </section>
  );
}
