/**
 * ECMA runtime adapter entry point.
 *
 * This file demonstrates how to deploy the ev server bundle
 * using the ECMA-standard fetch adapter. The server bundle is
 * environment-agnostic — it just exports a Hono app.
 *
 * This adapter file converts it into a standard { fetch } export
 * that works in any Fetch API-compatible runtime:
 * - Deno: `deno serve start.ts`
 * - Bun: `bun run start.ts`
 * - Cloudflare Workers: deploy as-is
 * - Node.js 18+: use with a fetch-compatible server
 *
 * For production, copy this file to dist/server/ after building.
 */

// In production, you'd import the built bundle:
// import app from "./index.js";
// For development, we use a relative import:
import { createRequire } from "node:module";
import { createHandler } from "@evjs/runtime/server/ecma";

const require = createRequire(import.meta.url);
const bundle = require("./index.js");
const app = bundle.default || bundle;

const handler = createHandler(app);

// Standard ECMA export — compatible with Deno, Bun, Cloudflare Workers
export default handler;

// For Node.js, you can also start a server manually:
if (typeof process !== "undefined" && process.argv[1]?.endsWith("start.mjs")) {
  const { serve } = await import("@hono/node-server");
  const port = Number(process.env.PORT) || 3001;
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`ECMA runtime server listening on http://localhost:${info.port}`);
  });
}
