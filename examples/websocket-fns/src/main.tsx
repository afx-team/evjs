import { createApp } from "@evjs/runtime/client";
import { routeTree } from "./routes";

const app = createApp({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
