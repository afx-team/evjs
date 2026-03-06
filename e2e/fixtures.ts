/**
 * E2E test fixtures for evjs framework.
 *
 * Provides a custom test fixture that:
 * 1. Builds the example app with webpack
 * 2. Starts the API server by requiring the bundle and using @hono/node-server
 * 3. Starts a static file server for the client bundle
 * 4. Tears everything down after tests complete
 */

import { type ChildProcess, execSync, spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { test as base, expect } from "@playwright/test";

export { expect };

interface ExampleFixture {
  /** Base URL where the app is served. */
  baseURL: string;
}

/**
 * Create a test fixture for a specific example directory.
 *
 * Builds with webpack, starts the server bundle via a CJS bootstrap
 * (imports the app + starts it with @hono/node-server), serves client on port 3000.
 */
export function createExampleTest(exampleName: string) {
  const exampleDir = path.resolve(
    import.meta.dirname,
    "..",
    "examples",
    exampleName,
  );

  return base.extend<ExampleFixture>({
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture pattern
    baseURL: async ({ }, use) => {
      // 1. Build with webpack
      execSync("npx webpack --config webpack.config.cjs", {
        cwd: exampleDir,
        stdio: "pipe",
      });

      // 2. Read the server manifest to get the hashed entry filename
      const manifestPath = path.join(exampleDir, "dist", "server", "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const serverEntryPath = path.join(
        exampleDir,
        "dist",
        "server",
        manifest.entry,
      );

      // 3. Write a CJS bootstrap that requires the hashed server bundle
      const bootstrapPath = path.join(exampleDir, "dist", "_e2e_start.cjs");
      fs.writeFileSync(
        bootstrapPath,
        [
          `const bundle = require(${JSON.stringify(serverEntryPath)});`,
          `const app = bundle.createApp();`,
          `const { serve } = require("@hono/node-server");`,
          `serve({ fetch: app.fetch, port: 3001 }, (info) => {`,
          `  console.log("E2E_SERVER_READY:" + info.port);`,
          `});`,
        ].join("\n"),
      );

      // 3. Start the server
      const serverProcess = spawn("node", [bootstrapPath], {
        cwd: exampleDir,
        stdio: "pipe",
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Server did not start within 15s"));
        }, 15_000);

        serverProcess.stdout?.on("data", (data) => {
          if (data.toString().includes("E2E_SERVER_READY")) {
            clearTimeout(timeout);
            resolve();
          }
        });

        serverProcess.stderr?.on("data", (data) => {
          console.error("[e2e-server]", data.toString());
        });

        serverProcess.on("exit", (code) => {
          clearTimeout(timeout);
          if (code !== null && code !== 0) {
            reject(new Error(`Server exited with code ${code}`));
          }
        });
      });

      // 4. Serve the client bundle on port 3000
      const distDir = path.join(exampleDir, "dist", "client");
      const indexHtml = fs.readFileSync(
        path.join(distDir, "index.html"),
        "utf-8",
      );

      const staticServer = http.createServer((req, res) => {
        const url = req.url || "/";

        // Proxy /api requests to the API server
        if (url.startsWith("/api/")) {
          const proxyReq = http.request(
            `http://localhost:3001${url}`,
            { method: req.method, headers: req.headers },
            (proxyRes) => {
              res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
              proxyRes.pipe(res);
            },
          );
          proxyReq.on("error", () => {
            res.writeHead(502);
            res.end("Bad Gateway");
          });
          req.pipe(proxyReq);
          return;
        }

        // Serve static files
        if (url === "/" || url === "/index.html") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(indexHtml);
          return;
        }

        const filePath = path.join(distDir, url);
        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath);
          const contentType =
            ext === ".js"
              ? "application/javascript"
              : ext === ".css"
                ? "text/css"
                : ext === ".map"
                  ? "application/json"
                  : "text/plain";
          res.writeHead(200, { "Content-Type": contentType });
          fs.createReadStream(filePath).pipe(res);
        } else {
          // SPA fallback
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(indexHtml);
        }
      });

      await new Promise<void>((resolve) => {
        staticServer.listen(3000, resolve);
      });

      await use("http://localhost:3000");

      // Cleanup
      staticServer.close();
      serverProcess.kill();
      try {
        fs.unlinkSync(bootstrapPath);
      } catch {
        /* ignore */
      }
    },
  });
}
