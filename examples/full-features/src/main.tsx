import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  getMerchantOperators,
  type MerchantOperator,
} from "./api/operators.server";
import "./styles.css";

interface HealthPayload {
  ok: boolean;
  route: string;
}

function App() {
  const [operators, setOperators] = useState<MerchantOperator[]>([]);
  const [health, setHealth] = useState<HealthPayload | null>(null);

  useEffect(() => {
    void getMerchantOperators().then(setOperators);
    void fetch("/api/full-features/health")
      .then((response) => response.json() as Promise<HealthPayload>)
      .then(setHealth);
  }, []);

  return (
    <main className="layout">
      <section className="panel">
        <h1>ev Full Features Example</h1>
        <p>
          This app uses an explicit app entry, framework route graph, component
          pages, SSR, PPR, server functions, REST routes, and manifest output.
        </p>
        <nav className="nav" aria-label="Full features navigation">
          <a href="/support.html">CSR component page</a>
          <a href="/dashboard">SSR route page</a>
          <a href="/campaign">PPR campaign page</a>
          <a href="/insights">RSC route page</a>
          <a href="/remote.html">Remote host page</a>
        </nav>
      </section>

      <section className="status-grid" aria-label="Runtime checks">
        <div className="status">
          <h2>Server Function</h2>
          <p data-testid="operators-count">Operators: {operators.length}</p>
          <ul>
            {operators.map((operator) => (
              <li key={operator.id}>{operator.name}</li>
            ))}
          </ul>
        </div>
        <div className="status">
          <h2>REST Route</h2>
          <p data-testid="health-route">
            {health ? health.route : "Loading route status"}
          </p>
        </div>
      </section>
    </main>
  );
}

const mountPoint = document.getElementById("app");
if (!mountPoint) {
  throw new Error('Missing "#app" mount point.');
}

createRoot(mountPoint).render(<App />);
