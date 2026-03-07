import { createRoute } from "@evjs/runtime/client";
import { rootRoute } from "./__root";

function Home() {
  return (
    <div>
      <h1>Welcome Home!</h1>
      <p>
        A basic client-side rendered app built with <code>@evjs/runtime</code>.
      </p>
    </div>
  );
}

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
});
