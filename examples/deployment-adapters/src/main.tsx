import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getMerchantOperationsSnapshot } from "./api/operators.server";
import type { OperationsSnapshot } from "./domain/operations";
import "./styles.css";

interface HealthPayload {
  ok: boolean;
  route: string;
  services: Record<string, string>;
  checkedAt: string;
}

function App() {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);

  useEffect(() => {
    void getMerchantOperationsSnapshot().then(setSnapshot);
    void fetch("/api/deployment-adapters/health")
      .then((response) => response.json() as Promise<HealthPayload>)
      .then(setHealth);
  }, []);

  return (
    <main className="page-shell">
      <section className="panel">
        <p className="eyebrow">Deployment adapter fixture</p>
        <h1>Acme Pay Deployment Console</h1>
        <p>
          This app keeps a small client, server function, and server route so
          deployment adapters can derive artifacts from the full `BuildOutput`.
        </p>
      </section>

      <section className="status-grid" aria-label="Deployment signals">
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

      <section className="panel" aria-label="Deployment summary">
        <div className="section-header">
          <h2>Build output inputs</h2>
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
        <h2>Deployment hooks exercised by this business flow</h2>
        <p>
          buildOutput, per-document transformHtml, and buildEnd all run against
          this app.
        </p>
      </section>
    </main>
  );
}

const mountPoint = document.getElementById("app");
if (!mountPoint) {
  throw new Error('Missing "#app" mount point.');
}

createRoot(mountPoint).render(<App />);
