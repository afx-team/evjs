/**
 * E2E bootstrap for websocket-fns example.
 *
 * Starts a combined HTTP + WebSocket server:
 * - Serves static client files
 * - Accepts WebSocket connections on /ws
 * - Dispatches RPC calls through the bundled Hono app
 *
 * Environment variables:
 *   SERVER_ENTRY - path to the webpack-built server entry
 *   CLIENT_DIR   - path to the webpack-built client directory
 *   PORT         - port to listen on
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const serverEntryPath = process.env.SERVER_ENTRY;
const distDir = process.env.CLIENT_DIR;
const port = Number(process.env.PORT);

if (!serverEntryPath || !distDir || !port) {
  console.error("Missing required env: SERVER_ENTRY, CLIENT_DIR, PORT");
  process.exit(1);
}

// Load the server bundle — this registers all server functions
const bundle = require(serverEntryPath);
const app = bundle.createApp();

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
    const request = new Request("http://localhost/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fnId, args: args ?? [] }),
    });
    const response = await app.fetch(request);
    const result = await response.json();
    ws.send(JSON.stringify({ id, ...result }));
  });
});

server.listen(port, () => {
  console.log("E2E_WS_SERVER_READY:" + port);
});
