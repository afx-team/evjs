import { getOperationsSnapshot } from "../domain/operations";
import RenderModePage from "./RenderModePage";

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

  return (
    <RenderModePage
      backHref="/"
      description="Server HTML is produced before the browser hydrates the React page."
      mode="ssr"
      title="SSR"
    >
      <section className="panel hero-panel hero-panel--ssr">
        <div>
          <p className="eyebrow">SSR route page</p>
          <h1>Operations Dashboard</h1>
          <p>
            The response arrives with the complete command-center snapshot in
            the HTML, so operators see priority merchants, incident owners, and
            regional risk before hydration completes.
          </p>
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
          <h2>Processed GMV</h2>
          <strong data-testid="dashboard-gmv">{snapshot.gmValue}</strong>
          <span>Rendered in the initial server document</span>
        </div>
        <div className="status">
          <h2>Approval</h2>
          <strong>{snapshot.approvalRate}</strong>
          <span>Policy checks included in first paint</span>
        </div>
        <div className="status">
          <h2>Risk Queue</h2>
          <strong>{snapshot.riskQueue}</strong>
          <span>Incidents assigned to named operators</span>
        </div>
        <div className="status">
          <h2>P95 Latency</h2>
          <strong>{snapshot.p95Latency}</strong>
          <span>Server data available without a client fetch spinner</span>
        </div>
      </section>

      <section className="panel split-panel">
        <div>
          <p className="eyebrow">First-paint incident command</p>
          <h2>High-priority incidents</h2>
          <p>
            SSR is useful here because the queue is actionable immediately:
            titles, owners, severity, and age are all visible in the first
            document.
          </p>
        </div>
        <ul className="signal-list">
          {snapshot.incidents.map((incident) => (
            <li key={incident.id}>
              <span>{incident.title}</span>
              <strong>{incident.owner}</strong>
              <em>
                {incident.severity} / {incident.minutesOpen}m
              </em>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>Regional payment health</h2>
          <span>SSR table content is crawlable and visible without JS</span>
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

      <section className="panel">
        <h2>Payment review board</h2>
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
