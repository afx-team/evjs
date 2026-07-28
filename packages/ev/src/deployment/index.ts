import path from "node:path";
import type {
  BuildOutput,
  DeploymentDocumentOutput,
  DeploymentMetadata,
  DeploymentRouteOutput,
  DeploymentServerOutput,
} from "@evjs/shared/manifest";
import {
  collectBuildOutputServerJavaScriptArtifacts,
  createDeploymentMetadata,
} from "@evjs/shared/manifest";
import {
  type DeploymentOutputReservation,
  declareDeploymentOutputReservations,
} from "../_internal/build/deployment-output-reservations.js";
import {
  createFrameworkRuntime,
  type FrameworkRuntimeOutput,
} from "../_internal/build/framework-runtime.js";
import {
  assertPortableRelativeArtifactPath,
  FRAMEWORK_DEPLOYMENT_METADATA_FILE_NAME,
} from "../_internal/build/portable-artifact-path.js";
import type { Plugin } from "../plugin/index.js";
import {
  assertDeploymentFileNamesAvailable,
  assertDistinctDeploymentFileNames,
  resolveDeploymentFileName,
  writeDeploymentFile,
} from "./output-files.js";

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
  frameworkRuntime?: FrameworkRuntimeOutput;
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
  frameworkRuntime?: FrameworkRuntimeOutput;
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
  compatibility: StaticDeploymentCompatibility;
}

export interface EdgeDeploymentFiles {
  artifactFileName: string;
  artifact: DeploymentArtifact;
  workerFileName?: string;
  workerModule?: string;
}

export interface DeploymentArtifact extends DeploymentMetadata {
  platform?: string;
}

export type DeploymentDocument = DeploymentDocumentOutput;
export type DeploymentRoute = DeploymentRouteOutput;
export type DeploymentServer = DeploymentServerOutput;

interface StaticDocumentRoute {
  path: string;
  /** Physical BuildOutput document; never derived from a decoded request path. */
  fileName: string;
}

export type StaticDeploymentUnsupportedCapability =
  | "server-functions"
  | "server-routes"
  | "ssr-pages"
  | "ppr-pages"
  | "rsc-pages";

export interface StaticDeploymentCompatibility {
  complete: boolean;
  unsupportedCapabilities: StaticDeploymentUnsupportedCapability[];
}

export function createDeploymentArtifact(
  output: BuildOutput,
  options: DeploymentArtifactOptions = {},
): DeploymentArtifact {
  return pruneUndefined({
    ...createDeploymentMetadata(output, {
      includeAssets: options.includeAssets,
    }),
    ...(options.platform ? { platform: options.platform } : {}),
  }) as DeploymentArtifact;
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function assertRootDeploymentFileNamesAvailable(
  adapterName: "nodeDeploymentAdapter" | "edgeDeploymentAdapter",
  artifactFileName: string,
  runtimeFileName: string | undefined,
  output: BuildOutput,
): void {
  const runtimeField =
    adapterName === "nodeDeploymentAdapter"
      ? "serverFileName"
      : "workerFileName";
  assertDeploymentFileNamesAvailable(
    [
      {
        field: `${adapterName}.artifactFileName`,
        fileName: artifactFileName,
      },
      ...(runtimeFileName
        ? [
            {
              field: `${adapterName}.${runtimeField}`,
              fileName: runtimeFileName,
            },
          ]
        : []),
    ],
    [
      {
        owner: "deployment metadata",
        fileName: FRAMEWORK_DEPLOYMENT_METADATA_FILE_NAME,
      },
      {
        owner: "public output directory",
        fileName: getPublicDirRelativeToRoot(output),
      },
      {
        owner: "server output directory",
        fileName: getServerDirRelativeToRoot(output),
      },
    ],
  );
}

function collectFrameworkPublicArtifacts(output: BuildOutput): Array<{
  owner: string;
  fileName: string;
}> {
  const artifacts: Array<{ owner: string; fileName: string }> = [];
  for (const [applicationId, application] of Object.entries(output.apps)) {
    for (const fileName of [
      application.document?.fileName,
      ...(application.document?.aliases ?? []),
    ]) {
      if (fileName) {
        artifacts.push({
          owner: `Application "${applicationId}" HTML Document`,
          fileName,
        });
      }
    }
    collectPortableRelativeAssetArtifacts(
      artifacts,
      `Application "${applicationId}"`,
      application.assets,
    );
  }
  for (const [pageId, page] of Object.entries(output.pages)) {
    for (const fileName of [
      page.document?.fileName,
      ...(page.document?.aliases ?? []),
    ]) {
      if (fileName) {
        artifacts.push({
          owner: `Page "${pageId}" HTML Document`,
          fileName,
        });
      }
    }
    collectPortableRelativeAssetArtifacts(
      artifacts,
      `Page "${pageId}"`,
      page.assets,
    );
  }
  return artifacts;
}

function collectPortableRelativeAssetArtifacts(
  artifacts: Array<{ owner: string; fileName: string }>,
  owner: string,
  assets: { js: string[]; css: string[] },
): void {
  for (const [kind, files] of [
    ["JavaScript", assets.js],
    ["CSS", assets.css],
  ] as const) {
    for (const fileName of files) {
      if (!isPortableRelativeBrowserAsset(fileName)) continue;
      artifacts.push({ owner: `${owner} ${kind} asset`, fileName });
    }
  }
}

function isPortableRelativeBrowserAsset(value: unknown): value is string {
  try {
    assertPortableRelativeArtifactPath(value, "browser asset");
    return true;
  } catch {
    // Browser AssetGroups may contain absolute, root-relative, or data URLs.
    return false;
  }
}

export function createNodeDeploymentFiles(
  output: BuildOutput,
  options: NodeDeploymentAdapterOptions = {},
): NodeDeploymentFiles {
  const { artifactFileName, serverFileName } = resolveNodeDeploymentFileNames(
    output,
    options,
  );

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

function resolveNodeDeploymentFileNames(
  output: BuildOutput,
  options: NodeDeploymentAdapterOptions,
): Pick<NodeDeploymentFiles, "artifactFileName" | "serverFileName"> {
  const artifactFileName = resolveDeploymentFileName(
    options.artifactFileName,
    "deployment.node.json",
    "nodeDeploymentAdapter.artifactFileName",
  );
  const serverFileName = output.server.entry
    ? resolveDeploymentFileName(
        options.serverFileName,
        "server.mjs",
        "nodeDeploymentAdapter.serverFileName",
      )
    : undefined;
  assertDistinctDeploymentFileNames(
    {
      field: "nodeDeploymentAdapter.artifactFileName",
      fileName: artifactFileName,
    },
    serverFileName
      ? {
          field: "nodeDeploymentAdapter.serverFileName",
          fileName: serverFileName,
        }
      : undefined,
  );
  assertRootDeploymentFileNamesAvailable(
    "nodeDeploymentAdapter",
    artifactFileName,
    serverFileName,
    output,
  );
  return { artifactFileName, serverFileName };
}

export function nodeDeploymentAdapter(
  options: NodeDeploymentAdapterOptions = {},
): Plugin {
  return {
    name: "node-deployment-adapter",
    setup(ctx) {
      return {
        buildEnd: declareDeploymentOutputReservations(
          ({ output }) => {
            const files = resolveNodeDeploymentFileNames(output, options);
            const rootDir = resolveOutputDir(ctx.cwd, output, "rootDir");
            return [
              deploymentOutput(
                ctx.cwd,
                rootDir,
                "nodeDeploymentAdapter.artifactFileName",
                files.artifactFileName,
              ),
              ...(files.serverFileName
                ? [
                    deploymentOutput(
                      ctx.cwd,
                      rootDir,
                      "nodeDeploymentAdapter.serverFileName",
                      files.serverFileName,
                    ),
                  ]
                : []),
            ];
          },
          async ({ output, frameworkRuntime }) => {
            const files = createNodeDeploymentFiles(output, {
              ...options,
              frameworkRuntime,
            });
            const rootDir = resolveOutputDir(ctx.cwd, output, "rootDir");
            await writeDeploymentFile(
              ctx.cwd,
              rootDir,
              files.artifactFileName,
              JSON.stringify(files.artifact, null, 2),
            );
            if (files.serverFileName && files.serverModule) {
              await writeDeploymentFile(
                ctx.cwd,
                rootDir,
                files.serverFileName,
                files.serverModule,
              );
            }
          },
        ),
      };
    },
  };
}

export function createStaticDeploymentFiles(
  output: BuildOutput,
  options: StaticDeploymentAdapterOptions = {},
): StaticDeploymentFiles {
  const { artifactFileName, redirectsFileName } =
    resolveStaticDeploymentFileNames(output, options);
  const compatibility = analyzeStaticDeploymentCompatibility(output);
  const artifact = createDeploymentArtifact(output, {
    ...options,
    platform: options.platform ?? "static",
  });
  artifact.metadata = {
    ...(artifact.metadata ?? {}),
    static: compatibility,
  };

  return {
    artifactFileName,
    artifact,
    redirectsFileName,
    redirects: createStaticRedirects(output, compatibility),
    compatibility,
  };
}

function resolveStaticDeploymentFileNames(
  output: BuildOutput,
  options: StaticDeploymentAdapterOptions,
): Pick<StaticDeploymentFiles, "artifactFileName" | "redirectsFileName"> {
  const artifactFileName = resolveDeploymentFileName(
    options.artifactFileName,
    "deployment.static.json",
    "staticDeploymentAdapter.artifactFileName",
  );
  const redirectsFileName = resolveDeploymentFileName(
    options.redirectsFileName,
    "_redirects",
    "staticDeploymentAdapter.redirectsFileName",
  );
  assertDistinctDeploymentFileNames(
    {
      field: "staticDeploymentAdapter.artifactFileName",
      fileName: artifactFileName,
    },
    {
      field: "staticDeploymentAdapter.redirectsFileName",
      fileName: redirectsFileName,
    },
  );
  assertDeploymentFileNamesAvailable(
    [
      {
        field: "staticDeploymentAdapter.artifactFileName",
        fileName: artifactFileName,
      },
      {
        field: "staticDeploymentAdapter.redirectsFileName",
        fileName: redirectsFileName,
      },
    ],
    collectFrameworkPublicArtifacts(output),
  );
  return { artifactFileName, redirectsFileName };
}

export function staticDeploymentAdapter(
  options: StaticDeploymentAdapterOptions = {},
): Plugin {
  return {
    name: "static-deployment-adapter",
    setup(ctx) {
      return {
        buildEnd: declareDeploymentOutputReservations(
          ({ output }) => {
            const files = resolveStaticDeploymentFileNames(output, options);
            const publicDir = resolveOutputDir(ctx.cwd, output, "publicDir");
            return [
              deploymentOutput(
                ctx.cwd,
                publicDir,
                "staticDeploymentAdapter.artifactFileName",
                files.artifactFileName,
              ),
              deploymentOutput(
                ctx.cwd,
                publicDir,
                "staticDeploymentAdapter.redirectsFileName",
                files.redirectsFileName,
              ),
            ];
          },
          async ({ output }) => {
            const files = createStaticDeploymentFiles(output, options);
            const publicDir = resolveOutputDir(ctx.cwd, output, "publicDir");
            await writeDeploymentFile(
              ctx.cwd,
              publicDir,
              files.artifactFileName,
              JSON.stringify(files.artifact, null, 2),
            );
            await writeDeploymentFile(
              ctx.cwd,
              publicDir,
              files.redirectsFileName,
              files.redirects,
            );
          },
        ),
      };
    },
  };
}

export function createEdgeDeploymentFiles(
  output: BuildOutput,
  options: EdgeDeploymentAdapterOptions = {},
): EdgeDeploymentFiles {
  const { artifactFileName, workerFileName } = resolveEdgeDeploymentFileNames(
    output,
    options,
  );

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

function resolveEdgeDeploymentFileNames(
  output: BuildOutput,
  options: EdgeDeploymentAdapterOptions,
): Pick<EdgeDeploymentFiles, "artifactFileName" | "workerFileName"> {
  const artifactFileName = resolveDeploymentFileName(
    options.artifactFileName,
    "deployment.edge.json",
    "edgeDeploymentAdapter.artifactFileName",
  );
  const workerFileName = output.server.entry
    ? resolveDeploymentFileName(
        options.workerFileName,
        "worker.mjs",
        "edgeDeploymentAdapter.workerFileName",
      )
    : undefined;
  assertDistinctDeploymentFileNames(
    {
      field: "edgeDeploymentAdapter.artifactFileName",
      fileName: artifactFileName,
    },
    workerFileName
      ? {
          field: "edgeDeploymentAdapter.workerFileName",
          fileName: workerFileName,
        }
      : undefined,
  );
  assertRootDeploymentFileNamesAvailable(
    "edgeDeploymentAdapter",
    artifactFileName,
    workerFileName,
    output,
  );
  return { artifactFileName, workerFileName };
}

export function edgeDeploymentAdapter(
  options: EdgeDeploymentAdapterOptions = {},
): Plugin {
  return {
    name: "edge-deployment-adapter",
    setup(ctx) {
      return {
        buildEnd: declareDeploymentOutputReservations(
          ({ output }) => {
            const files = resolveEdgeDeploymentFileNames(output, options);
            const rootDir = resolveOutputDir(ctx.cwd, output, "rootDir");
            return [
              deploymentOutput(
                ctx.cwd,
                rootDir,
                "edgeDeploymentAdapter.artifactFileName",
                files.artifactFileName,
              ),
              ...(files.workerFileName
                ? [
                    deploymentOutput(
                      ctx.cwd,
                      rootDir,
                      "edgeDeploymentAdapter.workerFileName",
                      files.workerFileName,
                    ),
                  ]
                : []),
            ];
          },
          async ({ output, frameworkRuntime }) => {
            const files = createEdgeDeploymentFiles(output, {
              ...options,
              frameworkRuntime,
            });
            const rootDir = resolveOutputDir(ctx.cwd, output, "rootDir");
            await writeDeploymentFile(
              ctx.cwd,
              rootDir,
              files.artifactFileName,
              JSON.stringify(files.artifact, null, 2),
            );
            if (files.workerFileName && files.workerModule) {
              await writeDeploymentFile(
                ctx.cwd,
                rootDir,
                files.workerFileName,
                files.workerModule,
              );
            }
          },
        ),
      };
    },
  };
}

function deploymentOutput(
  cwd: string,
  outputDir: string,
  field: string,
  fileName: string,
): DeploymentOutputReservation {
  return { cwd, outputDir, field, fileName };
}

function getDeploymentOutputPaths(
  output: BuildOutput,
): NonNullable<BuildOutput["paths"]> {
  return output.paths;
}

function resolveOutputDir(
  cwd: string,
  output: BuildOutput,
  key: keyof NonNullable<BuildOutput["paths"]>,
): string {
  const paths = getDeploymentOutputPaths(output);
  return path.resolve(cwd, paths[key] ?? paths.rootDir);
}

function getPublicDirRelativeToRoot(output: BuildOutput): string {
  return getOutputDirRelativeToRoot(output, "publicDir");
}

function getServerDirRelativeToRoot(output: BuildOutput): string {
  return getOutputDirRelativeToRoot(output, "serverDir");
}

function getOutputDirRelativeToRoot(
  output: BuildOutput,
  key: "publicDir" | "serverDir",
): string {
  const paths = getDeploymentOutputPaths(output);
  const relative = path.relative(paths.rootDir, paths[key]);
  return relative ? relative.split(path.sep).join(path.posix.sep) : ".";
}

function createNodeServerModule(
  output: BuildOutput,
  options: NodeDeploymentAdapterOptions,
): string {
  const serverEntry = output.server.entry;
  const staticFallback = getStaticFallbackHtml(output);
  const staticRoutes = getStaticDocumentRoutes(output).map((route) => ({
    path: toNodeRoutePath(route.path),
    file: route.fileName,
  }));
  const frameworkExactEndpointPaths = getFrameworkExactEndpointPaths(
    output,
  ).map(toAbsoluteNodeRoutePath);
  const frameworkSubtreeEndpointPaths = getFrameworkSubtreeEndpointPaths(
    output,
  ).map(toAbsoluteNodeRoutePath);
  const frameworkRoutes = getFrameworkServerRoutes(output).map(toNodeRoutePath);
  const staticAssetPrefix = getStaticAssetPrefix(output.publicPath);
  const clientRoot = getPublicDirRelativeToRoot(output);
  const serverRoot = getServerDirRelativeToRoot(output);
  const portEnv = options.portEnv ?? "PORT";
  const defaultPort = options.defaultPort ?? 3000;
  const frameworkRuntime =
    options.frameworkRuntime ?? createFrameworkRuntime(output);
  const serverArtifacts = collectBuildOutputServerJavaScriptArtifacts(
    output,
    "Node deployment BuildOutput",
  );

  return `import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "@evjs/ev/_internal/server/node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(__dirname, ${JSON.stringify(clientRoot)});
const serverDir = path.join(__dirname, ${JSON.stringify(serverRoot)});
const serverEntry = ${JSON.stringify(serverEntry ?? "")};
const serverArtifacts = new Set(${JSON.stringify(serverArtifacts)});
const frameworkExactEndpointPaths = ${JSON.stringify(frameworkExactEndpointPaths, null, 2)};
const frameworkSubtreeEndpointPaths = ${JSON.stringify(frameworkSubtreeEndpointPaths, null, 2)};
const frameworkRoutes = ${JSON.stringify(frameworkRoutes, null, 2)};
const staticRoutes = ${JSON.stringify(staticRoutes, null, 2)};
const staticFallback = ${JSON.stringify(staticFallback ?? "")};
const staticAssetPrefix = ${JSON.stringify(staticAssetPrefix ?? "")};
globalThis.__EVJS_FRAMEWORK_RUNTIME__ = ${JSON.stringify(frameworkRuntime, null, 2)};
globalThis.__EVJS_SERVER_MODULE_LOADER__ = async (asset) => {
  const mod = await import(pathToFileURL(resolveServerArtifact(asset)).href);
  return normalizeServerModule(mod);
};
const serverHandler = serverEntry
  ? unwrapServerHandler(
      await import(pathToFileURL(resolveServerArtifact(serverEntry)).href),
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

    const staticRoute = findStaticRoute(url.pathname);
    if (staticRoute) {
      const staticRouteResponse = await serveFile(path.join(clientRoot, staticRoute.file));
      if (staticRouteResponse) return staticRouteResponse;
    }

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
    frameworkExactEndpointPaths.some((endpointPath) =>
      routePathMatches(endpointPath, pathname)
    ) ||
    frameworkSubtreeEndpointPaths.some((endpointPath) =>
      pathIsAtOrBelow(pathname, endpointPath)
    ) ||
    frameworkRoutes.some((routePath) => routePathMatches(routePath, pathname))
  );
}

function findStaticRoute(pathname) {
  return staticRoutes.find((route) => routePathMatches(route.path, pathname));
}

${createGeneratedRouteMatcherModule()}

async function serveStaticAsset(pathname) {
  const assetPathname = stripStaticAssetPrefix(pathname);
  if (assetPathname === "/") return undefined;

  let relativePath;
  try {
    relativePath = decodeURIComponent(assetPathname.replace(/^\\/+/, ""));
  } catch {
    return undefined;
  }
  if (!relativePath || relativePath.includes("\\0")) return undefined;

  const assetPath = path.normalize(path.join(clientRoot, relativePath));
  if (!assetPath.startsWith(\`\${clientRoot}\${path.sep}\`)) return undefined;
  return serveFile(assetPath);
}

function stripStaticAssetPrefix(pathname) {
  if (!staticAssetPrefix || !pathIsAtOrBelow(pathname, staticAssetPrefix)) {
    return pathname;
  }
  const normalizedPathname = normalizePathname(pathname);
  const normalizedPrefix = normalizePathname(staticAssetPrefix);
  const suffix = normalizedPathname.slice(normalizedPrefix.length);
  return suffix ? suffix : "/";
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

function resolveServerArtifact(asset) {
  if (!serverArtifacts.has(asset)) {
    throw new Error(
      \`[evjs] Server artifact "\${String(asset)}" is not declared by BuildOutput.\`,
    );
  }
  const artifactPath = path.resolve(serverDir, ...asset.split("/"));
  const relativePath = path.relative(serverDir, artifactPath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(\`..\${path.sep}\`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      \`[evjs] Server artifact "\${String(asset)}" must resolve inside the server output directory.\`,
    );
  }
  return artifactPath;
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
    case ".cjs":
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
  const serverEntry = output.server.entry;
  const staticFallback = getStaticFallbackHtml(output);
  const staticFallbackUrl = staticFallback
    ? encodeArtifactUrlPath(staticFallback)
    : undefined;
  const staticRoutes = getStaticDocumentRoutes(output).map((route) => ({
    path: toNodeRoutePath(route.path),
    file: encodeArtifactUrlPath(route.fileName),
  }));
  const frameworkExactEndpointPaths = getFrameworkExactEndpointPaths(
    output,
  ).map(toAbsoluteNodeRoutePath);
  const frameworkSubtreeEndpointPaths = getFrameworkSubtreeEndpointPaths(
    output,
  ).map(toAbsoluteNodeRoutePath);
  const frameworkRoutes = getFrameworkServerRoutes(output).map(toNodeRoutePath);
  const staticAssetPrefix = getStaticAssetPrefix(output.publicPath);
  const assetsBinding = options.assetsBinding ?? "ASSETS";
  const serverRoot = getServerDirRelativeToRoot(output);
  const serverAssetPrefix = `./${serverRoot === "." ? "" : `${encodeArtifactUrlPath(serverRoot)}/`}`;
  const serverImportPath = serverEntry
    ? `${serverAssetPrefix}${encodeArtifactUrlPath(serverEntry)}`
    : undefined;
  const frameworkRequestCondition = serverEntry
    ? "isFrameworkRequest(url.pathname)"
    : "false";
  const frameworkRuntime =
    options.frameworkRuntime ?? createFrameworkRuntime(output);
  const serverArtifacts = collectBuildOutputServerJavaScriptArtifacts(
    output,
    "Edge deployment BuildOutput",
  );

  return [
    `const serverAssetPrefix = ${JSON.stringify(serverAssetPrefix)};`,
    `const serverArtifacts = new Set(${JSON.stringify(serverArtifacts)});`,
    `globalThis.__EVJS_FRAMEWORK_RUNTIME__ = ${JSON.stringify(frameworkRuntime, null, 2)};`,
    "globalThis.__EVJS_SERVER_MODULE_LOADER__ = async (asset) => {",
    "  return normalizeServerModule(await import(resolveServerArtifact(asset)));",
    "};",
    serverImportPath
      ? `const serverHandler = unwrapServerHandler(await import(${JSON.stringify(serverImportPath)}));`
      : "const serverHandler = undefined;",
    'if (serverHandler && typeof serverHandler.fetch !== "function") {',
    '  throw new Error("[evjs] Server entry must export a fetch handler.");',
    "}",
    `const frameworkExactEndpointPaths = ${JSON.stringify(frameworkExactEndpointPaths, null, 2)};`,
    `const frameworkSubtreeEndpointPaths = ${JSON.stringify(frameworkSubtreeEndpointPaths, null, 2)};`,
    `const frameworkRoutes = ${JSON.stringify(frameworkRoutes, null, 2)};`,
    `const staticRoutes = ${JSON.stringify(staticRoutes, null, 2)};`,
    `const staticFallback = ${JSON.stringify(staticFallbackUrl ?? "")};`,
    `const staticAssetPrefix = ${JSON.stringify(staticAssetPrefix ?? "")};`,
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
    "    const staticRoute = findStaticRoute(url.pathname);",
    "    if (staticRoute) {",
    '      const staticRouteUrl = new URL("/" + staticRoute.file, request.url);',
    "      const staticRouteResponse = await fetchAsset(new Request(staticRouteUrl, request), env);",
    "      if (staticRouteResponse && staticRouteResponse.status !== 404) return staticRouteResponse;",
    "    }",
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
    "    frameworkExactEndpointPaths.some((endpointPath) =>",
    "      routePathMatches(endpointPath, pathname)",
    "    ) ||",
    "    frameworkSubtreeEndpointPaths.some((endpointPath) =>",
    "      pathIsAtOrBelow(pathname, endpointPath)",
    "    ) ||",
    "    frameworkRoutes.some((routePath) => routePathMatches(routePath, pathname))",
    "  );",
    "}",
    "",
    "function findStaticRoute(pathname) {",
    "  return staticRoutes.find((route) => routePathMatches(route.path, pathname));",
    "}",
    "",
    createGeneratedRouteMatcherModule(),
    "",
    "function resolveServerArtifact(asset) {",
    "  if (!serverArtifacts.has(asset)) {",
    '    throw new Error("[evjs] Server artifact \\"" + String(asset) + "\\" is not declared by BuildOutput.");',
    "  }",
    '  return serverAssetPrefix + asset.split("/").map(encodeURIComponent).join("/");',
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
    "  const assetRequest = createStaticAssetRequest(request);",
    "  if (!assetRequest) return undefined;",
    "  return fetchAsset(assetRequest, env);",
    "}",
    "",
    "function createStaticAssetRequest(request) {",
    "  const url = new URL(request.url);",
    "  const assetPathname = stripStaticAssetPrefix(url.pathname);",
    '  if (assetPathname === "/") return undefined;',
    "  if (assetPathname === url.pathname) return request;",
    "  url.pathname = assetPathname;",
    "  return new Request(url, request);",
    "}",
    "",
    "function stripStaticAssetPrefix(pathname) {",
    "  if (!staticAssetPrefix || !pathIsAtOrBelow(pathname, staticAssetPrefix)) {",
    "    return pathname;",
    "  }",
    "  const normalizedPathname = normalizePathname(pathname);",
    "  const normalizedPrefix = normalizePathname(staticAssetPrefix);",
    "  const suffix = normalizedPathname.slice(normalizedPrefix.length);",
    '  return suffix ? suffix : "/";',
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

function createGeneratedRouteMatcherModule(): string {
  return [
    "function routePathMatches(routePath, pathname) {",
    "  const routeSegments = splitPath(routePath);",
    "  const pathSegments = splitPath(pathname);",
    '  if (pathSegments.some((segment) => segment === "")) return false;',
    '  const hasTerminalWildcard = routeSegments.at(-1) === "*";',
    "  const fixedSegments = hasTerminalWildcard",
    "    ? routeSegments.slice(0, -1)",
    "    : routeSegments;",
    "  if (!hasTerminalWildcard && fixedSegments.length !== pathSegments.length) return false;",
    "  if (hasTerminalWildcard && fixedSegments.length > pathSegments.length) return false;",
    "",
    "  return fixedSegments.every((segment, index) => {",
    "    const value = pathSegments[index];",
    '    return isDynamicRouteSegment(segment) ? value !== "" : staticRouteSegmentsEqual(segment, value);',
    "  });",
    "}",
    "",
    "function pathIsAtOrBelow(pathname, basePath) {",
    "  const pathSegments = splitPath(pathname);",
    "  const baseSegments = splitPath(basePath);",
    '  if (pathSegments.some((segment) => segment === "")) return false;',
    "  if (baseSegments.length > pathSegments.length) return false;",
    "  return baseSegments.every((segment, index) =>",
    "    staticRouteSegmentsEqual(segment, pathSegments[index])",
    "  );",
    "}",
    "",
    "function isDynamicRouteSegment(segment) {",
    '  return segment.startsWith(":") || segment.startsWith("$");',
    "}",
    "",
    "function staticRouteSegmentsEqual(left, right) {",
    "  return canonicalizeStaticRouteSegment(left) === canonicalizeStaticRouteSegment(right);",
    "}",
    "",
    "function canonicalizeStaticRouteSegment(segment) {",
    "  return safeDecodeRouteSegment(segment)",
    '    .replaceAll("%", "%25")',
    '    .replaceAll("/", "%2F");',
    "}",
    "",
    "function safeDecodeRouteSegment(segment) {",
    "  try {",
    "    return decodeURIComponent(segment);",
    "  } catch {",
    "    return segment;",
    "  }",
    "}",
    "",
    "function splitPath(pathname) {",
    "  const normalized = normalizePathname(pathname);",
    '  if (pathname === "/" || pathname === "") return [];',
    '  return normalized.slice(1).split("/");',
    "}",
    "",
    "function normalizePathname(pathname) {",
    '  if (!pathname.startsWith("/")) return normalizePathname("/" + pathname);',
    "  if (pathname.length === 1) return pathname;",
    '  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;',
    "}",
  ].join("\n");
}

function analyzeStaticDeploymentCompatibility(
  output: BuildOutput,
): StaticDeploymentCompatibility {
  const unsupported = new Set<StaticDeploymentUnsupportedCapability>();

  if (Object.keys(output.server.functions).length > 0) {
    unsupported.add("server-functions");
  }
  if (output.server.routes.length > 0) {
    unsupported.add("server-routes");
  }

  for (const page of Object.values(output.pages)) {
    if (page.ppr || page.rendering.html === "partial") {
      unsupported.add("ppr-pages");
      continue;
    }
    if (page.componentModel === "rsc" || page.rendering.component === "rsc") {
      unsupported.add("rsc-pages");
      continue;
    }
    if (page.render === "ssr") {
      unsupported.add("ssr-pages");
    }
  }

  if (Object.keys(output.rsc?.pages ?? {}).length > 0) {
    unsupported.add("rsc-pages");
  }

  const unsupportedCapabilities = [...unsupported].sort();
  return {
    complete: unsupportedCapabilities.length === 0,
    unsupportedCapabilities,
  };
}

function createStaticRedirects(
  output: BuildOutput,
  compatibility: StaticDeploymentCompatibility = analyzeStaticDeploymentCompatibility(
    output,
  ),
): string {
  const lines = new Set<string>();

  for (const route of output.routes) {
    const staticRoute = getStaticDocumentRoute(output, route);
    if (staticRoute) {
      lines.add(
        `${toStaticRoutePath(staticRoute.path)} /${encodeArtifactUrlPath(staticRoute.fileName)} 200`,
      );
    }
  }

  const fallback = getStaticFallbackHtml(output);
  if (fallback && compatibility.complete) {
    lines.add(`/* /${encodeArtifactUrlPath(fallback)} 200`);
  }

  return `${[...lines].join("\n")}\n`;
}

function getStaticDocumentRoutes(output: BuildOutput): StaticDocumentRoute[] {
  return output.routes.flatMap((route) => {
    const staticRoute = getStaticDocumentRoute(output, route);
    return staticRoute ? [staticRoute] : [];
  });
}

function getStaticDocumentRoute(
  output: BuildOutput,
  route: BuildOutput["routes"][number],
): StaticDocumentRoute | undefined {
  if (route.pageId) {
    const page = output.pages[route.pageId];
    if (
      page &&
      (page.render === "csr" || page.render === "ssg") &&
      page.document?.fileName
    ) {
      return { path: route.path, fileName: page.document.fileName };
    }
    return undefined;
  }

  if (route.appId) {
    const app = output.apps[route.appId];
    if (app?.document?.fileName) {
      return { path: route.path, fileName: app.document.fileName };
    }
    return undefined;
  }

  return undefined;
}

function getStaticFallbackHtml(output: BuildOutput): string | undefined {
  if (output.apps.default?.document?.fileName) {
    return output.apps.default.document.fileName;
  }
  const firstAppId = Object.keys(output.apps)[0];
  if (firstAppId) return output.apps[firstAppId]?.document?.fileName;
  return undefined;
}

function getFrameworkExactEndpointPaths(output: BuildOutput): string[] {
  const runtime = output.runtime.server;
  if (!runtime) return [];

  return [runtime.fn, runtime.rsc].filter(
    (routePath): routePath is string =>
      typeof routePath === "string" && routePath.length > 0,
  );
}

function getFrameworkSubtreeEndpointPaths(output: BuildOutput): string[] {
  const runtime = output.runtime.server;
  if (!runtime) return [];

  return [runtime.ppr].filter(
    (routePath): routePath is string =>
      typeof routePath === "string" && routePath.length > 0,
  );
}

function getFrameworkServerRoutes(output: BuildOutput): string[] {
  const routes = new Set<string>();

  for (const route of output.server.routes) {
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

function getStaticAssetPrefix(
  publicPath: BuildOutput["publicPath"],
): string | undefined {
  if (!publicPath.startsWith("/") || publicPath.startsWith("//")) {
    return undefined;
  }

  const pathname = publicPath.split(/[?#]/)[0] ?? "";
  const normalized = pathname.replace(/\/+$/, "");
  if (!normalized || normalized === "/") return undefined;
  return normalized;
}

function encodeArtifactUrlPath(fileName: string): string {
  return fileName.split("/").map(encodeURIComponent).join("/");
}

function toNodeRoutePath(routePath: string): string {
  return routePath
    .split("/")
    .map((segment) => {
      if (segment === "$") return "*";
      if (segment.startsWith("$")) return `:${segment.slice(1)}`;
      return segment;
    })
    .join("/");
}

function toAbsoluteNodeRoutePath(routePath: string): string {
  return toNodeRoutePath(
    routePath.startsWith("/") ? routePath : `/${routePath}`,
  );
}

function toStaticRoutePath(routePath: string): string {
  return routePath
    .split("/")
    .map((segment) => {
      if (segment === "$") return "*";
      if (segment.startsWith("$")) return `:${segment.slice(1)}`;
      return segment;
    })
    .join("/");
}
