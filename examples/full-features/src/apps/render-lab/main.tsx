import { createRoot } from "react-dom/client";
import RemoteApp from "../../pages/RemoteApp";
import RenderModePage from "../../pages/RenderModePage";
import "../../styles.css";

const renderModeRoutes = [
  {
    href: "/app/dashboard",
    mode: "SSR",
    title: "Revenue risk route",
    description: "Server-rendered page owned by render-lab app routes.",
  },
  {
    href: "/app/campaign",
    mode: "PPR",
    title: "Campaign monitor route",
    description:
      "Suspense-driven partial prerendering from the app route graph.",
  },
  {
    href: "/app/insights",
    mode: "RSC",
    title: "Profitability insights route",
    description: "RSC page and Flight endpoint selected by app route metadata.",
  },
  {
    href: "/app/remote",
    mode: "Remote",
    title: "CRM workspace route",
    description: "Client app route that activates a manifest-driven remote.",
  },
];

function RenderLabApp() {
  if (window.location.pathname === "/app/remote") {
    return <RemoteApp />;
  }

  return (
    <RenderModePage
      backHref="/"
      description="This app owns one route source that declares SSR, PPR, RSC, and remote routes."
      mode="csr"
      title="App Routes"
    >
      <section className="panel hero-panel hero-panel--csr">
        <div>
          <p className="eyebrow">App-owned render modes</p>
          <h1>Render Lab App</h1>
          <p>
            The app entry is still a browser shell, but its route source is a
            framework graph input. Each route can choose its own rendering
            contract without duplicating page declarations in config.
          </p>
        </div>
        <dl className="meta-list">
          <div>
            <dt>App</dt>
            <dd>render-lab</dd>
          </div>
          <div>
            <dt>Routes</dt>
            <dd>./src/apps/render-lab/routes.tsx</dd>
          </div>
          <div>
            <dt>Modes</dt>
            <dd>SSR / PPR / RSC / Remote</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>Route-level capabilities</h2>
          <span>declared by one app route source</span>
        </div>
        <div className="render-lab-grid">
          {renderModeRoutes.map((item) => (
            <a className="render-lab-card" href={item.href} key={item.href}>
              <span>{item.mode}</span>
              <strong>{item.title}</strong>
              <em>{item.href}</em>
              <p>{item.description}</p>
            </a>
          ))}
        </div>
      </section>
    </RenderModePage>
  );
}

const mountPoint = document.getElementById("app");
if (!mountPoint) {
  throw new Error('Missing "#app" mount point.');
}

createRoot(mountPoint).render(<RenderLabApp />);
