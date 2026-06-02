import InsightsBadge from "./InsightsBadge";

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
  return (
    <main className="layout">
      <section className="panel">
        <h1>RSC Insights</h1>
        <p data-testid="insights-page">Page: {props.pageId}</p>
        <p data-testid="insights-route">Route: {props.route?.path}</p>
        <p data-testid="insights-build">Build: {props.manifest?.buildId}</p>
        <InsightsBadge />
      </section>
    </main>
  );
}
