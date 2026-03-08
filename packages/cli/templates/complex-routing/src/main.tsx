import { createApp } from "@evjs/runtime/client";
import { rootRoute } from "./pages/__root";
import { notFoundRoute, redirectRoute } from "./pages/catch";
import { dashboardLayout, dashboardRoute } from "./pages/dashboard";
import { homeRoute } from "./pages/home";
import { postDetailRoute, postsIndexRoute, postsRoute } from "./pages/posts";
import { searchRoute } from "./pages/search";
import { userRoute } from "./pages/user";

const routeTree = rootRoute.addChildren([
  homeRoute,
  postsRoute.addChildren([postsIndexRoute, postDetailRoute]),
  userRoute,
  dashboardLayout.addChildren([dashboardRoute]),
  searchRoute,
  redirectRoute,
  notFoundRoute,
]);

const app = createApp({ routeTree });

// Register router type for full IDE type-safety on useParams, useSearch, Link, etc.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
