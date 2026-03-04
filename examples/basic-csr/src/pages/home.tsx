import { createRoute } from "@evai/runtime/client";
import { rootRoute } from "./__root";

function Home() {
  return (
    <div>
      <h1>Welcome Home!</h1>
      <p>
        A basic client-side rendered app built with <code>@evai/runtime</code>.
      </p>
    </div>
  );
}

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
});
