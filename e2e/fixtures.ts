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
import type { BundlerAdapter } from "@evjs/ev/_internal/build";
import type { Config } from "@evjs/ev/config";
import type { BuildResult, Plugin } from "@evjs/ev/plugin";
import type { DeploymentMetadata } from "@evjs/shared/manifest";
import { test as base, expect } from "@playwright/test";

export { expect };

interface ExampleFixture {
  /** Base URL where the app is served. */
  baseURL: string;
  /** Base URL where the framework/API server is served. */
  apiURL: string;
  /** Framework runtime captured from the build pipeline. */
  frameworkRuntime: FrameworkRuntimeOutput;
}

interface WorkerFixture {
  _exampleApp: {
    webPort: number;
    apiPort: number;
    frameworkRuntime?: FrameworkRuntimeOutput;
  };
}

type RoutingFixture = Pick<DeploymentMetadata, "documents" | "routes">;
type FrameworkRuntimeOutput = NonNullable<BuildResult["frameworkRuntime"]>;
type BuildExampleResult = {
  frameworkRuntime?: FrameworkRuntimeOutput;
};

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

function getServerProxyPrefixes(output: RoutingFixture): string[] {
  return compactUnique([
    "/api",
    ...output.routes
      .filter((route) =>
        [
          "server-function",
          "ppr-endpoint",
          "rsc-endpoint",
          "server-page",
          "api-route",
        ].includes(route.kind),
      )
      .map((route) => normalizeProxyRoutePath(route.path)),
  ]);
}

function getClientPathRewrites(output: RoutingFixture): Record<string, string> {
  return Object.fromEntries([
    ...output.documents.flatMap((document) => {
      if (document.kind !== "app" || !document.fallback?.startsWith("/")) {
        return [];
      }
      return [[document.fallback, document.fileName]];
    }),
    ...output.documents.flatMap((document) => {
      if (document.kind !== "page" || !document.path?.startsWith("/")) {
        return [];
      }
      return [[document.path, document.fileName]];
    }),
  ]);
}

function normalizeProxyRoutePath(routePath: string): string {
  return routePath.replace(/\/\*$/, "");
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
): Promise<Config<unknown> | undefined> {
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
 * (plugins, output structure, etc.) are picked up during the build.
 * Only the bundler adapter is overridden by the test configuration.
 */
export async function buildExample(
  exampleDir: string,
  bundlerName: string,
): Promise<BuildExampleResult> {
  const { build } = await import("@evjs/cli");
  const bundler = await resolveBundler(bundlerName);
  let frameworkRuntime: FrameworkRuntimeOutput | undefined;
  const captureFrameworkRuntimePlugin: Plugin<unknown> = {
    name: "e2e-framework-runtime-capture",
    setup() {
      return {
        buildEnd(result) {
          frameworkRuntime = result.frameworkRuntime;
        },
      };
    },
  };
  const runBuild = build as (
    config: Config<unknown>,
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
        plugins: [
          ...((exampleConfig?.plugins as Plugin<unknown>[]) ?? []),
          captureFrameworkRuntimePlugin,
        ],
        ...(bundler ? { bundler } : {}),
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

  return { frameworkRuntime };
}

async function resolveBundler(
  bundlerName: string,
): Promise<BundlerAdapter<unknown> | undefined> {
  if (bundlerName === "utoopack") return undefined;
  if (bundlerName === "webpack") {
    const { webpackAdapter } = await import("@evjs/bundler-webpack");
    return webpackAdapter as BundlerAdapter<unknown>;
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

        const buildResult = await buildExample(exampleDir, bundlerName);
        const { frameworkRuntime } = buildResult;
        if (!frameworkRuntime) {
          throw new Error("Built example did not produce FrameworkRuntime.");
        }

        // Read only the deployment manifest for the bundle entry; runtime-only
        // FrameworkRuntime data comes from the buildEnd hook above.
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
        const deploymentMetadata = JSON.parse(
          fs.readFileSync(buildOutputPath, "utf-8"),
        ) as DeploymentMetadata;
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
            `globalThis.__EVJS_FRAMEWORK_RUNTIME__ = ${JSON.stringify(frameworkRuntime, null, 2)};`,
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
          proxyPrefixes: getServerProxyPrefixes(deploymentMetadata),
          pathRewrites: getClientPathRewrites(deploymentMetadata),
        });

        await new Promise<void>((resolve) => {
          staticServer.listen(0, resolve);
        });
        const { port: webPort } = staticServer.address() as { port: number };

        await use({ webPort, apiPort, frameworkRuntime });

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
    frameworkRuntime: async ({ _exampleApp }, use) => {
      if (!_exampleApp.frameworkRuntime) {
        throw new Error("Built example did not produce FrameworkRuntime.");
      }
      await use(_exampleApp.frameworkRuntime);
    },
  });
}

/**
 * Create a test fixture for a static client example.
 *
 * Builds with the specified bundler and serves static files from dist/.
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

        await buildExample(exampleDir, bundlerName);

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
