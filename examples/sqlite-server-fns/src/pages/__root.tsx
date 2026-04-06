import { createAppRootRoute, Link, Outlet } from "@evjs/client";

function Root() {
  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
        maxWidth: "800px",
        margin: "0 auto",
      }}
    >
      <h1>📦 SQLite Server Functions</h1>
      <p style={{ color: "#666" }}>
        Real database-backed server functions using <code>node:sqlite</code>.
      </p>
      <nav
        style={{
          display: "flex",
          gap: "1rem",
          marginBottom: "1.5rem",
          borderBottom: "1px solid #eee",
          paddingBottom: "1rem",
        }}
      >
        <Link to="/" style={{ textDecoration: "none", fontWeight: "bold" }}>
          Users
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}

export const rootRoute = createAppRootRoute({ component: Root });
