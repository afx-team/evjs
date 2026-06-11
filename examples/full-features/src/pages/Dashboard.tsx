import { getOperationsSnapshot } from "../domain/operations";
import RenderModePage from "./RenderModePage";

export const render = "ssr";
export const hydrate = "load";

interface DashboardProps {
  manifest?: {
    buildId?: string;
  };
  pageId?: string;
  route?: {
    path?: string;
  };
}

export default function Dashboard(props: DashboardProps) {
  const snapshot = getOperationsSnapshot();
  const criticalQueue = snapshot.decisionQueue.filter(
    (item) => item.status !== "ready",
  );

  return (
    <RenderModePage
      backHref="/"
      description="The operator gets a complete settlement-risk snapshot in the first HTML response."
      mode="ssr"
      title="SSR"
    >
      <section className="panel hero-panel hero-panel--ssr">
        <div>
          <p className="eyebrow">Settlement risk command center</p>
          <h1>Revenue Risk Dashboard</h1>
          <p>
            Morning payout decisions are already assembled on the server:
            exposure, policy triggers, release windows, owners, and SLA pressure
            are visible before any client-side fetch can run.
          </p>
          <ul aria-label="Current operations focus" className="decision-strip">
            <li>Market: APAC + EMEA + NA</li>
            <li>Cutoff: 12:15</li>
            <li>{criticalQueue.length} escalations need action</li>
          </ul>
        </div>
        <dl className="meta-list" aria-label="SSR request metadata">
          <div>
            <dt>Page</dt>
            <dd data-testid="dashboard-page">{props.pageId}</dd>
          </div>
          <div>
            <dt>Route</dt>
            <dd data-testid="dashboard-route">{props.route?.path}</dd>
          </div>
          <div>
            <dt>Build</dt>
            <dd data-testid="dashboard-build">{props.manifest?.buildId}</dd>
          </div>
          <div>
            <dt>Snapshot</dt>
            <dd data-testid="dashboard-generated-at">{snapshot.generatedAt}</dd>
          </div>
        </dl>
      </section>

      <section className="status-grid" aria-label="SSR operations metrics">
        <div className="status">
          <h2>GMV cleared</h2>
          <strong data-testid="dashboard-gmv">{snapshot.gmValue}</strong>
          <span>eligible for release after policy checks</span>
        </div>
        <div className="status">
          <h2>Auto approval</h2>
          <strong>{snapshot.approvalRate}</strong>
          <span>weighted by merchant history and velocity rules</span>
        </div>
        <div className="status">
          <h2>Decision queue</h2>
          <strong>{snapshot.decisionQueue.length}</strong>
          <span>{criticalQueue.length} items block settlement release</span>
        </div>
        <div className="status">
          <h2>Server P95</h2>
          <strong>{snapshot.p95Latency}</strong>
          <span>complete SSR document, including all tables below</span>
        </div>
      </section>

      <section className="panel split-panel">
        <div>
          <p className="eyebrow">Decision queue</p>
          <h2>Payments requiring operator judgment</h2>
          <p>
            This is the first table an on-call lead needs during the release
            window. It combines policy triggers, exposure, recommended action,
            owner, and SLA in one server-rendered document.
          </p>
        </div>
        <div className="decision-list">
          {snapshot.decisionQueue.map((item) => (
            <article
              className={`decision-card decision-card--${item.status}`}
              key={item.id}
            >
              <div>
                <span>{item.id}</span>
                <h3>{item.merchant}</h3>
              </div>
              <strong>{item.exposure}</strong>
              <p>{item.trigger}</p>
              <footer>
                <em>{item.recommendedAction}</em>
                <span>
                  {item.owner} / SLA {item.sla}
                </span>
              </footer>
            </article>
          ))}
        </div>
      </section>

      <section className="panel release-board">
        <div className="section-header">
          <h2>Settlement release plan</h2>
          <span>batch-level action plan from the server snapshot</span>
        </div>
        <div className="release-grid">
          {snapshot.settlementBatches.map((batch) => (
            <article className="release-card" key={batch.id}>
              <span>{batch.releaseWindow}</span>
              <h3>{batch.label}</h3>
              <strong>{batch.amount}</strong>
              <p>
                {batch.heldMerchants} merchant
                {batch.heldMerchants === 1 ? "" : "s"} held for review
              </p>
              <em>{batch.decision}</em>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>Regional payment health</h2>
          <span>regional signals are visible without JavaScript</span>
        </div>
        <div className="card-grid">
          {snapshot.regions.map((region) => (
            <article className="mini-card metric-card" key={region.id}>
              <strong>{region.region}</strong>
              <span>{region.volume} processed</span>
              <span>{region.approval} approval</span>
              <em>{region.risk}</em>
            </article>
          ))}
        </div>
      </section>

      <section className="panel split-panel">
        <div>
          <p className="eyebrow">Operator load</p>
          <h2>Who owns the open work</h2>
          <p>
            The page does not need to wait for browser hydration before the lead
            can assign the next merchant call or unblock a release batch.
          </p>
        </div>
        <div className="operator-load">
          {snapshot.operators.map((operator) => (
            <article key={operator.id}>
              <strong>{operator.name}</strong>
              <span>{operator.role}</span>
              <meter max="6" min="0" value={operator.openAlerts}>
                {operator.openAlerts}
              </meter>
              <em>
                {operator.region} / {operator.openAlerts} open alerts
              </em>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>Payment review board</h2>
          <span>order-level context for the selected release window</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Merchant</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.orders.map((order) => (
              <tr key={order.id}>
                <td>{order.id}</td>
                <td>{order.merchant}</td>
                <td>${order.amount.toLocaleString()}</td>
                <td>{order.status}</td>
                <td>{order.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </RenderModePage>
  );
}
