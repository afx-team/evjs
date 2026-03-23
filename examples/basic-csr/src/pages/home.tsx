import { createRoute } from "@evjs/client";
import { rootRoute } from "./__root";

function Home() {
  return (
    <div>
      <h1>Welcome Home!</h1>
      <p>
        A basic client-side rendered app built with <code>@evjs/client</code>.
      </p>
    </div>
  );
}

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
});
