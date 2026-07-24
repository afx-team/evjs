import { useEffect, useState } from "react";
import { getMerchantOperationsSnapshot } from "@/apis/operators.server";
import type { OperationsSnapshot } from "@/domain/operations";
import RenderModePage from "./components/RenderModePage";
import "@/styles.css";

interface HealthPayload {
  ok: boolean;
  route: string;
  services: Record<string, string>;
  checkedAt: string;
}

export default function OperationsConsole() {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);

  useEffect(() => {
    void getMerchantOperationsSnapshot().then(setSnapshot);
    void fetch("/api/render-modes/health")
      .then((response) => response.json() as Promise<HealthPayload>)
      .then(setHealth);
  }, []);

  return (
    <RenderModePage
      description="The operations console is the canonical root Page rendered in the browser."
      mode="csr"
      title="CSR App"
    >
      <section className="panel">
        <p className="eyebrow">Merchant operations workspace</p>
        <h1>Acme Pay Control Center</h1>
        <p>
          A production-style operations console for risk review, merchant
          support, campaign monitoring, and render-mode validation.
        </p>
        <nav className="nav" aria-label="Render modes navigation">
          <a href="/support">Support queue</a>
          <a href="/dashboard">SSR operations dashboard</a>
          <a href="/settlement-report">Prerendered settlement report</a>
          <a href="/campaign">PPR campaign monitor</a>
          <a href="/insights">RSC insights</a>
        </nav>
      </section>

      <section className="status-grid" aria-label="Merchant KPIs">
        <div className="status">
          <h2>Processed GMV</h2>
          <strong data-testid="gmv">{snapshot?.gmValue ?? "Loading"}</strong>
          <span>Today, across priority merchants</span>
        </div>
        <div className="status">
          <h2>Approval Rate</h2>
          <strong data-testid="approval-rate">
            {snapshot?.approvalRate ?? "Loading"}
          </strong>
          <span>After risk policy checks</span>
        </div>
        <div className="status">
          <h2>Risk Queue</h2>
          <strong data-testid="risk-queue">
            {snapshot ? `${snapshot.riskQueue} active` : "Loading"}
          </strong>
          <span>Manual reviews waiting</span>
        </div>
        <div className="status">
          <h2>API Health</h2>
          <strong data-testid="health-route">
            {health ? health.route : "Loading"}
          </strong>
          <span data-testid="risk-service">
            Risk service: {health?.services.risk ?? "checking"}
          </span>
        </div>
      </section>

      <section className="panel" aria-label="Operations queue">
        <div className="section-header">
          <h2>Escalation queue</h2>
          <span data-testid="generated-at">{snapshot?.generatedAt}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Incident</th>
              <th>Owner</th>
              <th>Severity</th>
              <th>Age</th>
            </tr>
          </thead>
          <tbody>
            {snapshot?.incidents.map((incident) => (
              <tr key={incident.id}>
                <td>{incident.title}</td>
                <td>{incident.owner}</td>
                <td>{incident.severity}</td>
                <td>{incident.minutesOpen}m</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel" aria-label="Operator roster">
        <h2>On-call operators</h2>
        <div className="card-grid">
          {snapshot?.operators.map((operator) => (
            <article className="mini-card" key={operator.id}>
              <strong>{operator.name}</strong>
              <span>{operator.role}</span>
              <span>
                {operator.region} / {operator.openAlerts} alerts
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="panel" aria-label="Payment signals">
        <h2>Payment signals</h2>
        <ul className="signal-list">
          {snapshot?.orders.map((order) => (
            <li key={order.id}>
              <span>{order.merchant}</span>
              <strong>${order.amount.toLocaleString()}</strong>
              <em>{order.status}</em>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel muted">
        <h2>Architecture features exercised by this business flow</h2>
        <p>
          Page-and-Route conventions, server function RPC, REST route proxy,
          SSR/PPR/RSC renderers, and adjacent page configuration.
        </p>
      </section>
    </RenderModePage>
  );
}
