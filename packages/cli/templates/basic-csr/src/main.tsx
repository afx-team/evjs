import { createApp } from "@evjs/runtime/client";
import { rootRoute } from "./pages/__root";
import { aboutRoute } from "./pages/about";
import { homeRoute } from "./pages/home";
import { postDetailRoute, postsIndexRoute, postsRoute } from "./pages/posts";

const routeTree = rootRoute.addChildren([
  homeRoute,
  aboutRoute,
  postsRoute.addChildren([postsIndexRoute, postDetailRoute]),
]);

const app = createApp({ routeTree });

// Register router type for full IDE type-safety on useParams, useSearch, Link, etc.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
