import { createApp, createRootRoute, Outlet, Link } from "@evai/shell";
import { homeRoute } from "./pages/home";
import { aboutRoute } from "./pages/about";
import {
  postsRoute,
  postsIndexRoute,
  postDetailRoute,
} from "./pages/posts";

export const rootRoute = createRootRoute({
  component: function Root() {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
        <nav
          style={{
            display: "flex",
            gap: "1rem",
            borderBottom: "1px solid #e5e7eb",
            paddingBottom: "0.5rem",
            marginBottom: "1rem",
          }}
        >
          <Link to="/" style={{ fontWeight: "bold" }}>
            Home
          </Link>
          <Link to="/about">About</Link>
          <Link to="/posts">Posts</Link>
        </nav>
        <Outlet />
      </div>
    );
  },
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  aboutRoute,
  postsRoute.addChildren([postsIndexRoute, postDetailRoute]),
]);

createApp({ routeTree }).render("#app");
