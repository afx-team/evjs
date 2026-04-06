import { createApp } from "@evjs/client";
import { rootRoute } from "./pages/__root";
import { usersRoute } from "./pages/home";
import { searchRoute } from "./pages/search";
import { userDetailRoute } from "./pages/user";

const routeTree = rootRoute.addChildren([
  usersRoute,
  searchRoute,
  userDetailRoute,
]);

const app = createApp({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
