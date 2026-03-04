import { createApp } from "@evai/runtime/client";
import { rootRoute } from "./pages/__root";
import { aboutRoute } from "./pages/about";
import { homeRoute } from "./pages/home";
import { postDetailRoute, postsIndexRoute, postsRoute } from "./pages/posts";

const routeTree = rootRoute.addChildren([
  homeRoute,
  aboutRoute,
  postsRoute.addChildren([postsIndexRoute, postDetailRoute]),
]);

createApp({ routeTree }).render("#app");
