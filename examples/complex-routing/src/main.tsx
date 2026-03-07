import { createApp } from "@evjs/runtime/client";
import { notFoundRoute, redirectRoute } from "./pages/catch";
import { dashboardLayout, dashboardRoute } from "./pages/dashboard";
import { homeRoute } from "./pages/home";
import { postDetailRoute, postsIndexRoute, postsRoute } from "./pages/posts";
import { searchRoute } from "./pages/search";
import { userRoute } from "./pages/user";
import { rootRoute } from "./pages/__root";

const routeTree = rootRoute.addChildren([
  homeRoute,
  postsRoute.addChildren([postsIndexRoute, postDetailRoute]),
  userRoute,
  dashboardLayout.addChildren([dashboardRoute]),
  searchRoute,
  redirectRoute,
  notFoundRoute,
]);

createApp({ routeTree }).render("#app");
