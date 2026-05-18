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
import { isDocumentRequestLike, isKnownAssetPath } from "@evjs/shared";
import { test as base, expect } from "@playwright/test";

export { expect };

interface ExampleFixture {
  /** Base URL where the app is served. */
  baseURL: string;
}

interface WorkerFixture {
  _exampleApp: { webPort: number; apiPort: number };
}

interface ExampleTestOptions {
  serveMode?: "spa" | "ssr";
}

interface StaticServerOptions {
  apiPort?: number;
  documentProxy?: boolean;
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

function getHeaderValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(",") : (value ?? "");
}

function isDocumentProxyRequest(
  req: http.IncomingMessage,
  pathname: string,
): boolean {
  return isDocumentRequestLike({
    method: req.method ?? "GET",
    accept: getHeaderValue(req.headers.accept),
    pathname,
  });
}

function proxyToApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  apiPort: number,
  url: string,
): void {
  const proxyReq = http.request(
    {
      hostname: "localhost",
      port: apiPort,
      path: url,
      method: req.method,
      headers: req.headers,
    },
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
}

/**
 * Create a static file server with SPA fallback.
 *
 * Optionally proxies requests matching `proxyPrefix` to a backend API server.
 */
function createStaticServer(
  distDir: string,
  options?: StaticServerOptions,
): http.Server {
  const indexHtml = fs.readFileSync(path.join(distDir, "index.html"), "utf-8");

  return http.createServer((req, res) => {
    const url = req.url || "/";
    const parsedUrl = new URL(url, "http://localhost");
    const pathname = decodeURIComponent(parsedUrl.pathname);

    // Proxy /api requests to the API server (fullstack only)
    if (options?.apiPort && pathname.startsWith("/api/")) {
      proxyToApi(req, res, options.apiPort, url);
      return;
    }

    // Serve static files
    const filePath = path.join(distDir, pathname);
    const relativePath = path.relative(distDir, filePath);
    if (relativePath.startsWith("..")) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": getContentType(ext) });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    if (
      options?.apiPort &&
      options.documentProxy &&
      isDocumentProxyRequest(req, pathname)
    ) {
      proxyToApi(req, res, options.apiPort, url);
      return;
    }

    if (isKnownAssetPath(pathname)) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    // SPA fallback
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(indexHtml);
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
export function createExampleTest(
  exampleName: string,
  options?: ExampleTestOptions,
) {
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
            `const handler = require(${JSON.stringify(serverEntryPath)}).default;`,
            `const { serve } = require("@hono/node-server");`,
            `serve({ fetch: handler.fetch, port: 0 }, (info) => {`,
            `  console.log("E2E_SERVER_READY:" + info.port);`,
            `});`,
          ].join("\n"),
        );

        // Start the server
        const serverProcess = spawn("node", [bootstrapPath], {
          cwd: exampleDir,
          stdio: "pipe",
        });

        const apiPort = await new Promise<number>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Server did not start within 15s"));
          }, 15_000);

          serverProcess.stdout?.on("data", (data) => {
            const match = data.toString().match(/E2E_SERVER_READY:(\d+)/);
            if (match) {
              clearTimeout(timeout);
              resolve(Number(match[1]));
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
        const staticServer = createStaticServer(distDir, {
          apiPort,
          documentProxy: options?.serveMode === "ssr",
        });

        await new Promise<void>((resolve) => {
          staticServer.listen(0, resolve);
        });
        const { port: webPort } = staticServer.address() as { port: number };

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

        const distDir = path.join(exampleDir, "dist");
        const staticServer = createStaticServer(distDir);

        await new Promise<void>((resolve) => {
          staticServer.listen(0, resolve);
        });
        const { port: webPort } = staticServer.address() as { port: number };

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
