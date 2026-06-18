import { getOperationsSnapshot } from "../domain/operations";
import InsightsBadge from "./InsightsBadge";
import RenderModePage from "./RenderModePage";

export const render = "ssr";
export const rsc = true;
export const hydrate = "none";

interface InsightsProps {
  manifest?: {
    buildId?: string;
  };
  pageId?: string;
  route?: {
    path?: string;
  };
}

export default function Insights(props: InsightsProps) {
  const snapshot = getOperationsSnapshot();
  const riskyOrder = snapshot.orders.find(
    (order) => order.status === "at-risk",
  );

  return (
    <RenderModePage
      backHref="/"
      description="The page is rendered through the RSC coordinator and exposes a Flight endpoint."
      mode="rsc"
      title="RSC"
    >
      <section className="panel hero-panel hero-panel--rsc">
        <div>
          <p className="eyebrow">RSC route page</p>
          <h1>Profitability Insights</h1>
          <p>
            Server components can assemble policy outcomes, model reasoning, and
            merchant context on the server, while a small client island adds
            interactive status once the browser hydrates.
          </p>
        </div>
        <div className="client-island-card">
          <InsightsBadge />
          <p>
            Only the badge needs browser interactivity; the insight narrative is
            rendered by the server path.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>Server-generated recommendations</h2>
          <span data-testid="insights-route">Route: {props.route?.path}</span>
        </div>
        <div className="recommendation-grid">
          {snapshot.recommendations.map((recommendation) => (
            <article className="recommendation-card" key={recommendation.id}>
              <p className="eyebrow">{recommendation.merchant}</p>
              <h3>{recommendation.action}</h3>
              <strong>{recommendation.impact}</strong>
              <p>{recommendation.reason}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel split-panel">
        <div>
          <h2>Model recommendation</h2>
          <p data-testid="insights-recommendation">
            Prioritize review for {riskyOrder?.merchant}; projected recovery is
            12.8% above baseline when handled within 30 minutes.
          </p>
          <p className="muted">
            Page {props.pageId} / build {props.manifest?.buildId}
          </p>
        </div>
        <div className="status">
          <h2>Server signal set</h2>
          <strong>{snapshot.policyLanes.length}</strong>
          <span>policy lanes evaluated before Flight response</span>
        </div>
      </section>

      <section className="panel">
        <h2>Policy lanes evaluated on the server</h2>
        <div className="policy-lanes">
          {snapshot.policyLanes.map((lane) => (
            <article className="policy-lane" key={lane.id}>
              <div>
                <strong>{lane.label}</strong>
                <span>{lane.owner}</span>
              </div>
              <meter max="100" min="0" value={lane.score}>
                {lane.score}
              </meter>
              <em>{lane.decision}</em>
            </article>
          ))}
        </div>
      </section>
    </RenderModePage>
  );
}
