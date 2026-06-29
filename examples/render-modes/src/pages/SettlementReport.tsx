import {
  getOperationsSnapshot,
  policyLanes,
  settlementBatches,
} from "@/domain/operations";
import RenderModePage from "./RenderModePage";

export const render = "ssr";
export const hydrate = "none";
export const prerender = true;

export default function SettlementReport() {
  const snapshot = getOperationsSnapshot();
  const releasableBatches = settlementBatches.filter(
    (batch) =>
      batch.decision === "release" || batch.decision === "partial hold",
  );

  return (
    <RenderModePage
      backHref="/"
      description="This report is server rendered with full prerender metadata and no client hydration bundle."
      mode="ssr"
      title="Prerendered SSR"
    >
      <section className="panel hero-panel hero-panel--ssr">
        <div>
          <p className="eyebrow">Full-prerender settlement report</p>
          <h1>Settlement Readiness Report</h1>
          <p>
            Full prerender pages precompute stable operational summaries through
            the framework server and audit review path without shipping a
            page-specific browser bundle.
          </p>
        </div>
        <dl className="meta-list" aria-label="Prerender report metadata">
          <div>
            <dt>Mode</dt>
            <dd data-testid="settlement-render-mode">full prerender</dd>
          </div>
          <div>
            <dt>Generated</dt>
            <dd data-testid="settlement-generated-at">
              {snapshot.generatedAt}
            </dd>
          </div>
          <div>
            <dt>Batches</dt>
            <dd data-testid="settlement-batches">{settlementBatches.length}</dd>
          </div>
          <div>
            <dt>Hydration</dt>
            <dd data-testid="settlement-hydration">none</dd>
          </div>
        </dl>
      </section>

      <section
        className="status-grid"
        aria-label="Prerender settlement metrics"
      >
        <div className="status">
          <h2>Ready releases</h2>
          <strong data-testid="settlement-ready-count">
            {releasableBatches.length}
          </strong>
          <span>batch decisions generated at build time</span>
        </div>
        <div className="status">
          <h2>GMV covered</h2>
          <strong>{snapshot.gmValue}</strong>
          <span>same domain snapshot as SSR and RSC pages</span>
        </div>
        <div className="status">
          <h2>Policy lanes</h2>
          <strong>{policyLanes.length}</strong>
          <span>static risk policy rollup</span>
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>Settlement batches</h2>
          <span>server-rendered HTML table</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Batch</th>
              <th>Window</th>
              <th>Amount</th>
              <th>Held merchants</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {settlementBatches.map((batch) => (
              <tr key={batch.id}>
                <td>{batch.label}</td>
                <td>{batch.releaseWindow}</td>
                <td>{batch.amount}</td>
                <td>{batch.heldMerchants}</td>
                <td>{batch.decision}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Policy lane snapshot</h2>
        <div className="card-grid">
          {policyLanes.map((lane) => (
            <article className="mini-card" key={lane.id}>
              <strong>{lane.label}</strong>
              <span>Score {lane.score}</span>
              <span>
                {lane.decision} / {lane.owner}
              </span>
            </article>
          ))}
        </div>
      </section>
    </RenderModePage>
  );
}
