import { createApp } from "@evjs/client";
import { routeTree } from "./routes";

const app = createApp({ routeTree, hydrate: "auto" });

declare module "@evjs/client" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
