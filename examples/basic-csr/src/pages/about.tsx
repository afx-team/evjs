import { createRoute } from "@evjs/runtime/client";
import { rootRoute } from "./__root";

function About() {
  return (
    <div>
      <h1>About</h1>
      <p>
        Code-based routing with TanStack Router via <code>createApp</code>.
      </p>
    </div>
  );
}

export const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/about",
  component: About,
});
