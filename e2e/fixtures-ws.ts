import { spawn } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import type { DeploymentMetadata } from "@evjs/shared/manifest";
import { test as base, expect } from "@playwright/test";
import { buildExample } from "./fixtures";

export { expect };

/** Get an available port by binding to port 0 and releasing. */
async function getAvailablePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

interface ExampleFixture {
  baseURL: string;
}

interface WorkerFixture {
  _wsApp: { webPort: number };
}

/**
 * E2E fixture for the custom-ws-transport example.
 *
 * Builds with utoopack, starts a WebSocket server using ws-bootstrap.cjs,
 * and serves the client bundle via the same HTTP server.
 */
export function createWebSocketExampleTest() {
  const exampleDir = path.resolve(
    import.meta.dirname,
    "..",
    "examples",
    "custom-ws-transport",
  );

  return base.extend<ExampleFixture, WorkerFixture>({
    _wsApp: [
      // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture API requires object destructuring
      async ({}, use) => {
        // Use dynamic port allocation to avoid conflicts
        const webPort = await getAvailablePort();

        // 1. Build with utoopack and capture runtime-only framework data.
        const buildResult = await buildExample(exampleDir, "utoopack");
        const { frameworkRuntime } = buildResult;
        if (!frameworkRuntime) {
          throw new Error(
            "Built WebSocket example did not produce FrameworkRuntime.",
          );
        }

        // 2. Read canonical deployment metadata for the bundle entry.
        const deploymentMetadataPath = path.join(
          exampleDir,
          "dist",
          "deployment-metadata.json",
        );
        const deploymentMetadata = JSON.parse(
          fs.readFileSync(deploymentMetadataPath, "utf-8"),
        ) as DeploymentMetadata;
        const serverEntry = deploymentMetadata.server.entry;
        if (!serverEntry) {
          throw new Error(
            "Built WebSocket example did not emit a server entry.",
          );
        }
        const serverEntryPath = path.join(
          exampleDir,
          "dist",
          "server",
          serverEntry,
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
            FRAMEWORK_RUNTIME_JSON: JSON.stringify(frameworkRuntime),
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

          serverProcess.once("error", (error) => {
            clearTimeout(timeout);
            reject(
              new Error("WebSocket server failed before readiness", {
                cause: error,
              }),
            );
          });
          serverProcess.once("exit", (code, signal) => {
            clearTimeout(timeout);
            reject(
              new Error(
                `WebSocket server exited before readiness (code ${code ?? "null"}, signal ${signal ?? "null"})`,
              ),
            );
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
