/**
 * ECMA runtime adapter entry point.
 *
 * The server bundle exports user-defined functions and `createApp`.
 * This adapter creates the Hono app and exports a standard fetch handler.
 *
 * Works in any Fetch API-compatible runtime:
 * - Deno: `deno serve start.mjs`
 * - Bun: `bun run start.mjs`
 * - Cloudflare Workers: deploy as-is
 * - Node.js 18+: use with @hono/node-server
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);

// Read the entry manifest to find the server bundle
const manifest = JSON.parse(readFileSync(new URL("./server/server-entry.json", import.meta.url), "utf-8"));
const bundle = require(`./server/${manifest.main}`);
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
    console.log(`ECMA runtime server listening on http://localhost:${info.port}`);
  });
}
