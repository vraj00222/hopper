import { Rise } from '../components';

const CHAIN = [
  {
    k: 'software',
    v: 'MOVEit Transfer',
    n: 'Managed file transfer. CVE-2023-34362 — a SQL injection zero-day, exploited before a patch existed.',
  },
  {
    k: 'vendor',
    v: 'Zellis',
    n: 'A payroll processor. Ran MOVEit to move payroll files on behalf of its clients.',
  },
  {
    k: 'customers',
    v: 'British Airways · BBC · Boots',
    n: 'Never installed MOVEit. Never had a vulnerable line of code. Found out because Zellis was contractually obliged to tell them.',
  },
  {
    k: 'exposed',
    v: 'employee bank data',
    n: 'Names, addresses, national insurance numbers, bank account numbers.',
  },
  {
    k: 'scope',
    v: '~2,700 organisations',
    n: 'Reached through a vendor, not through their own estate.',
  },
];

export function Precedent() {
  return (
    <section className="section band" id="precedent">
      <div className="wrap">
        <div className="head">
          <span className="lbl head__eyebrow">precedent · june 2023</span>
          <h2>British Airways never installed MOVEit.</h2>
        </div>

        <div className="record">
          <div className="record__prose">
            <p className="body">
              One vulnerability in one file transfer product. It was not in British
              Airways' code, or the BBC's, or Boots'. It was three companies away, inside
              a payroll processor they had all bought from.
            </p>
            <p className="body">
              Zellis's obligation did not begin when Zellis finished patching. It began
              the moment Zellis knew. That is how notice clauses are written, and it is
              the part engineering teams consistently discover too late: the clock is
              started by knowledge, not by remediation. Every hour spent working out
              which customers were in scope was an hour spent inside the window.
            </p>
            <p className="pull">If you sell software to businesses, you are Zellis.</p>
            <p className="body">
              Your customers will not be reading your dependency tree. They will be
              reading their contract with you, and counting.
            </p>
          </div>

          <div>
            {CHAIN.map((r, i) => (
              <Rise key={r.k} delay={i * 70}>
                <div className="chainrow">
                  <span className="chainrow__k">{r.k}</span>
                  <span>
                    <span className="chainrow__v">{r.v}</span>
                    <span className="chainrow__n">{r.n}</span>
                  </span>
                </div>
              </Rise>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
