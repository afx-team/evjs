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
import {
  type BuildOutput,
  type ClientRouteTarget,
  getClientRouteMatches,
  getServerRenderedPaths,
} from "@evjs/shared/manifest";
import { test as base, expect } from "@playwright/test";

export { expect };

interface ExampleFixture {
  /** Base URL where the app is served. */
  baseURL: string;
  /** Base URL where the framework/API server is served. */
  apiURL: string;
}

interface WorkerFixture {
  _exampleApp: { webPort: number; apiPort: number };
}

type RuntimeManifestFixture = Pick<
  BuildOutput,
  "apps" | "pages" | "routes" | "runtime"
>;

/**
 * Content-type mapping for static file serving.
 */
function getContentType(ext: string): string {
  switch (ext) {
    case ".html":
      return "text/html";
    case ".js":
    case ".cjs":
    case ".mjs":
      return "application/javascript";
    case ".css":
      return "text/css";
    case ".json":
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
  options?: {
    apiPort?: number;
    proxyPrefixes?: string[];
    pathRewrites?: Record<string, string>;
  },
): http.Server {
  const fallbackHtmlPath = resolveFallbackHtmlPath(distDir);
  const indexHtml = fallbackHtmlPath
    ? fs.readFileSync(fallbackHtmlPath, "utf-8")
    : undefined;
  const proxyPrefixes = options?.proxyPrefixes ?? [];
  const pathRewrites = options?.pathRewrites ?? {};
  const publicManifestPath = resolvePublicManifestPath(distDir);

  return http.createServer((req, res) => {
    const url = req.url || "/";
    const pathname = getRequestPathname(url);

    // Proxy framework server paths and example API routes to the API server.
    if (
      options?.apiPort &&
      proxyPrefixes.some((prefix) => pathMatchesPrefix(pathname, prefix))
    ) {
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
      if (!indexHtml) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("No HTML document found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(indexHtml);
      return;
    }

    if (pathname === "/manifest.json" && publicManifestPath) {
      res.writeHead(200, { "Content-Type": "application/json" });
      fs.createReadStream(publicManifestPath).pipe(res);
      return;
    }

    const rewrite = pathRewrites[pathname];
    if (rewrite) {
      const rewrittenPath = path.join(distDir, rewrite);
      if (fs.existsSync(rewrittenPath)) {
        const ext = path.extname(rewrittenPath);
        res.writeHead(200, { "Content-Type": getContentType(ext) });
        fs.createReadStream(rewrittenPath).pipe(res);
        return;
      }
    }

    // Serve static files
    const filePath = resolveStaticFilePath(distDir, pathname);
    if (filePath && fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": getContentType(ext) });
      fs.createReadStream(filePath).pipe(res);
    } else {
      // SPA fallback
      if (!indexHtml) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("No HTML document found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(indexHtml);
    }
  });
}

function resolveFallbackHtmlPath(distDir: string): string | undefined {
  const indexPath = path.join(distDir, "index.html");
  if (fs.existsSync(indexPath)) return indexPath;

  return fs
    .readdirSync(distDir)
    .filter((fileName) => fileName.endsWith(".html"))
    .sort()
    .map((fileName) => path.join(distDir, fileName))[0];
}

function resolveStaticFilePath(
  distDir: string,
  pathname: string,
): string | undefined {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  const root = path.resolve(distDir);
  const filePath = path.resolve(root, decodedPathname.replace(/^\/+/, ""));
  return filePath === root || filePath.startsWith(`${root}${path.sep}`)
    ? filePath
    : undefined;
}

function resolvePublicManifestPath(distDir: string): string | undefined {
  const candidates = [
    path.join(distDir, "manifest.json"),
    path.join(path.dirname(distDir), "manifest.json"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function getRequestPathname(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url.split("?")[0] || "/";
  }
}

function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  const normalizedPrefix = prefix.startsWith("/") ? prefix : `/${prefix}`;
  if (normalizedPrefix === "/") return pathname === "/";

  return (
    pathname === normalizedPrefix ||
    pathname.startsWith(`${normalizedPrefix.replace(/\/+$/, "")}/`)
  );
}

function getServerProxyPrefixes(manifest: RuntimeManifestFixture): string[] {
  return compactUnique([
    "/api",
    "/__evjs",
    manifest.runtime?.server?.basePath,
    manifest.runtime?.server?.fn,
    manifest.runtime?.server?.ppr,
    manifest.runtime?.server?.rsc,
    ...getServerRenderedPaths(manifest),
  ]);
}

function getClientPathRewrites(
  manifest: RuntimeManifestFixture,
): Record<string, string> {
  const rewrites = Object.fromEntries(
    Object.entries(manifest.pages ?? {}).flatMap(([pageId, page]) =>
      page.path && page.render === "csr" ? [[page.path, `${pageId}.html`]] : [],
    ),
  );

  for (const { path, target } of getClientRouteMatches(manifest)) {
    rewrites[path] ??= getClientRouteHtmlFileName(target);
  }

  return rewrites;
}

function getClientRouteHtmlFileName(target: ClientRouteTarget): string {
  if (target.kind === "page") return `${target.pageId}.html`;
  return target.appId === "default" ? "index.html" : `${target.appId}.html`;
}

function compactUnique(values: Array<string | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

/**
 * Load evjs config from an example directory's ev.config.ts.
 *
 * Since Playwright runs in plain Node.js (no TypeScript loader),
 * we transpile the config file with @swc/core before importing.
 */
async function loadExampleConfig(
  exampleDir: string,
): Promise<import("@evjs/ev").Config<unknown> | undefined> {
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
export async function buildExample(
  exampleDir: string,
  bundlerName: string,
  serverEnabled: boolean,
) {
  const { build } = await import("@evjs/cli");
  const bundler = await resolveBundler(bundlerName);
  const runBuild = build as (
    config: import("@evjs/ev").Config<unknown>,
    options: { cwd: string },
  ) => Promise<void>;

  // Load the example's own ev.config.ts for per-example settings
  const exampleConfig = await loadExampleConfig(exampleDir);

  const savedCwd = process.cwd();
  const savedNodeEnv = process.env.NODE_ENV;
  process.chdir(exampleDir);
  process.env.NODE_ENV = "production";

  try {
    await runBuild(
      {
        ...exampleConfig,
        ...(bundler ? { bundler } : {}),
        server: serverEnabled ? (exampleConfig?.server ?? undefined) : false,
      },
      { cwd: exampleDir },
    );
  } finally {
    process.chdir(savedCwd);
    if (savedNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedNodeEnv;
    }
  }
}

async function resolveBundler(
  bundlerName: string,
): Promise<import("@evjs/ev").BundlerAdapter<unknown> | undefined> {
  if (bundlerName === "utoopack") return undefined;
  if (bundlerName === "webpack") {
    const { webpackAdapter } = await import("@evjs/bundler-webpack");
    return webpackAdapter as import("@evjs/ev").BundlerAdapter<unknown>;
  }

  throw new Error(`Unsupported e2e bundler: ${bundlerName}`);
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

        // Read the public manifest for client routing, the server manifest for
        // the bundle entry, and the full BuildOutput for framework bootstrap.
        // The public manifest is browser-safe and intentionally does not
        // expose server entry files.
        const manifestPath = path.join(
          exampleDir,
          "dist",
          "client",
          "manifest.json",
        );
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        const serverManifestPath = path.join(
          exampleDir,
          "dist",
          "server",
          "manifest.json",
        );
        const serverManifest = JSON.parse(
          fs.readFileSync(serverManifestPath, "utf-8"),
        );
        const serverEntry = serverManifest.entry;
        if (!serverEntry) {
          throw new Error("Built example did not emit a server entry.");
        }
        const buildOutputPath = path.join(
          exampleDir,
          "dist",
          "build-output.json",
        );
        const serverEntryPath = path.join(
          exampleDir,
          "dist",
          "server",
          serverEntry,
        );

        // Match the runtime loader path so package ESM scopes are covered.
        const bootstrapPath = path.join(exampleDir, "dist", "_e2e_start.cjs");
        fs.writeFileSync(
          bootstrapPath,
          [
            `(async () => {`,
            `const fs = require("node:fs");`,
            `const path = require("node:path");`,
            `const { pathToFileURL } = require("node:url");`,
            `const manifest = JSON.parse(fs.readFileSync(${JSON.stringify(buildOutputPath)}, "utf-8"));`,
            `globalThis.__EVJS_MANIFEST__ = manifest;`,
            `const serverDir = path.dirname(${JSON.stringify(serverEntryPath)});`,
            `globalThis.__EVJS_SERVER_MODULE_LOADER__ = async (asset) => { const mod = await import(pathToFileURL(path.resolve(serverDir, asset)).href); const nested = mod && typeof mod.default === "object" ? mod.default : undefined; return nested && ("default" in nested || "render" in nested) ? nested : mod; };`,
            `const serverModule = await import(pathToFileURL(${JSON.stringify(serverEntryPath)}).href);`,
            `const handler = serverModule.default?.default ?? serverModule.default ?? serverModule;`,
            `const { serve } = require("@hono/node-server");`,
            `serve({ fetch: handler.fetch, port: 0 }, (info) => {`,
            `  console.log("E2E_SERVER_READY:" + info.port);`,
            `});`,
            `})().catch((err) => { console.error(err); process.exit(1); });`,
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
          proxyPrefixes: getServerProxyPrefixes(manifest),
          pathRewrites: getClientPathRewrites(manifest),
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
    apiURL: async ({ _exampleApp }, use) => {
      await use(`http://localhost:${_exampleApp.apiPort}`);
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
    apiURL: async ({ _exampleApp }, use) => {
      await use(`http://localhost:${_exampleApp.apiPort}`);
    },
  });
}
