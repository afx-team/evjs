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
  return (
    <main className="layout">
      <section className="panel">
        <h1>SSR Dashboard</h1>
        <p data-testid="dashboard-page">Page: {props.pageId}</p>
        <p data-testid="dashboard-route">Route: {props.route?.path}</p>
        <p data-testid="dashboard-build">Build: {props.manifest?.buildId}</p>
      </section>
    </main>
  );
}
