import { createAppRootRoute, Link, Outlet } from "@evjs/client";

function Root() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>Configured Server Functions</h1>
      <p style={{ color: "#666" }}>
        Custom <code>ev.config.ts</code> with server function queries.
      </p>
      <nav style={{ marginBottom: "1rem" }}>
        <Link to="/" style={{ textDecoration: "none", fontWeight: "bold" }}>
          Users
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}

export const rootRoute = createAppRootRoute({ component: Root });
