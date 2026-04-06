import { createApp } from "@evjs/client";
import { rootRoute } from "./pages/__root";
import { usersRoute } from "./pages/home";

const routeTree = rootRoute.addChildren([usersRoute]);

const app = createApp({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
