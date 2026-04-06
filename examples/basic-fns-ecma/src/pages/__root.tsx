import { createRootRoute, Link, Outlet } from "@evjs/client";

function Root() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <h1>ECMA Runtime Example</h1>
      <p style={{ color: "#666" }}>
        Server bundle is environment-agnostic — works in Node.js, Deno, Bun, any
        Fetch-compatible runtime.
      </p>
      <nav style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <Link to="/">Messages</Link>
      </nav>
      <Outlet />
    </div>
  );
}

export const rootRoute = createRootRoute({ component: Root });
