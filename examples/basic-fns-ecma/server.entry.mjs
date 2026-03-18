/**
 * ECMA runtime adapter entry point.
 *
 * Loads the server bundle (which registers server functions via the runtime),
 * creates a Hono app, and exports a standard fetch handler.
 *
 * Works in any Fetch API-compatible runtime:
 * - Deno: `deno serve start.mjs`
 * - Bun: `bun run start.mjs`
 * - Edge runtimes: deploy as-is
 * - Node.js 18+: use with @hono/node-server
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Read server manifest to find the entry bundle
const manifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf-8"),
);
const bundle = require(`./server/${manifest.server.entry}`);
const app = bundle.createApp();

// Export via ECMA adapter — compatible with Deno, Bun, Workers
const { createHandler } = require("@evjs/runtime/server/ecma");
const handler = createHandler(app);
export default handler;

// For Node.js, start the server:
if (typeof process !== "undefined" && process.argv[1]?.endsWith("start.mjs")) {
  const { serve } = await import("@hono/node-server");
  const port = Number(process.env.PORT) || 3001;
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(
      `ECMA runtime server listening on http://localhost:${info.port}`,
    );
  });
}
