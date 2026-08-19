/**
 * Link semantic graph ownership and concrete build units with adapter-emitted
 * assets, then derive the in-memory output projections consumed by runtimes,
 * plugins, and deployment helpers.
 */

import { pageRoutePathShapeFromPath } from "../../routing/page-route.js";
import {
  cloneStaticJsonValue,
  readOptionalStaticJsonObjectProperty,
} from "../../serialization/static-json.js";
import type {
  AssetGroup,
  BuildEntry,
  BuildOutput,
  BuildPlan,
  DeploymentDocumentOutput,
  DeploymentMetadata,
  DeploymentRouteOutput,
  DeploymentServerPageRenderOutput,
  HtmlDocumentOutput,
  HydrationMode,
  PageOutput,
  PageRenderingOutput,
  ServerFunctionOutput,
  ServerRouteOutput,
} from "../contracts.js";
import type { CoreGraph, CorePageNode } from "../graph/core.js";
import { clonePageMetadata } from "../page/metadata.js";
import {
  assertPortableRelativeBrowserArtifactPath,
  portableArtifactPathsConflict,
} from "./artifact-path.js";
import {
  assertBuildOutputServerArtifacts,
  assertServerArtifactGroups,
  type ServerArtifactGroupReference,
} from "./server-artifacts.js";

const EMPTY_ASSETS: AssetGroup = { js: [], css: [] };
declare const URL: {
  new (
    value: string,
    base?: string | { toString(): string },
  ): { protocol: string };
};

export interface BuildOutputLinkInput {
  graph: CoreGraph;
  plan: BuildPlan;
  clientEntryAssets?: Record<string, AssetGroup>;
  /** Assets keyed by the exact server BuildPlan entry name. */
  serverEntryAssets?: Record<string, AssetGroup>;
}

const REMOVED_SERVER_LINK_INPUT_FIELDS = [
  "serverEntry",
  "serverAssets",
  "serverModules",
] as const;

/**
 * Join CoreGraph, BuildPlan, and bundler facts into one validated BuildOutput.
 * Bundler facts must identify planned entries by name, and every executable
 * server entry must resolve to one self-contained JavaScript asset. Semantic
 * ownership and routing are projected from graph and plan rather than inferred
 * from emitted filenames or module stats.
 */
export function linkBuildOutput(input: BuildOutputLinkInput): BuildOutput {
  assertBuildOutputLinkInputContract(input);
  assertBuildOutputLinkInputServerArtifacts(input);
  const serverEntryAssets = input.serverEntryAssets ?? {};
  const resolvedClientEntryAssets = resolveClientEntryAssets(
    input.plan,
    input.clientEntryAssets,
  );

  const clientAssetsForEntry = (entry: BuildEntry) =>
    cloneAssetGroup(resolvedClientEntryAssets.get(entry.name) ?? EMPTY_ASSETS);
  const serverAssetsForEntry = (entry: BuildEntry) => {
    const assets = getOwn(serverEntryAssets, entry.name);
    if (!assets) {
      throw new Error(
        `[evjs] Bundler build facts are missing server BuildPlan entry "${entry.name}" (${entry.kind}).`,
      );
    }
    return cloneAssetGroup(assets);
  };
  const serverRuntimeEntry = input.plan.entries.find(
    (entry) =>
      entry.environment === "server" && entry.kind === "server-runtime",
  );
  const htmlDocuments = createHtmlDocumentLookup(input.plan.html);
  const serverRuntimeAssets = serverRuntimeEntry
    ? serverAssetsForEntry(serverRuntimeEntry)
    : cloneAssetGroup(EMPTY_ASSETS);
  const serverEntry = serverRuntimeEntry
    ? serverRuntimeAssets.js[0]
    : undefined;
  const serverAssets = serverRuntimeEntry
    ? serverRuntimeAssets
    : cloneAssetGroup(EMPTY_ASSETS);

  const findEntryByOwner = (
    owner: BuildEntry["owner"],
    environment?: BuildEntry["environment"],
    kind?: BuildEntry["kind"],
  ): BuildEntry | undefined =>
    input.plan.entries.find((entry) => {
      if (environment && entry.environment !== environment) return false;
      if (kind && entry.kind !== kind) return false;
      if (owner?.appId) return entry.owner?.appId === owner.appId;
      if (owner?.pageId && entry.owner?.pageId !== owner.pageId) return false;
      if (owner?.regionId && entry.owner?.regionId !== owner.regionId) {
        return false;
      }
      if (owner?.pageId || owner?.regionId) return true;
      return false;
    });

  const rscClientRuntimeEntry = input.plan.entries.find(
    (entry) =>
      entry.environment === "client" &&
      entry.kind === "runtime" &&
      entry.name === "evjs-rsc-client",
  );
  const serverCssForPage = (pageId: string, kind?: BuildEntry["kind"]) => {
    const entry = findEntryByOwner({ pageId }, "server", kind);
    return entry ? serverAssetsForEntry(entry).css : [];
  };

  function cloneServerCapabilityAssets(): AssetGroup {
    return cloneAssetGroup(serverAssets);
  }

  const entryAssets: Record<string, AssetGroup> = {};
  for (const entry of input.plan.entries) {
    defineRecordValue(
      entryAssets,
      entry.name,
      entry.environment === "client"
        ? clientAssetsForEntry(entry)
        : serverAssetsForEntry(entry),
    );
  }

  const apps = Object.fromEntries(
    Object.entries(input.graph.applications)
      .filter(([, app]) => shouldProjectApplicationToOutput(input.graph, app))
      .map(([id, app]) => {
        const entry = findEntryByOwner({ appId: id }, "client");
        const assets = entry
          ? clientAssetsForEntry(entry)
          : cloneAssetGroup(EMPTY_ASSETS);
        const href = entry
          ? assertClientRuntimeHref(entry, assets, `App "${id}"`)
          : undefined;
        const document = app.documentIds
          .map((documentId) => input.graph.documents[documentId])
          .find((candidate) => candidate?.owner.kind === "application");
        return [
          id,
          {
            assets,
            document: cloneHtmlDocument(htmlDocuments.apps.get(id)),
            mount: document?.mount,
            module: entry
              ? {
                  type: "entry" as const,
                  href,
                }
              : undefined,
          },
        ] as const;
      }),
  );

  const pages = Object.fromEntries(
    Object.entries(input.graph.pages)
      .filter(([, page]) => shouldProjectPageToOutput(input.graph, page))
      .map(([id, page]) => {
        const pageEntry = findEntryByOwner({ pageId: id }, "client");
        const application = input.graph.applications[page.applicationId];
        const applicationEntry =
          application?.routingMode === "spa" &&
          effectivePageHydrate(page) !== "none"
            ? findEntryByOwner(
                { appId: page.applicationId },
                "client",
                "app-client",
              )
            : undefined;
        const entry = pageEntry ?? applicationEntry;
        const shellEntry = findEntryByOwner(
          { pageId: id },
          "server",
          "ppr-shell",
        );
        const baseAssets = entry
          ? clientAssetsForEntry(entry)
          : isRscPage(page) && rscClientRuntimeEntry
            ? clientAssetsForEntry(rscClientRuntimeEntry)
            : EMPTY_ASSETS;
        const href = pageEntry
          ? assertClientRuntimeHref(pageEntry, baseAssets, `Page "${id}"`)
          : undefined;
        const serverCss = isRscPage(page)
          ? [
              ...serverCssForPage(id, "page-server"),
              ...serverCssForPage(id, "rsc-page"),
            ]
          : isPartialPrerenderPage(page)
            ? serverCssForPage(id, "ppr-shell")
            : page.render === "ssr" || page.render === "ssg"
              ? serverCssForPage(id, "page-server")
              : [];
        const assets = mergeAssetGroups(baseAssets, {
          js: [],
          css: serverCss,
        });
        const route = input.graph.routes.find(
          (candidate) =>
            candidate.target.kind === "page" && candidate.target.pageId === id,
        );
        const document =
          Object.values(input.graph.documents).find(
            (candidate) =>
              candidate.owner.kind === "page" && candidate.owner.pageId === id,
          ) ??
          Object.values(input.graph.documents).find(
            (candidate) =>
              candidate.applicationId === page.applicationId &&
              candidate.owner.kind === "application",
          );
        return [
          id,
          {
            assets,
            document: cloneHtmlDocument(htmlDocuments.pages.get(id)),
            render: page.render,
            rendering: derivePageRendering(page),
            path: route ? formatCoreRoutePattern(route.pattern) : undefined,
            routeId: route?.id,
            componentModel: page.componentModel,
            hydrate: effectivePageHydrate(page),
            metadata: clonePageMetadata(page.metadata),
            mount: document?.mount,
            prerender: page.prerender,
            module: pageEntry
              ? {
                  type: "react-component" as const,
                  href,
                }
              : undefined,
            ppr: isPartialPrerenderPage(page)
              ? {
                  delivery: page.ppr?.delivery ?? "merge",
                  shell: serverAssetsForEntry(
                    assertPprShellEntry(id, shellEntry),
                  ),
                  regions: Object.fromEntries(
                    Object.entries(page.ppr?.regions ?? {}).map(
                      ([regionId, region]) => {
                        const regionEntry = assertPprRegionEntry(
                          id,
                          regionId,
                          findEntryByOwner(
                            { pageId: id, regionId },
                            "server",
                            "ppr-region",
                          ),
                        );
                        return [
                          regionId,
                          {
                            id: regionId,
                            assets: serverAssetsForEntry(regionEntry),
                            cache: region.cache,
                          },
                        ];
                      },
                    ),
                  ),
                }
              : undefined,
          },
        ];
      }),
  );

  const serverFunctions = Object.create(null) as Record<
    string,
    ServerFunctionOutput
  >;
  for (const fn of input.graph.serverFunctions) {
    defineRecordValue(serverFunctions, fn.id, {
      assets: cloneServerCapabilityAssets(),
      exportName: fn.exportName,
    });
  }

  const serverRoutes: ServerRouteOutput[] = input.graph.serverRoutes.map(
    (route) => ({
      path: route.path,
      methods: route.methods,
      assets: cloneServerCapabilityAssets(),
    }),
  );
  const rsc = linkRscOutput(input, serverAssetsForEntry);

  const output: BuildOutput = {
    version: 1,
    buildId: input.plan.buildId,
    paths: createBuildOutputPaths(input.plan),
    publicPath: input.plan.runtime.publicPath,
    runtime: {
      server: input.plan.runtime.server,
      transport: input.plan.runtime.transport,
    },
    assets: entryAssets,
    apps,
    pages,
    routes: createBuildOutputRoutes(input.graph, apps, pages),
    server: {
      entry: serverEntry,
      assets: serverAssets,
      renderers: linkServerRenderers(input.plan, serverAssetsForEntry),
      functions: serverFunctions,
      routes: serverRoutes,
    },
    ...(rsc ? { rsc } : {}),
  };
  assertBuildOutputServerArtifacts(output, "linked BuildOutput");
  return output;
}

/** Require every client BuildPlan entry to have exact named JavaScript facts. */
export function assertBuildOutputLinkInputClientAssets(
  input: Pick<BuildOutputLinkInput, "plan" | "clientEntryAssets">,
): void {
  resolveClientEntryAssets(input.plan, input.clientEntryAssets);
}

function resolveClientEntryAssets(
  plan: BuildPlan,
  clientEntryAssets: Record<string, AssetGroup> | undefined,
): Map<string, AssetGroup> {
  const plannedEntries = plan.entries.filter(
    (entry) => entry.environment === "client",
  );
  const facts = clientEntryAssets ?? {};
  const resolved = new Map<string, AssetGroup>();
  const claimedFiles: Array<{ entryName: string; fileName: string }> = [];

  for (const entry of plannedEntries) {
    const assets = getOwn(facts, entry.name);
    if (!assets) {
      const available = Object.keys(facts)
        .map((name) => `"${name}"`)
        .join(", ");
      throw new Error(
        available
          ? `[evjs] Bundler build facts do not identify client BuildPlan entry "${entry.name}". Available stats entrypoints: ${available}.`
          : `[evjs] Bundler build facts are missing client BuildPlan entry "${entry.name}".`,
      );
    }
    assertClientEntryAssetGroup(entry, assets);
    for (const fileName of [...assets.js, ...assets.css]) {
      const conflict = claimedFiles.find(
        (claim) =>
          claim.fileName !== fileName &&
          portableArtifactPathsConflict(claim.fileName, fileName),
      );
      if (conflict) {
        throw new Error(
          `[evjs] Bundler build facts for client BuildPlan entry "${entry.name}" asset ${JSON.stringify(fileName)} conflicts with entry "${conflict.entryName}" asset ${JSON.stringify(conflict.fileName)} on portable file systems. Use one case- and Unicode-stable spelling, and do not overlap file and directory paths.`,
        );
      }
      if (!claimedFiles.some((claim) => claim.fileName === fileName)) {
        claimedFiles.push({ entryName: entry.name, fileName });
      }
    }
    resolved.set(entry.name, assets);
  }
  return resolved;
}

function assertClientEntryAssetGroup(
  entry: BuildEntry,
  assets: AssetGroup,
): void {
  if (
    !assets ||
    typeof assets !== "object" ||
    !Array.isArray(assets.js) ||
    !Array.isArray(assets.css)
  ) {
    throw new Error(
      `[evjs] Bundler build facts for client BuildPlan entry "${entry.name}" must provide an AssetGroup with JavaScript and CSS arrays.`,
    );
  }
  if (assets.js.length === 0) {
    throw new Error(
      `[evjs] Bundler build facts for client BuildPlan entry "${entry.name}" must declare at least one JavaScript asset.`,
    );
  }
  for (const [kind, files] of [
    ["JavaScript", assets.js],
    ["CSS", assets.css],
  ] as const) {
    for (const [index, fileName] of files.entries()) {
      assertPortableRelativeBrowserArtifactPath(
        fileName,
        `Bundler build facts for client BuildPlan entry "${entry.name}" ${kind} asset[${index}]`,
      );
    }
  }
  selectClientEntryJavaScriptAsset(entry, assets);
}

function assertExecutableServerEntryAssets(
  entry: BuildEntry,
  assets: AssetGroup,
): void {
  if (
    !assets ||
    typeof assets !== "object" ||
    !Array.isArray(assets.js) ||
    !Array.isArray(assets.css)
  ) {
    throw new Error(
      `[evjs] Bundler build facts for server BuildPlan entry "${entry.name}" must provide an AssetGroup with JavaScript and CSS arrays.`,
    );
  }
  if (assets.js.length !== 1) {
    throw new Error(
      `[evjs] Bundler build facts for server BuildPlan entry "${entry.name}" (${entry.kind}) must declare exactly one self-contained JavaScript entry asset; found ${assets.js.length}.`,
    );
  }
  for (const [index, fileName] of assets.css.entries()) {
    assertPortableRelativeBrowserArtifactPath(
      fileName,
      `Bundler build facts for server BuildPlan entry "${entry.name}" CSS asset[${index}]`,
    );
  }
}

/**
 * Keep independently materialized or externally observable Pages in
 * BuildOutput. A pure CSR SPA Page without its own Document or metadata remains
 * represented by the owning Application and Route projection.
 */
function shouldProjectPageToOutput(
  graph: CoreGraph,
  page: CorePageNode,
): boolean {
  return (
    Object.values(graph.documents).some(
      (document) =>
        document.owner.kind === "page" && document.owner.pageId === page.id,
    ) ||
    page.render !== "csr" ||
    page.metadata !== undefined
  );
}

function shouldProjectApplicationToOutput(
  graph: CoreGraph,
  application: CoreGraph["applications"][string],
): boolean {
  return application.documentIds.some(
    (documentId) => graph.documents[documentId]?.owner.kind === "application",
  );
}

/**
 * Create the intentionally compact runtime route lookup. It retains normalized
 * paths and materialized Application/Page associations, while semantic targets,
 * facets, and group-only Routes remain available only in CoreGraph.
 */
function createBuildOutputRoutes(
  graph: CoreGraph,
  apps: BuildOutput["apps"],
  pages: Record<string, PageOutput>,
): BuildOutput["routes"] {
  const emittedShapes = new Set<string>();
  const routes: BuildOutput["routes"] = [];

  for (const route of graph.routes) {
    if (route.target.kind === "group") continue;

    const pathname = formatCoreRoutePattern(route.pattern);
    const shape = pageRoutePathShapeFromPath(pathname);
    if (emittedShapes.has(shape)) continue;
    emittedShapes.add(shape);
    routes.push(
      pruneUndefined({
        id: route.id,
        path: pathname,
        appId: Object.hasOwn(apps, route.applicationId)
          ? route.applicationId
          : undefined,
        pageId:
          route.target.kind === "page" &&
          Object.hasOwn(pages, route.target.pageId)
            ? route.target.pageId
            : undefined,
      }),
    );
  }

  return routes;
}

function formatCoreRoutePattern(
  pattern: CoreGraph["routes"][number]["pattern"],
): string {
  if (pattern.segments.length === 0) return "/";
  return `/${pattern.segments
    .map((segment) => {
      if (segment.kind === "static") return segment.value;
      if (segment.kind === "param") return `$${segment.name}`;
      return "$";
    })
    .join("/")}`;
}

function assertPprShellEntry(
  pageId: string,
  entry: BuildEntry | undefined,
): BuildEntry {
  if (entry) return entry;
  throw new Error(
    `[evjs] PPR page "${pageId}" did not declare a matching ppr-shell server renderer.`,
  );
}

function assertPprRegionEntry(
  pageId: string,
  regionId: string,
  entry: BuildEntry | undefined,
): BuildEntry {
  if (entry) return entry;
  throw new Error(
    `[evjs] PPR page "${pageId}" region "${regionId}" did not declare a matching ppr-region server renderer.`,
  );
}

function assertClientRuntimeHref(
  entry: BuildEntry,
  assets: AssetGroup,
  label: string,
): string {
  try {
    return selectClientEntryJavaScriptAsset(entry, assets);
  } catch (error) {
    throw new Error(
      `[evjs] ${label} did not produce one identifiable client JavaScript entry asset for build entry "${entry.name}".`,
      { cause: error },
    );
  }
}

function selectClientEntryJavaScriptAsset(
  entry: BuildEntry,
  assets: AssetGroup,
): string {
  if (assets.js.length === 1) return assets.js[0] as string;
  const candidates = assets.js.filter((asset) =>
    isNamedEntryAsset(entry.name, asset),
  );
  if (candidates.length === 1) return candidates[0] as string;
  throw new Error(
    `[evjs] Bundler build facts for client BuildPlan entry "${entry.name}" do not identify one JavaScript entry asset; found ${assets.js.length}.`,
  );
}

function isNamedEntryAsset(entryName: string, asset: string): boolean {
  const fileName = asset.split("/").pop() ?? asset;
  return fileName === `${entryName}.js` || fileName.startsWith(`${entryName}.`);
}

function assertBuildOutputLinkInputServerArtifacts(
  input: BuildOutputLinkInput,
): void {
  const plannedServerEntries = new Map(
    input.plan.entries
      .filter((entry) => entry.environment === "server")
      .map((entry) => [entry.name, entry] as const),
  );
  const runtimeGroups: ServerArtifactGroupReference[] = [];
  const buildGroups: ServerArtifactGroupReference[] = [];
  const serverEntryAssets = input.serverEntryAssets ?? {};
  for (const entryName of Object.keys(serverEntryAssets)) {
    if (!plannedServerEntries.has(entryName)) {
      throw new Error(
        `[evjs] BuildOutput link input.serverEntryAssets.${entryName} does not match an exact server BuildPlan entry name.`,
      );
    }
  }
  for (const entry of plannedServerEntries.values()) {
    const assets = getOwn(serverEntryAssets, entry.name);
    if (!assets) {
      throw new Error(
        `[evjs] Bundler build facts are missing server BuildPlan entry "${entry.name}" (${entry.kind}).`,
      );
    }
    assertExecutableServerEntryAssets(entry, assets);
    const groups = entry.phase === "build" ? buildGroups : runtimeGroups;
    groups.push({
      assets,
      source: `BuildOutput link input.serverEntryAssets.${entry.name}`,
    });
  }
  assertServerArtifactGroups(runtimeGroups);
  assertServerArtifactGroups(buildGroups);
}

function assertBuildOutputLinkInputContract(input: BuildOutputLinkInput): void {
  for (const field of REMOVED_SERVER_LINK_INPUT_FIELDS) {
    if (!Object.hasOwn(input, field)) continue;
    throw new Error(
      `[evjs] BuildOutput link input.${field} is no longer supported. Return every server entry through serverEntryAssets keyed by its exact BuildPlan name.`,
    );
  }
}

export interface DeploymentMetadataOptions {
  includeAssets?: boolean;
}

/**
 * Create the canonical deployment projection from linked output. Public asset
 * filtering, Document ownership, request routes, server capability endpoints,
 * and the server entry are all derived once at this boundary.
 */
export function createDeploymentMetadata(
  output: BuildOutput,
  options: DeploymentMetadataOptions = {},
): DeploymentMetadata {
  assertBuildOutputServerArtifacts(output, "BuildOutput");
  const includeAssets = options.includeAssets ?? true;
  const publicAssetFiles = collectPublicAssetFiles(output);
  const assets = includeAssets
    ? clonePublicAssetRecord(output.assets, publicAssetFiles)
    : undefined;
  const metadata = readOptionalStaticJsonObjectProperty(
    output,
    "deployment",
    "BuildOutput.deployment",
  );
  return pruneUndefined({
    version: 1 as const,
    buildId: output.buildId,
    paths: { ...output.paths },
    publicPath: output.publicPath,
    assets: assets && hasAssetRecordEntries(assets) ? assets : undefined,
    documents: createDeploymentDocuments(output, includeAssets),
    routes: createDeploymentRoutes(output),
    server: pruneUndefined({
      entry: output.server.entry,
    }),
    metadata: metadata ? cloneStaticJsonValue(metadata) : undefined,
  }) as DeploymentMetadata;
}

function createBuildOutputPaths(
  plan: BuildPlan,
): NonNullable<BuildOutput["paths"]> {
  return {
    rootDir: plan.distDir,
    publicDir: plan.output.clientDir,
    serverDir: plan.output.serverDir,
  };
}

function createDeploymentDocuments(
  output: BuildOutput,
  includeAssets: boolean,
): DeploymentDocumentOutput[] {
  const documents: DeploymentDocumentOutput[] = [];
  for (const [id, app] of Object.entries(output.apps)) {
    if (!app.document) continue;
    const fallbackRoute = findOutputRouteForApp(output, id);
    documents.push(
      pruneUndefined({
        kind: "app" as const,
        id,
        fileName: app.document.fileName,
        ...(app.document.aliases ? { aliases: [...app.document.aliases] } : {}),
        fallback: fallbackRoute?.path,
        assets: includeAssets ? optionalAssetGroup(app.assets) : undefined,
      }),
    );
  }
  for (const [id, page] of Object.entries(output.pages)) {
    if (!page.document) continue;
    documents.push(
      pruneUndefined({
        kind: "page" as const,
        id,
        fileName: page.document.fileName,
        ...(page.document.aliases
          ? { aliases: [...page.document.aliases] }
          : {}),
        assets: includeAssets ? optionalAssetGroup(page.assets) : undefined,
      }),
    );
  }
  return documents;
}

/**
 * Project linked routes into deployment behavior. Static Page Documents become
 * rewrites, request-time Pages become server routes, framework endpoints are
 * emitted only when their capability exists, and API Routes come from the
 * linked server output. Deployment Document ids use their Page owner id.
 */
function createDeploymentRoutes(output: BuildOutput): DeploymentRouteOutput[] {
  const routes: DeploymentRouteOutput[] = [];
  for (const route of output.routes) {
    if (route.pageId) {
      const page = output.pages[route.pageId];
      if (!page) continue;
      if (page.document && (page.render === "csr" || page.render === "ssg")) {
        routes.push({
          kind: "static-page",
          path: route.path,
          pageId: route.pageId,
          documentId: route.pageId,
          render: page.render,
          methods: ["GET", "HEAD"],
        });
        continue;
      }
      if (page.render !== "csr") {
        const rendering = createDeploymentServerPageRendering(
          output,
          route.pageId,
          page,
        );
        routes.push({
          kind: "server-page",
          path: route.path,
          pageId: route.pageId,
          ...rendering,
          methods: ["GET", "HEAD"],
        });
      }
      continue;
    }

    if (route.appId) continue;
  }

  if (Object.keys(output.server.functions).length > 0) {
    routes.push({
      kind: "server-function",
      path: toRuntimePathname(output.runtime.server.fn),
      methods: ["POST"],
    });
  }
  if (Object.values(output.pages).some((page) => page.ppr)) {
    const pprPath = output.runtime.server.ppr;
    if (pprPath) {
      routes.push({
        kind: "ppr-endpoint",
        path: `${toRuntimePathname(pprPath)}/*`,
        methods: ["GET", "HEAD"],
      });
    }
  }
  if (output.rsc && output.runtime.server.rsc) {
    routes.push({
      kind: "rsc-endpoint",
      path: toRuntimePathname(output.runtime.server.rsc),
      methods: ["GET", "HEAD"],
    });
  }
  for (const route of output.server.routes) {
    routes.push({
      kind: "api-route",
      path: route.path,
      methods: [...route.methods],
    });
  }
  return routes;
}

function createDeploymentServerPageRendering(
  output: BuildOutput,
  pageId: string,
  page: PageOutput,
): {
  render: DeploymentServerPageRenderOutput;
  prerender?: "full" | "partial";
  rsc?: true;
} {
  if (page.ppr) return { render: "ssr", prerender: "partial" };
  if (output.rsc?.pages?.[pageId]) return { render: "ssr", rsc: true };
  if (page.render === "ssg" || page.rendering.prerender === "full") {
    return { render: "ssr", prerender: "full" };
  }
  if (page.render === "ssr") return { render: "ssr" };
  if (page.render === "csr") {
    throw new Error(
      `[evjs] CSR page "${pageId}" cannot be emitted as a server deployment route.`,
    );
  }
  throw new Error(
    `[evjs] Page "${pageId}" render mode "${page.render}" cannot be emitted as a server deployment route.`,
  );
}

function findOutputRouteForApp(
  output: BuildOutput,
  appId: string,
): BuildOutput["routes"][number] | undefined {
  return output.routes.find((route) => route.appId === appId);
}

function createHtmlDocumentLookup(html: BuildPlan["html"]): {
  apps: Map<string, HtmlDocumentOutput>;
  pages: Map<string, HtmlDocumentOutput>;
} {
  const apps = new Map<string, HtmlDocumentOutput>();
  const pages = new Map<string, HtmlDocumentOutput>();

  for (const document of html) {
    if (document.owner.appId) {
      apps.set(document.owner.appId, {
        fileName: document.fileName,
        ...(document.aliases ? { aliases: [...document.aliases] } : {}),
      });
    }
    if (document.owner.pageId) {
      pages.set(document.owner.pageId, {
        fileName: document.fileName,
        ...(document.aliases ? { aliases: [...document.aliases] } : {}),
      });
    }
  }

  return { apps, pages };
}

function cloneHtmlDocument(
  document: HtmlDocumentOutput | undefined,
): HtmlDocumentOutput | undefined {
  return document
    ? {
        fileName: document.fileName,
        ...(document.aliases ? { aliases: [...document.aliases] } : {}),
      }
    : undefined;
}

function clonePublicAssetRecord(
  assets: Record<string, AssetGroup>,
  publicAssetFiles: Set<string>,
): Record<string, AssetGroup> {
  return Object.fromEntries(
    Object.entries(assets)
      .map(([id, group]) => [id, clonePublicAssets(group, publicAssetFiles)])
      .filter(
        ([, group]) =>
          (group as AssetGroup).js.length > 0 ||
          (group as AssetGroup).css.length > 0,
      ),
  ) as Record<string, AssetGroup>;
}

function hasAssetRecordEntries(assets: Record<string, AssetGroup>): boolean {
  return Object.keys(assets).length > 0;
}

function optionalAssetGroup(assets: AssetGroup): AssetGroup | undefined {
  return assets.js.length > 0 || assets.css.length > 0
    ? cloneAssetGroup(assets)
    : undefined;
}

function collectPublicAssetFiles(output: BuildOutput): Set<string> {
  const files = new Set<string>();
  const collect = (assets: AssetGroup | undefined) => {
    for (const asset of assets?.js ?? []) files.add(asset);
    for (const asset of assets?.css ?? []) files.add(asset);
  };

  for (const app of Object.values(output.apps)) collect(app.assets);
  for (const page of Object.values(output.pages)) collect(page.assets);

  return files;
}

function clonePublicAssets(
  assets: AssetGroup,
  publicAssetFiles: Set<string>,
): AssetGroup {
  return {
    js: assets.js.filter((asset) => publicAssetFiles.has(asset)),
    css: assets.css.filter((asset) => publicAssetFiles.has(asset)),
  };
}

function mergeAssetGroups(...groups: AssetGroup[]): AssetGroup {
  return {
    js: [...new Set(groups.flatMap((group) => group.js))],
    css: [...new Set(groups.flatMap((group) => group.css))],
  };
}

function cloneAssetGroup(assets: AssetGroup): AssetGroup {
  return {
    js: [...assets.js],
    css: [...assets.css],
  };
}

function getOwn<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function defineRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function linkRscOutput(
  input: BuildOutputLinkInput,
  serverAssetsForEntry: (entry: BuildEntry) => AssetGroup,
): BuildOutput["rsc"] | undefined {
  const rscRenderers = input.plan.entries.filter(
    (entry) => entry.environment === "server" && entry.kind === "rsc-page",
  );
  const rscPages = Object.values(input.graph.pages).filter(isRscPage);

  if (rscPages.length === 0) {
    return undefined;
  }
  if (!input.plan.runtime.server.rsc) {
    throw new Error(
      `[evjs] RSC page "${rscPages[0].id}" requires runtime.server.rsc before RSC manifest emission.`,
    );
  }

  return {
    pages:
      rscPages.length > 0
        ? Object.fromEntries(
            rscPages.map((page) => {
              const renderer = findRscRendererForPage(page.id, rscRenderers);
              const route = input.graph.routes.find(
                (candidate) =>
                  candidate.target.kind === "page" &&
                  candidate.target.pageId === page.id,
              );
              return [
                page.id,
                {
                  renderer: renderer.name,
                  assets: serverAssetsForEntry(renderer),
                  routeId: route?.id,
                },
              ];
            }),
          )
        : undefined,
  };
}

function findRscRendererForPage(
  pageId: string,
  rscRenderers: BuildEntry[],
): BuildEntry {
  const renderer = rscRenderers.find((entry) => entry.owner?.pageId === pageId);
  if (renderer) return renderer;

  throw new Error(
    `[evjs] RSC page "${pageId}" did not declare a matching rsc-page server renderer.`,
  );
}

function linkServerRenderers(
  plan: BuildPlan,
  serverAssetsForEntry: (entry: BuildEntry) => AssetGroup,
) {
  const renderers = plan.server.renderers ?? [];
  if (renderers.length === 0) return undefined;

  return Object.fromEntries(
    renderers.map((renderer) => {
      const entry = plan.entries.find(
        (candidate) =>
          candidate.environment === "server" &&
          candidate.name === renderer.name,
      );
      if (!entry) {
        throw new Error(
          `[evjs] Server renderer "${renderer.name}" does not match a server BuildPlan entry.`,
        );
      }
      return [
        renderer.name,
        pruneUndefined({
          kind: renderer.kind,
          phase: renderer.phase,
          owner: renderer.owner,
          assets: serverAssetsForEntry(entry),
        }),
      ];
    }),
  );
}

/**
 * Normalize authoring fields into the rendering contract shared by runtime and
 * deployment consumers. PPR and RSC disable Page hydration; full SSG is static
 * HTML produced by a build-phase renderer.
 */
function derivePageRendering(page: CorePageNode): PageRenderingOutput {
  const hydrate = effectivePageHydrate(page);
  const component = isRscPage(page)
    ? "rsc"
    : page.render === "csr"
      ? "client"
      : "server";
  const partial = isPartialPrerenderPage(page);
  const full = isFullPrerenderPage(page);

  if (partial) {
    return {
      component,
      html: "partial",
      prerender: "partial",
      streaming: page.ppr?.delivery === "stream",
      hydrate,
    };
  }

  if (isRscPage(page)) {
    return {
      component: "rsc",
      html: "server",
      streaming: true,
      hydrate,
    };
  }

  switch (page.render) {
    case "csr":
      return {
        component,
        html: "client",
        streaming: false,
        hydrate,
      };
    case "ssg":
      return {
        component,
        html: "static",
        prerender: "full",
        streaming: false,
        hydrate,
      };
    default:
      return {
        component,
        html: "server",
        ...(full ? { prerender: "full" as const } : {}),
        streaming: false,
        hydrate,
      };
  }
}

function effectivePageHydrate(page: CorePageNode): HydrationMode {
  return isPartialPrerenderPage(page) || isRscPage(page)
    ? "none"
    : (page.hydrate ?? defaultHydrate(page.render));
}

function defaultHydrate(render: CorePageNode["render"]): HydrationMode {
  return render === "ssg" ? "none" : "load";
}

function isRscPage(page: Pick<CorePageNode, "componentModel">): boolean {
  return page.componentModel === "rsc";
}

function isPartialPrerenderPage(
  page: Pick<CorePageNode, "prerender" | "ppr">,
): boolean {
  return (
    (typeof page.prerender === "object" && page.prerender.partial === true) ||
    Boolean(page.ppr)
  );
}

function isFullPrerenderPage(
  page: Pick<CorePageNode, "render" | "prerender" | "ppr">,
): boolean {
  if (page.render === "ssg") return true;
  if (!page.prerender || isPartialPrerenderPage(page)) return false;
  return true;
}

function toRuntimePathname(endpoint: string): string {
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}
