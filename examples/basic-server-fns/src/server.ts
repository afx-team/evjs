import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler } from "@evjs/runtime/server";

// Import server function modules so they register themselves
import "./api/users.server";

const PORT = Number(process.env.PORT) || 3001;

const rpcHandler = createHandler();

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  // RPC endpoint
  if (req.method === "POST" && url === "/api/rpc") {
    return rpcHandler(req, res);
  }

  // Serve static files from dist/client/
  const publicDir = join(__dirname, "../client");

  if (url === "/" || url === "/index.html") {
    const html = readFileSync(join(publicDir, "index.html"), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  // Try to serve the requested file
  try {
    const filePath = join(publicDir, url);
    const data = readFileSync(filePath);
    const ext = url.split(".").pop();
    const types: Record<string, string> = {
      js: "application/javascript",
      css: "text/css",
      html: "text/html",
      json: "application/json",
    };
    res.writeHead(200, { "Content-Type": types[ext ?? ""] ?? "text/plain" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
