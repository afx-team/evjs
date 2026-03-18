import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test as base, expect } from "@playwright/test";

export { expect };

interface ExampleFixture {
  baseURL: string;
}

interface WorkerFixture {
  _wsApp: { webPort: number };
}

/**
 * E2E fixture for the websocket-fns example.
 *
 * Builds with webpack, starts a WebSocket server using ws-bootstrap.cjs,
 * and serves the client bundle via the same HTTP server.
 */
export function createWebSocketExampleTest() {
  const exampleDir = path.resolve(
    import.meta.dirname,
    "..",
    "examples",
    "websocket-fns",
  );

  return base.extend<ExampleFixture, WorkerFixture>({
    _wsApp: [
      // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture pattern
      async ({}, use, workerInfo) => {
        const basePort = 31000 + workerInfo.workerIndex * 100;
        const webPort = basePort;

        // 1. Build with webpack
        execSync("npx ev build", {
          cwd: exampleDir,
          stdio: "pipe",
        });

        // 2. Read the server manifest
        const manifestPath = path.join(exampleDir, "dist", "manifest.json");
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        const serverEntryPath = path.join(
          exampleDir,
          "dist",
          "server",
          manifest.server.entry,
        );

        // 3. Start the WebSocket server via bootstrap script
        const bootstrapPath = path.resolve(
          import.meta.dirname,
          "ws-bootstrap.cjs",
        );
        const clientDir = path.join(exampleDir, "dist", "client");

        const serverProcess = spawn("node", [bootstrapPath], {
          cwd: exampleDir,
          stdio: "pipe",
          env: {
            ...process.env,
            SERVER_ENTRY: serverEntryPath,
            CLIENT_DIR: clientDir,
            PORT: String(webPort),
          },
        });

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("WebSocket server did not start within 15s"));
          }, 15_000);

          serverProcess.stdout?.on("data", (data) => {
            if (data.toString().includes("E2E_WS_SERVER_READY")) {
              clearTimeout(timeout);
              resolve();
            }
          });

          serverProcess.stderr?.on("data", (data) => {
            console.error("[e2e-ws-server]", data.toString());
          });

          serverProcess.on("exit", (code) => {
            clearTimeout(timeout);
            if (code !== null && code !== 0) {
              reject(new Error(`WebSocket server exited with code ${code}`));
            }
          });
        });

        await use({ webPort });

        // Cleanup
        serverProcess.kill();
      },
      { scope: "worker" },
    ],
    baseURL: async ({ _wsApp }, use) => {
      await use(`http://localhost:${_wsApp.webPort}`);
    },
  });
}
