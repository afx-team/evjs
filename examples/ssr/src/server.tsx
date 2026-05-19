import {
  createApp as createServerApp,
  createRoute as createServerRoute,
} from "@evjs/server";
import { AssetLinks, AssetScripts, createSsrHandler } from "@evjs/server/ssr";
import { routeTree } from "./routes";

const healthRoute = createServerRoute("/api/health", {
  GET: () => Response.json({ status: "ok", renderer: "ssr" }),
});

const app = createServerApp({
  routes: [healthRoute],
  document: createSsrHandler({
    routeTree,
    forwardHeaders: ["cookie", "x-evjs-e2e"],
    renderDocument: ({ assets, children }) => (
      <html lang="en">
        <head>
          <meta charSet="UTF-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />
          <title>evjs SSR Example</title>
          <AssetLinks assets={assets} />
        </head>
        <body>
          <div id="app">{children}</div>
          <AssetScripts assets={assets} />
        </body>
      </html>
    ),
  }),
});

export default { fetch: app.fetch };
