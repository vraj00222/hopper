import { Rise } from '../components';
import { CUSTOMER_ROWS, LOCKFILES, OUTPUTS } from '../data';
import { Code } from './Code';

const HOPPER_YML = `# hopper.yml — commit this to the root of the repo
apiVersion: hopper/v1
kind: Service

service:
  name: build-api
  repo: acme/build-api
  owner: platform-team
  # tier 1 means customer-facing and revenue-bearing
  tier: 1
  environment: production
  public_facing: true

manifests:
  - package-lock.json
  - services/worker/go.sum

# optional — otherwise set customers in the console
customers:
  - northwind-systems
  - kestrel-freight`;

const OTEL_TS = `// instrumentation.ts — loaded before the app starts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter as Otlp }
  from '@opentelemetry/exporter-trace-otlp-http';

new NodeSDK({
  serviceName: 'build-api',
  traceExporter: new Otlp({
    url: 'https://otlp.hopper.dev/v1/traces',
    headers: { 'x-hopper-key': process.env.HOPPER_KEY ?? '' },
  }),
}).start();`;

function Layer({
  no,
  effort,
  effortClear,
  title,
  body,
  get,
  children,
}: {
  no: string;
  effort: string;
  effortClear?: boolean;
  title: string;
  body: React.ReactNode;
  get: string;
  children: React.ReactNode;
}) {
  return (
    <div className="layer">
      <div className="layer__head">
        <span className="layer__tag">
          <span className="layer__no">{no}</span>
          <span className={`layer__eff ${effortClear ? 'layer__eff--none' : ''}`}>
            {effort}
          </span>
        </span>
        <h3>{title}</h3>
        <div className="body" style={{ fontSize: 15 }}>
          {body}
        </div>
        <p className="layer__get">{get}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

export function Adoption() {
  return (
    <section className="section band paper" id="adoption">
      <div className="wrap">
        <div className="head">
          <span className="lbl head__eyebrow">adoption</span>
          <h2>Layer one takes thirty seconds and already pays for itself.</h2>
          <p className="lead">
            Four layers, in the order most teams do them. Nothing valuable is held behind
            the hard part — the effort rises as you go down, and so does the precision,
            but the first layer is where the noise reduction lives.
          </p>
        </div>

        <Layer
          no="layer 1"
          effort="30 seconds, once"
          title="Install the GitHub App"
          body={
            <>
              <p>
                Authorise it on the org, pick repositories. No SDK, no code change, and
                nothing running in your production runtime. Hopper reads lockfiles and
                nothing else — not source, not secrets, not environment.
              </p>
              <p style={{ marginTop: 12 }}>
                It resolves the full transitive tree through deps.dev and OSV, so a
                dependency six levels down is a first-class node from the first scan.
              </p>
            </>
          }
          get="You get: suppression and hop paths. Roughly 99 of every 100 advisories stop here, silently."
        >
          <div style={{ display: 'grid', gap: 18 }}>
            <div>
              <span className="lbl" style={{ marginBottom: 10 }}>
                manifests read
              </span>
              <div className="chips">
                {LOCKFILES.map((f) => (
                  <span key={f}>{f}</span>
                ))}
              </div>
            </div>
            <Code
              title="install"
              note="nothing else required"
              lang="yaml"
              src={`# github.com/apps/hopper → Install → select repositories
# permissions requested:
contents: read      # lockfiles only
metadata: read
pull_requests: write  # layer 2 onward, for the fix PRs`}
            />
          </div>
        </Layer>

        <Rise className="waterline">
          <span className="dot" style={{ background: 'var(--c-clear)' }} />
          <p>
            <b>Everything above this line already works.</b> The layers below make the
            answer sharper and add the obligation clock. They are not a prerequisite for
            value, and you can stop here indefinitely.
          </p>
        </Rise>

        <Layer
          no="layer 2"
          effort="10 minutes per repo"
          title="Map repositories to services"
          body={
            <>
              <p>
                A repository is not a service, and your customers buy services. Commit a
                short <code className="mono">hopper.yml</code>, or let Hopper read what
                you already have — Backstage catalog entries, Kubernetes labels, Terraform
                tags.
              </p>
              <p style={{ marginTop: 12 }}>
                Tier and environment are what let Hopper tell a build-time dev dependency
                apart from something in the request path of production.
              </p>
            </>
          }
          get="You get: alerts scoped to a service and an owning team, instead of to a repository."
        >
          <Code title="hopper.yml" note="acme/build-api" lang="yaml" src={HOPPER_YML} />
        </Layer>

        <Layer
          no="layer 3"
          effort="1 minute per customer"
          title="Map customers and notice windows"
          body={
            <>
              <p>
                One row per customer: which service they use, and how long you have to
                tell them. Everyone starts at 72 hours — the GDPR baseline — so the clock
                exists before anyone has read a single contract. Tighten the rows that
                need tightening.
              </p>
              <p style={{ marginTop: 12 }}>
                Sync from Salesforce or HubSpot if you would rather not type. Hopper does
                not parse contract PDFs, and will not pretend to. A number a lawyer
                confirmed beats a number a model guessed.
              </p>
            </>
          }
          get="You get: the customer list per advisory, and the obligation clock in the hero above."
        >
          <div className="cust">
            <div className="cust__r cust__h">
              <span>customer</span>
              <span>service</span>
              <span>notice</span>
            </div>
            {CUSTOMER_ROWS.map((r) => (
              <div className="cust__r" key={r.customer}>
                <span>
                  {r.customer}
                  <br />
                  <span className="cust__basis mono">{r.basis}</span>
                </span>
                <span>{r.service}</span>
                <span>
                  <label>
                    <span className="skip">Notice window for {r.customer}</span>
                    <select defaultValue={r.window}>
                      <option value="24">24h</option>
                      <option value="48">48h</option>
                      <option value="72">72h</option>
                    </select>
                  </label>
                </span>
              </div>
            ))}
          </div>
        </Layer>

        <Layer
          no="layer 4"
          effort="optional"
          effortClear
          title="Reachability, if you want it"
          body={
            <>
              <p>
                The only layer that touches your runtime. An OpenTelemetry exporter
                reports which functions actually executed, which turns "95% of your
                dependencies are vulnerable" into "9.5% are reachable".
              </p>
              <p style={{ marginTop: 12 }}>
                Be clear about the trade: without it Hopper proves that a path{' '}
                <em>exists</em> from the advisory to the customer, not that the vulnerable
                code <em>ran</em>. That is weaker evidence, and it is still the evidence
                nobody else gives you. Most teams never install this layer.
              </p>
            </>
          }
          get="You get: fewer confirmed hits, each one better evidenced. Path existence becomes live reachability."
        >
          <Code
            title="instrumentation.ts"
            note="node · same for python, go, java"
            lang="ts"
            src={OTEL_TS}
          />
        </Layer>

        <div className="head" style={{ marginTop: 'clamp(64px, 7vw, 100px)' }}>
          <span className="lbl head__eyebrow">where the output goes</span>
        </div>

        <div className="outs">
          {OUTPUTS.map((o) => (
            <div className={`out ${o.auto ? '' : 'out--held'}`} key={o.where}>
              <span className="out__w">{o.where}</span>
              <span className="out__t">{o.what}</span>
              <span className="out__s">{o.auto ? 'automatic' : 'held for signature'}</span>
            </div>
          ))}
        </div>

        <Rise>
          <p className="rule">
            The customer notice never fires by itself.
            <small>
              Hopper drafts it, attaches the hop path and the timestamps, addresses it to
              the right contact and puts it in front of a named human. Sending it is legal
              exposure, so a person signs it. There is no setting that changes this.
            </small>
          </p>
        </Rise>
      </div>
    </section>
  );
}
