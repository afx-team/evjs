import fs from "node:fs/promises";
import path from "node:path";
import type {
  AssetGroup,
  BuildOutput,
  ComponentModel,
  PublicPathOutput,
  RenderMode,
  RuntimeOutput,
  ServerRuntime,
} from "@evjs/shared/manifest";
import type { Plugin } from "./plugin.js";

export interface DeploymentArtifactOptions {
  platform?: string;
  includeAssets?: boolean;
}

export interface NodeDeploymentAdapterOptions
  extends DeploymentArtifactOptions {
  artifactFileName?: string;
  serverFileName?: string;
  portEnv?: string;
  defaultPort?: number;
}

export interface StaticDeploymentAdapterOptions
  extends DeploymentArtifactOptions {
  artifactFileName?: string;
  redirectsFileName?: string;
}

export interface EdgeDeploymentAdapterOptions
  extends DeploymentArtifactOptions {
  artifactFileName?: string;
  workerFileName?: string;
  assetsBinding?: string;
}

export interface NodeDeploymentFiles {
  artifactFileName: string;
  artifact: DeploymentArtifact;
  serverFileName?: string;
  serverModule?: string;
}

export interface StaticDeploymentFiles {
  artifactFileName: string;
  artifact: DeploymentArtifact;
  redirectsFileName: string;
  redirects: string;
}

export interface EdgeDeploymentFiles {
  artifactFileName: string;
  artifact: DeploymentArtifact;
  workerFileName?: string;
  workerModule?: string;
}

export interface DeploymentArtifact {
  version: 1;
  platform?: string;
  buildId: string;
  distDir: string;
  paths?: BuildOutput["paths"];
  publicPath: PublicPathOutput;
  runtime: RuntimeOutput;
  assets?: Record<string, AssetGroup>;
  apps: Record<string, DeploymentApp>;
  pages: Record<string, DeploymentPage>;
  routes: DeploymentRoute[];
  server?: DeploymentServer;
  remotes?: BuildOutput["remotes"];
  rsc?: DeploymentRsc;
  metadata?: Record<string, unknown>;
}

export interface DeploymentApp {
  assets?: AssetGroup;
  entry?: string;
  mount?: string;
}

export interface DeploymentPage {
  assets?: AssetGroup;
  path?: string;
  routeId?: string;
  render: RenderMode;
  componentModel?: ComponentModel;
  hydrate?: string;
  mount?: string;
}

export interface DeploymentRoute {
  id: string;
  path: string;
  appId?: string;
  pageId?: string;
  render?: RenderMode;
  runtime?: ServerRuntime;
}

export interface DeploymentServer {
  entry?: string;
  basePath?: string;
  fn?: string;
  ppr?: string;
  rsc?: string;
  assets?: AssetGroup;
  renderers: string[];
  functions: string[];
  routes: Array<{
    path: string;
    methods: string[];
  }>;
}

export interface DeploymentRsc {
  endpoint?: string;
  pages: string[];
  clientReferences: string[];
  serverReferences: string[];
}

export function createDeploymentArtifact(
  output: BuildOutput,
  options: DeploymentArtifactOptions = {},
): DeploymentArtifact {
  const includeAssets = options.includeAssets ?? true;
  const artifact: DeploymentArtifact = {
    version: 1,
    ...(options.platform ? { platform: options.platform } : {}),
    buildId: output.buildId,
    distDir: output.distDir,
    paths: getDeploymentOutputPaths(output),
    publicPath: output.publicPath,
    runtime: output.runtime,
    ...(includeAssets ? { assets: output.assets } : {}),
    apps: Object.fromEntries(
      Object.entries(output.apps).map(([id, app]) => [
        id,
        {
          ...(includeAssets ? { assets: app.assets } : {}),
          entry: app.entry,
          mount: app.mount,
        },
      ]),
    ),
    pages: Object.fromEntries(
      Object.entries(output.pages).map(([id, page]) => [
        id,
        {
          ...(includeAssets ? { assets: page.assets } : {}),
          path: page.path,
          routeId: page.routeId,
          render: page.render,
          componentModel: page.componentModel,
          hydrate: page.hydrate,
          mount: page.mount,
        },
      ]),
    ),
    routes: output.routes.map((route) => ({
      id: route.id,
      path: route.path,
      appId: route.appId,
      pageId: route.pageId,
      render: route.render,
      runtime: route.runtime,
    })),
    ...(output.server
      ? {
          server: {
            entry: output.server.entry,
            basePath: output.runtime.server?.basePath,
            fn: output.runtime.server?.fn,
            ppr: output.runtime.server?.ppr,
            rsc: output.runtime.server?.rsc,
            ...(includeAssets ? { assets: output.server.assets } : {}),
            renderers: Object.keys(output.server.renderers ?? {}),
            functions: Object.keys(output.server.functions),
            routes: output.server.routes.map((route) => ({
              path: route.path,
              methods: route.methods,
            })),
          },
        }
      : {}),
    ...(output.remotes ? { remotes: output.remotes } : {}),
    ...(output.rsc
      ? {
          rsc: {
            endpoint: output.rsc.endpoint,
            pages: Object.keys(output.rsc.pages ?? {}),
            clientReferences: Object.keys(output.rsc.clientReferences ?? {}),
            serverReferences: Object.keys(output.rsc.serverReferences ?? {}),
          },
        }
      : {}),
    ...(output.deployment ? { metadata: output.deployment } : {}),
  };

  return artifact;
}

export function createNodeDeploymentFiles(
  output: BuildOutput,
  options: NodeDeploymentAdapterOptions = {},
): NodeDeploymentFiles {
  const artifactFileName = options.artifactFileName ?? "deployment.node.json";
  const serverFileName = output.server?.entry
    ? (options.serverFileName ?? "server.mjs")
    : undefined;

  return {
    artifactFileName,
    artifact: createDeploymentArtifact(output, {
      ...options,
      platform: options.platform ?? "node",
    }),
    ...(serverFileName
      ? {
          serverFileName,
          serverModule: createNodeServerModule(output, options),
        }
      : {}),
  };
}

export function nodeDeploymentAdapter(
  options: NodeDeploymentAdapterOptions = {},
): Plugin {
  return {
    name: "node-deployment-adapter",
    setup() {
      return {
        async buildEnd({ output }) {
          const files = createNodeDeploymentFiles(output, options);
          const rootDir = resolveOutputDir(output, "rootDir");
          await fs.mkdir(rootDir, { recursive: true });
          await fs.writeFile(
            path.join(rootDir, files.artifactFileName),
            JSON.stringify(files.artifact, null, 2),
            "utf-8",
          );
          if (files.serverFileName && files.serverModule) {
            await fs.writeFile(
              path.join(rootDir, files.serverFileName),
              files.serverModule,
              "utf-8",
            );
          }
        },
      };
    },
  };
}

export function createStaticDeploymentFiles(
  output: BuildOutput,
  options: StaticDeploymentAdapterOptions = {},
): StaticDeploymentFiles {
  const artifactFileName = options.artifactFileName ?? "deployment.static.json";
  const redirectsFileName = options.redirectsFileName ?? "_redirects";

  return {
    artifactFileName,
    artifact: createDeploymentArtifact(output, {
      ...options,
      platform: options.platform ?? "static",
    }),
    redirectsFileName,
    redirects: createStaticRedirects(output),
  };
}

export function staticDeploymentAdapter(
  options: StaticDeploymentAdapterOptions = {},
): Plugin {
  return {
    name: "static-deployment-adapter",
    setup() {
      return {
        async buildEnd({ output }) {
          const files = createStaticDeploymentFiles(output, options);
          const publicDir = resolveOutputDir(output, "publicDir");
          await fs.mkdir(publicDir, { recursive: true });
          await fs.writeFile(
            path.join(publicDir, files.artifactFileName),
            JSON.stringify(files.artifact, null, 2),
            "utf-8",
          );
          await fs.writeFile(
            path.join(publicDir, files.redirectsFileName),
            files.redirects,
            "utf-8",
          );
        },
      };
    },
  };
}

export function createEdgeDeploymentFiles(
  output: BuildOutput,
  options: EdgeDeploymentAdapterOptions = {},
): EdgeDeploymentFiles {
  const artifactFileName = options.artifactFileName ?? "deployment.edge.json";
  const workerFileName = output.server?.entry
    ? (options.workerFileName ?? "worker.mjs")
    : undefined;

  return {
    artifactFileName,
    artifact: createDeploymentArtifact(output, {
      ...options,
      platform: options.platform ?? "edge",
    }),
    ...(workerFileName
      ? {
          workerFileName,
          workerModule: createEdgeWorkerModule(output, options),
        }
      : {}),
  };
}

export function edgeDeploymentAdapter(
  options: EdgeDeploymentAdapterOptions = {},
): Plugin {
  return {
    name: "edge-deployment-adapter",
    setup() {
      return {
        async buildEnd({ output }) {
          const files = createEdgeDeploymentFiles(output, options);
          const rootDir = resolveOutputDir(output, "rootDir");
          await fs.mkdir(rootDir, { recursive: true });
          await fs.writeFile(
            path.join(rootDir, files.artifactFileName),
            JSON.stringify(files.artifact, null, 2),
            "utf-8",
          );
          if (files.workerFileName && files.workerModule) {
            await fs.writeFile(
              path.join(rootDir, files.workerFileName),
              files.workerModule,
              "utf-8",
            );
          }
        },
      };
    },
  };
}

function getDeploymentOutputPaths(
  output: BuildOutput,
): NonNullable<BuildOutput["paths"]> {
  if (output.paths) return output.paths;

  const serverEnabled = Boolean(output.server);
  return {
    rootDir: output.distDir,
    publicDir: serverEnabled
      ? joinManifestPath(output.distDir, "client")
      : output.distDir,
    ...(serverEnabled
      ? {
          serverDir: joinManifestPath(output.distDir, "server"),
        }
      : {}),
  };
}

function resolveOutputDir(
  output: BuildOutput,
  key: keyof NonNullable<BuildOutput["paths"]>,
): string {
  const paths = getDeploymentOutputPaths(output);
  return path.resolve(paths[key] ?? paths.rootDir);
}

function getPublicDirRelativeToRoot(output: BuildOutput): string {
  const paths = getDeploymentOutputPaths(output);
  const relative = path.relative(paths.rootDir, paths.publicDir);
  return relative || ".";
}

function joinManifestPath(...parts: string[]): string {
  return parts
    .map((part, index) =>
      index === 0 ? part.replace(/\/+$/, "") : part.replace(/^\/+|\/+$/g, ""),
    )
    .filter(Boolean)
    .join("/");
}

function createNodeServerModule(
  output: BuildOutput,
  options: NodeDeploymentAdapterOptions,
): string {
  const serverEntry = output.server?.entry;
  const staticFallback = getStaticFallbackHtml(output);
  const frameworkBasePath = output.runtime.server?.basePath ?? "/__evjs";
  const frameworkRoutes = getFrameworkServerRoutes(output).map(toNodeRoutePath);
  const clientRoot = getPublicDirRelativeToRoot(output);
  const portEnv = options.portEnv ?? "PORT";
  const defaultPort = options.defaultPort ?? 3000;

  return `import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "@evjs/server/node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(__dirname, ${JSON.stringify(clientRoot)});
const serverDir = path.join(__dirname, "server");
const serverEntry = ${JSON.stringify(serverEntry ?? "")};
const frameworkBasePath = ${JSON.stringify(frameworkBasePath)};
const frameworkRoutes = ${JSON.stringify(frameworkRoutes, null, 2)};
const staticFallback = ${JSON.stringify(staticFallback ?? "")};
const manifest =
  (await readJsonIfExists(path.join(serverDir, "build-output.json"))) ??
  (await readJsonIfExists(path.join(__dirname, "manifest.json")));
if (manifest) globalThis.__EVJS_MANIFEST__ = manifest;
globalThis.__EVJS_SERVER_MODULE_LOADER__ = async (asset) => {
  const mod = await import(pathToFileURL(path.resolve(serverDir, asset)).href);
  return normalizeServerModule(mod);
};
const serverHandler = serverEntry
  ? unwrapServerHandler(
      await import(pathToFileURL(path.join(serverDir, serverEntry)).href),
    )
  : undefined;
if (serverEntry && typeof serverHandler?.fetch !== "function") {
  throw new Error("[evjs] Server entry must export a fetch handler.");
}

const app = {
  async fetch(request) {
    const url = new URL(request.url);
    if (${serverEntry ? "isFrameworkRequest(url.pathname)" : "false"}) {
      return serverHandler.fetch(request);
    }

    const staticResponse = await serveStaticAsset(url.pathname);
    if (staticResponse) return staticResponse;

    if (staticFallback) {
      const fallbackResponse = await serveFile(path.join(clientRoot, staticFallback));
      if (fallbackResponse) return fallbackResponse;
    }

    return new Response("Not Found", { status: 404 });
  },
};

serve(app, { port: Number(process.env[${JSON.stringify(portEnv)}] ?? ${defaultPort}) });

function isFrameworkRequest(pathname) {
  return (
    pathname === frameworkBasePath ||
    pathname.startsWith(\`\${frameworkBasePath}/\`) ||
    frameworkRoutes.some((routePath) => routePathMatches(routePath, pathname))
  );
}

function routePathMatches(routePath, pathname) {
  const routeSegments = splitPath(routePath);
  const pathSegments = splitPath(pathname);
  if (routeSegments.length !== pathSegments.length) {
    if (routePath.endsWith("/*")) {
      const prefix = routePath.slice(0, -2);
      return pathname === prefix || pathname.startsWith(\`\${prefix}/\`);
    }
    return false;
  }

  return routeSegments.every((segment, index) => {
    const value = pathSegments[index];
    return segment === value || segment.startsWith(":") || segment === "*";
  });
}

function splitPath(pathname) {
  return normalizePathname(pathname).split("/").filter(Boolean);
}

function normalizePathname(pathname) {
  if (!pathname.startsWith("/")) return normalizePathname(\`/\${pathname}\`);
  if (pathname.length === 1) return pathname;
  return pathname.replace(/\\/+$/, "");
}

async function serveStaticAsset(pathname) {
  if (pathname === "/") return undefined;

  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname.replace(/^\\/+/, ""));
  } catch {
    return undefined;
  }
  if (!relativePath || relativePath.includes("\\0")) return undefined;

  const assetPath = path.normalize(path.join(clientRoot, relativePath));
  if (!assetPath.startsWith(\`\${clientRoot}\${path.sep}\`)) return undefined;
  return serveFile(assetPath);
}

async function serveFile(filePath) {
  try {
    const body = await readFile(filePath);
    return new Response(body, {
      headers: {
        "content-type": contentTypeFor(filePath),
      },
    });
  } catch {
    return undefined;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf-8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function normalizeServerModule(mod) {
  const nested = mod && typeof mod.default === "object" ? mod.default : undefined;
  return nested && ("default" in nested || "render" in nested || "fetch" in nested)
    ? nested
    : mod;
}

function unwrapServerHandler(mod) {
  const first = normalizeServerModule(mod);
  if (first && typeof first === "object" && "default" in first) {
    return first.default;
  }
  return first;
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}
`;
}

function createEdgeWorkerModule(
  output: BuildOutput,
  options: EdgeDeploymentAdapterOptions,
): string {
  const serverEntry = output.server?.entry;
  const staticFallback = getStaticFallbackHtml(output);
  const frameworkBasePath = output.runtime.server?.basePath ?? "/__evjs";
  const frameworkRoutes = getFrameworkServerRoutes(output).map(toNodeRoutePath);
  const assetsBinding = options.assetsBinding ?? "ASSETS";
  const serverImportPath = serverEntry ? `./server/${serverEntry}` : undefined;
  const frameworkRequestCondition = serverEntry
    ? "isFrameworkRequest(url.pathname)"
    : "false";

  return [
    `const manifest = ${JSON.stringify(output, null, 2)};`,
    "globalThis.__EVJS_MANIFEST__ = manifest;",
    "globalThis.__EVJS_SERVER_MODULE_LOADER__ = async (asset) => {",
    '  return normalizeServerModule(await import("./server/" + asset));',
    "};",
    serverImportPath
      ? `const serverHandler = unwrapServerHandler(await import(${JSON.stringify(serverImportPath)}));`
      : "const serverHandler = undefined;",
    'if (serverHandler && typeof serverHandler.fetch !== "function") {',
    '  throw new Error("[evjs] Server entry must export a fetch handler.");',
    "}",
    `const frameworkBasePath = ${JSON.stringify(frameworkBasePath)};`,
    `const frameworkRoutes = ${JSON.stringify(frameworkRoutes, null, 2)};`,
    `const staticFallback = ${JSON.stringify(staticFallback ?? "")};`,
    `const assetsBinding = ${JSON.stringify(assetsBinding)};`,
    "",
    "export default {",
    "  async fetch(request, env, ctx) {",
    "    const url = new URL(request.url);",
    `    if (${frameworkRequestCondition}) {`,
    "      return serverHandler.fetch(request, env, ctx);",
    "    }",
    "",
    "    const staticResponse = await serveStaticAsset(request, env);",
    "    if (staticResponse && staticResponse.status !== 404) return staticResponse;",
    "",
    "    if (staticFallback) {",
    '      const fallbackUrl = new URL("/" + staticFallback, request.url);',
    "      const fallbackResponse = await fetchAsset(new Request(fallbackUrl, request), env);",
    "      if (fallbackResponse && fallbackResponse.status !== 404) return fallbackResponse;",
    "    }",
    "",
    '    return new Response("Not Found", { status: 404 });',
    "  },",
    "};",
    "",
    "function isFrameworkRequest(pathname) {",
    "  return (",
    "    pathname === frameworkBasePath ||",
    '    pathname.startsWith(frameworkBasePath + "/") ||',
    "    frameworkRoutes.some((routePath) => routePathMatches(routePath, pathname))",
    "  );",
    "}",
    "",
    "function routePathMatches(routePath, pathname) {",
    "  const routeSegments = splitPath(routePath);",
    "  const pathSegments = splitPath(pathname);",
    "  if (routeSegments.length !== pathSegments.length) {",
    '    if (routePath.endsWith("/*")) {',
    "      const prefix = routePath.slice(0, -2);",
    '      return pathname === prefix || pathname.startsWith(prefix + "/");',
    "    }",
    "    return false;",
    "  }",
    "",
    "  return routeSegments.every((segment, index) => {",
    "    const value = pathSegments[index];",
    '    return segment === value || segment.startsWith(":") || segment === "*";',
    "  });",
    "}",
    "",
    "function splitPath(pathname) {",
    '  return normalizePathname(pathname).split("/").filter(Boolean);',
    "}",
    "",
    "function normalizePathname(pathname) {",
    '  if (!pathname.startsWith("/")) return normalizePathname("/" + pathname);',
    "  if (pathname.length === 1) return pathname;",
    '  return pathname.replace(/\\/+$/, "");',
    "}",
    "",
    "function normalizeServerModule(mod) {",
    '  const nested = mod && typeof mod.default === "object" ? mod.default : undefined;',
    '  return nested && ("default" in nested || "render" in nested || "fetch" in nested)',
    "    ? nested",
    "    : mod;",
    "}",
    "",
    "function unwrapServerHandler(mod) {",
    "  const first = normalizeServerModule(mod);",
    '  if (first && typeof first === "object" && "default" in first) {',
    "    return first.default;",
    "  }",
    "  return first;",
    "}",
    "",
    "async function serveStaticAsset(request, env) {",
    "  const url = new URL(request.url);",
    '  if (url.pathname === "/") return undefined;',
    "  return fetchAsset(request, env);",
    "}",
    "",
    "async function fetchAsset(request, env) {",
    "  const assets = env?.[assetsBinding];",
    "  if (assets?.fetch) return assets.fetch(request);",
    "  return undefined;",
    "}",
    "",
  ].join("\n");
}

function createStaticRedirects(output: BuildOutput): string {
  const lines = new Set<string>();

  for (const route of output.routes) {
    if (route.pageId) {
      const page = output.pages[route.pageId];
      if (page && (page.render === "csr" || page.render === "ssg")) {
        lines.add(`${toStaticRoutePath(route.path)} /${route.pageId}.html 200`);
      }
      continue;
    }

    if (route.appId) {
      lines.add(
        toStaticRoutePath(route.path) +
          " /" +
          getAppHtmlFileName(route.appId) +
          " 200",
      );
    }
  }

  const fallback = getStaticFallbackHtml(output);
  if (fallback) {
    lines.add(`/* /${fallback} 200`);
  }

  return `${[...lines].join("\n")}\n`;
}

function getAppHtmlFileName(appId: string): string {
  return appId === "default" ? "index.html" : `${appId}.html`;
}

function getStaticFallbackHtml(output: BuildOutput): string | undefined {
  if (output.apps.default) return "index.html";
  const firstAppId = Object.keys(output.apps)[0];
  if (firstAppId) return `${firstAppId}.html`;
  const firstPageId = Object.keys(output.pages)[0];
  return firstPageId ? `${firstPageId}.html` : undefined;
}

function getFrameworkServerRoutes(output: BuildOutput): string[] {
  const routes = new Set<string>();

  for (const route of output.server?.routes ?? []) {
    routes.add(route.path);
  }

  for (const route of output.routes) {
    const page = route.pageId ? output.pages[route.pageId] : undefined;
    if (page && page.render !== "csr" && page.render !== "ssg") {
      routes.add(route.path);
    }
  }

  return [...routes].sort();
}

function toNodeRoutePath(routePath: string): string {
  return routePath
    .split("/")
    .map((segment) => {
      if (segment.startsWith("$")) return `:${segment.slice(1)}`;
      return segment;
    })
    .join("/");
}

function toStaticRoutePath(routePath: string): string {
  return routePath
    .split("/")
    .map((segment) => {
      if (segment.startsWith("$")) return `:${segment.slice(1)}`;
      return segment;
    })
    .join("/");
}
