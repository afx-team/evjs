/**
 * E2E bootstrap for custom-ws-transport example.
 *
 * Starts a combined HTTP + WebSocket server:
 * - Serves static client files
 * - Accepts WebSocket connections on /ws
 * - Dispatches RPC calls through the bundled Hono app
 *
 * Environment variables:
 *   SERVER_ENTRY - path to the built server entry
 *   CLIENT_DIR   - path to the built client directory
 *   MANIFEST_PATH - path to the full BuildOutput manifest
 *   PORT         - port to listen on
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { WebSocketServer } = require("ws");

const serverEntryPath = process.env.SERVER_ENTRY;
const distDir = process.env.CLIENT_DIR;
const port = Number(process.env.PORT);
const manifestPath = process.env.MANIFEST_PATH;

if (!serverEntryPath || !distDir || !port || !manifestPath) {
  console.error(
    "Missing required env: SERVER_ENTRY, CLIENT_DIR, PORT, MANIFEST_PATH",
  );
  process.exit(1);
}

// Load the server bundle — this registers all server functions
// and exports the fetch handler (app.fetch) as `default`.
// We use the bundle's own fetch handler to ensure it shares the same
// server function registry that registerServerReference populated.
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
globalThis.__EVJS_MANIFEST__ = manifest;
const serverDir = path.dirname(serverEntryPath);
globalThis.__EVJS_SERVER_MODULE_LOADER__ = async (asset) => {
  const mod = await import(pathToFileURL(path.resolve(serverDir, asset)).href);
  const nested =
    mod && typeof mod.default === "object" ? mod.default : undefined;
  return nested && ("default" in nested || "render" in nested) ? nested : mod;
};
const serverModule = require(serverEntryPath);
const handler =
  serverModule.default?.default ?? serverModule.default ?? serverModule;

const indexHtml = fs.readFileSync(path.join(distDir, "index.html"), "utf-8");

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (url === "/" || url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(indexHtml);
    return;
  }
  const filePath = path.join(distDir, url);
  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    const ct =
      ext === ".js"
        ? "application/javascript"
        : ext === ".css"
          ? "text/css"
          : "text/plain";
    res.writeHead(200, { "Content-Type": ct });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(indexHtml);
  }
});

// WebSocket server mounted on /ws
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  ws.on("message", async (raw) => {
    const { id, fnId, args } = JSON.parse(raw.toString());
    const request = new Request(new URL("__evjs/fn", "http://localhost/"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fnId, args: args ?? [] }),
    });
    const response = await handler.fetch(request);
    const result = await response.json();
    ws.send(JSON.stringify({ id, ...result }));
  });
});

server.listen(port, () => {
  console.log(`E2E_WS_SERVER_READY:${port}`);
});
