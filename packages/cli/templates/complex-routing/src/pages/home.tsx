import { createRoute, Link } from "@evjs/runtime/client";
import { rootRoute } from "./__root";

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => (
    <div>
      <h1>evjs Complex Routing Example</h1>
      <p>
        Demonstrates nested layouts, dynamic params, search params, redirects,
        and server function loaders.
      </p>
      <ul>
        <li>
          <Link to="/posts">Posts</Link> — nested group with dynamic{" "}
          <code>$postId</code>
        </li>
        <li>
          <Link to="/dashboard">Dashboard</Link> — pathless layout with server
          function loader
        </li>
        <li>
          <Link to="/search" search={{ q: "tutorial" }}>
            Search
          </Link>{" "}
          — search params
        </li>
        <li>
          <Link to="/old-blog">Old Blog</Link> — redirect to /posts
        </li>
      </ul>
    </div>
  ),
});
