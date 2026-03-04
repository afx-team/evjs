import { createRoute } from "@evai/shell";
import { rootRoute } from "../main";

export const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/about",
  component: function About() {
    return (
      <div>
        <h1>About</h1>
        <p>Code-based routing with TanStack Router via <code>createApp</code>.</p>
      </div>
    );
  },
});
