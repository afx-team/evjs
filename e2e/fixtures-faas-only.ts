/**
 * E2E test fixture for FaaS / server-only mode.
 *
 * Unlike the fullstack fixture, this:
 * 1. Builds the example in server-only mode (`ev build`)
 * 2. Starts the API server directly from dist/server/main.js
 * 3. Tests the API via HTTP requests (no browser/page needed)
 * 4. Tears everything down after tests complete
 */

import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test as base, expect } from "@playwright/test";

export { expect };

interface FaasFixture {
  /** Base URL for the API server. */
  apiURL: string;
}

interface FaasWorkerFixture {
  _faasApp: { apiPort: number };
}

/**
 * Create a test fixture for a FaaS / server-only example.
 *
 * Builds with webpack in server mode, starts the server bundle,
 * and provides the API URL for direct HTTP testing.
 */
export function createFaasTest(exampleName: string) {
  const exampleDir = path.resolve(
    import.meta.dirname,
    "..",
    "examples",
    exampleName,
  );

  return base.extend<FaasFixture, FaasWorkerFixture>({
    _faasApp: [
      // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture pattern
      async ({}, use, workerInfo) => {
        const hash = Array.from(exampleName).reduce(
          (sum, char) => sum + char.charCodeAt(0),
          0,
        );
        const apiPort = 31000 + workerInfo.workerIndex * 100 + (hash % 100);

        // 1. Build in server-only mode
        execSync("npx ev build", {
          cwd: exampleDir,
          stdio: "pipe",
          env: { ...process.env, NODE_ENV: "production" },
        });

        // 2. Verify dist/server/main.js exists (no manifest needed in FaaS mode)
        const serverBundlePath = path.join(exampleDir, "dist", "server");
        const serverFiles = fs.readdirSync(serverBundlePath);
        const mainFile = serverFiles.find(
          (f) => f.startsWith("main.") && f.endsWith(".js"),
        );
        if (!mainFile) {
          throw new Error(
            `No main.*.js found in ${serverBundlePath}. Files: ${serverFiles.join(", ")}`,
          );
        }
        const entryPath = path.join(serverBundlePath, mainFile);

        // 3. Write a CJS bootstrap that requires the server bundle
        const bootstrapPath = path.join(
          exampleDir,
          "dist",
          "_e2e_faas_start.cjs",
        );
        fs.writeFileSync(
          bootstrapPath,
          [
            `const bundle = require(${JSON.stringify(entryPath)});`,
            `const app = bundle.app || (bundle.default && bundle.default.fetch ? { fetch: bundle.default.fetch } : bundle);`,
            `const { serve } = require("@hono/node-server");`,
            `serve({ fetch: app.fetch, port: ${apiPort} }, (info) => {`,
            `  console.log("E2E_FAAS_READY:" + info.port);`,
            `});`,
          ].join("\n"),
        );

        // 4. Start the server
        const serverProcess = spawn("node", [bootstrapPath], {
          cwd: exampleDir,
          stdio: "pipe",
        });

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("FaaS server did not start within 15s"));
          }, 15_000);

          serverProcess.stdout?.on("data", (data) => {
            if (data.toString().includes("E2E_FAAS_READY")) {
              clearTimeout(timeout);
              resolve();
            }
          });

          serverProcess.stderr?.on("data", (data) => {
            console.error("[e2e-faas]", data.toString());
          });

          serverProcess.on("exit", (code) => {
            clearTimeout(timeout);
            if (code !== null && code !== 0) {
              reject(new Error(`FaaS server exited with code ${code}`));
            }
          });
        });

        await use({ apiPort });

        // Cleanup
        serverProcess.kill();
        try {
          fs.unlinkSync(bootstrapPath);
        } catch {
          /* ignore */
        }
      },
      { scope: "worker" },
    ],
    apiURL: async ({ _faasApp }, use) => {
      await use(`http://localhost:${_faasApp.apiPort}`);
    },
  });
}
