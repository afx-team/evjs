import { createAppRootRoute, Link, Outlet } from "@evjs/client";

function Root() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <h1>Server Functions Example</h1>
      <nav style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <Link to="/">Users</Link>
        <Link to="/search">Search</Link>
        <Link to="/user/$userId" params={{ userId: "1" }}>
          User #1
        </Link>
        <Link to="/user/$userId" params={{ userId: "999" }}>
          User #999 (error)
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}

export const rootRoute = createAppRootRoute({ component: Root });
