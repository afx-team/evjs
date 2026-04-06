import { createRootRoute, Outlet } from "@evjs/client";

function Root() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <h1>Route Handlers Example</h1>
      <p style={{ color: "#666" }}>
        REST endpoints powered by <code>route()</code>
      </p>
      <Outlet />
    </div>
  );
}

export const rootRoute = createRootRoute({ component: Root });
