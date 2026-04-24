/**
 * E2E test fixtures for evjs framework.
 *
 * Provides a custom test fixture that:
 * 1. Builds the example app with the specified bundler (utoopack)
 * 2. Starts the API server by requiring the bundle and using @hono/node-server
 * 3. Starts a static file server for the client bundle
 * 4. Tears everything down after tests complete
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test as base, expect } from "@playwright/test";

export { expect };

interface ExampleFixture {
  /** Base URL where the app is served. */
  baseURL: string;
}

interface WorkerFixture {
  _exampleApp: { webPort: number; apiPort: number };
}

/**
 * Content-type mapping for static file serving.
 */
function getContentType(ext: string): string {
  switch (ext) {
    case ".js":
      return "application/javascript";
    case ".css":
      return "text/css";
    case ".map":
      return "application/json";
    default:
      return "text/plain";
  }
}

/**
 * Create a static file server with SPA fallback.
 *
 * Optionally proxies requests matching `proxyPrefix` to a backend API server.
 */
function createStaticServer(
  distDir: string,
  options?: { apiPort?: number },
): http.Server {
  const indexHtml = fs.readFileSync(path.join(distDir, "index.html"), "utf-8");

  return http.createServer((req, res) => {
    const url = req.url || "/";

    // Proxy /api requests to the API server (fullstack only)
    if (options?.apiPort && url.startsWith("/api/")) {
      const proxyReq = http.request(
        `http://localhost:${options.apiPort}${url}`,
        { method: req.method, headers: req.headers },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on("error", (err) => {
        console.error(`[E2E proxy] ${req.method} ${url} failed:`, err.message);
        res.writeHead(502);
        res.end("Bad Gateway");
      });
      req.pipe(proxyReq);
      return;
    }

    // Serve index.html
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(indexHtml);
      return;
    }

    // Serve static files
    const filePath = path.join(distDir, url);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": getContentType(ext) });
      fs.createReadStream(filePath).pipe(res);
    } else {
      // SPA fallback
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(indexHtml);
    }
  });
}

/**
 * Load evjs config from an example directory's ev.config.ts.
 *
 * Since Playwright runs in plain Node.js (no TypeScript loader),
 * we transpile the config file with @swc/core before importing.
 */
async function loadExampleConfig(
  exampleDir: string,
): Promise<import("@evjs/ev").EvConfig | undefined> {
  const configPath = path.join(exampleDir, "ev.config.ts");
  if (!fs.existsSync(configPath)) return undefined;

  const swc = await import("@swc/core");
  const source = fs.readFileSync(configPath, "utf-8");
  const { code } = await swc.transform(source, {
    filename: configPath,
    jsc: {
      parser: { syntax: "typescript", tsx: false },
      target: "es2022",
    },
    module: { type: "es6" },
  });

  const tmpPath = path.join(exampleDir, "_ev.config.e2e.mjs");
  fs.writeFileSync(tmpPath, code, "utf-8");
  try {
    const mod = await import(tmpPath);
    return mod.default ?? mod;
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Build an example app programmatically with the specified bundler.
 *
 * Loads the example's own ev.config.ts so that per-example settings
 * (server.entry, plugins, etc.) are picked up during the build.
 * Only the bundler adapter is overridden by the test configuration.
 */
async function buildExample(
  exampleDir: string,
  _bundlerName: string,
  serverEnabled: boolean,
) {
  const { build } = await import("@evjs/cli");
  // utoopack is the default — no bundler field needed
  const bundler: import("@evjs/ev").BundlerAdapter<unknown> | undefined =
    undefined;

  // Load the example's own ev.config.ts for per-example settings
  const exampleConfig = await loadExampleConfig(exampleDir);

  const savedCwd = process.cwd();
  process.chdir(exampleDir);
  process.env.NODE_ENV = "production";

  try {
    await build(
      {
        ...exampleConfig,
        bundler,
        server: serverEnabled ? (exampleConfig?.server ?? undefined) : false,
      },
      { cwd: exampleDir },
    );
  } finally {
    process.chdir(savedCwd);
  }
}

/**
 * Create a test fixture for a specific example directory.
 *
 * Builds with the bundler specified in the Playwright project config,
 * starts the server bundle via a CJS bootstrap, serves client on a random port.
 */
export function createExampleTest(exampleName: string) {
  const exampleDir = path.resolve(
    import.meta.dirname,
    "..",
    "examples",
    exampleName,
  );

  return base.extend<ExampleFixture, WorkerFixture>({
    _exampleApp: [
      // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture API requires object destructuring
      async ({}, use, workerInfo) => {
        const bundlerName =
          (workerInfo.project.use as unknown as { bundlerName?: string })
            .bundlerName ?? "utoopack";

        // Build with specified bundler (fullstack = server enabled)
        await buildExample(exampleDir, bundlerName, true);

        // Base port depends on both worker index and a hash of the example name
        // to avoid conflicts if multiple worker fixtures run sequentially.
        const hash = Array.from(exampleName + bundlerName).reduce(
          (sum, char) => sum + char.charCodeAt(0),
          0,
        );
        const apiPort = 30000 + workerInfo.workerIndex * 100 + (hash % 100);
        const webPort = apiPort + 1;

        // Read the server manifest to get the hashed entry filename
        const manifestPath = path.join(
          exampleDir,
          "dist",
          "server",
          "manifest.json",
        );
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        const serverEntryPath = path.join(
          exampleDir,
          "dist",
          "server",
          manifest.entry,
        );

        // Write a CJS bootstrap that requires the hashed server bundle
        const bootstrapPath = path.join(exampleDir, "dist", "_e2e_start.cjs");
        fs.writeFileSync(
          bootstrapPath,
          [
            `const bundle = require(${JSON.stringify(serverEntryPath)});`,
            `const app = bundle.app || bundle.createApp();`,
            `const { serve } = require("@hono/node-server");`,
            `serve({ fetch: app.fetch, port: ${apiPort} }, (info) => {`,
            `  console.log("E2E_SERVER_READY:" + info.port);`,
            `});`,
          ].join("\n"),
        );

        // Start the server
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

          serverProcess.on("exit", (code) => {
            clearTimeout(timeout);
            if (code !== null && code !== 0) {
              reject(new Error(`Server exited with code ${code}`));
            }
          });
        });

        // Serve the client bundle with API proxy
        const distDir = path.join(exampleDir, "dist", "client");
        const staticServer = createStaticServer(distDir, { apiPort });

        await new Promise<void>((resolve) => {
          staticServer.listen(webPort, resolve);
        });

        await use({ webPort, apiPort });

        // Cleanup
        staticServer.close();
        serverProcess.kill();
        try {
          fs.unlinkSync(bootstrapPath);
        } catch {
          /* ignore */
        }
      },
      { scope: "worker" },
    ],
    baseURL: async ({ _exampleApp }, use) => {
      await use(`http://localhost:${_exampleApp.webPort}`);
    },
  });
}

/**
 * Create a test fixture for a CSR-only example (no server functions).
 *
 * Builds with the specified bundler, serves static files from dist/ — no API server.
 */
export function createCsrExampleTest(exampleName: string) {
  const exampleDir = path.resolve(
    import.meta.dirname,
    "..",
    "examples",
    exampleName,
  );

  return base.extend<ExampleFixture, WorkerFixture>({
    _exampleApp: [
      // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture API requires object destructuring
      async ({}, use, workerInfo) => {
        const bundlerName =
          (workerInfo.project.use as unknown as { bundlerName?: string })
            .bundlerName ?? "utoopack";

        // Build with specified bundler (CSR = server disabled)
        await buildExample(exampleDir, bundlerName, false);

        const hash = Array.from(exampleName + bundlerName).reduce(
          (sum, char) => sum + char.charCodeAt(0),
          0,
        );
        const webPort = 30000 + workerInfo.workerIndex * 100 + (hash % 100) + 1;

        const distDir = path.join(exampleDir, "dist");
        const staticServer = createStaticServer(distDir);

        await new Promise<void>((resolve) => {
          staticServer.listen(webPort, resolve);
        });

        await use({ webPort, apiPort: 0 });

        staticServer.close();
      },
      { scope: "worker" },
    ],
    baseURL: async ({ _exampleApp }, use) => {
      await use(`http://localhost:${_exampleApp.webPort}`);
    },
  });
}
