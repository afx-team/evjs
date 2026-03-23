import { createRoute, Link, redirect } from "@evjs/client";
import { rootRoute } from "./__root";

// ── Redirect: /old-blog → /posts ──

export const redirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/old-blog",
  beforeLoad: () => {
    throw redirect({ to: "/posts" });
  },
});

// ── 404 Catch-all ──

export const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "*",
  component: () => (
    <div style={{ textAlign: "center", padding: "3rem" }}>
      <h1 style={{ fontSize: 48 }}>404</h1>
      <p style={{ color: "#6b7280" }}>Page not found</p>
      <Link to="/">← Go home</Link>
    </div>
  ),
});
