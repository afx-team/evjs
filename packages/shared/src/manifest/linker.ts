import type {
  AppGraph,
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
  PageNode,
  PageOutput,
  PageRenderingOutput,
  PublicDocumentOutput,
  PublicManifestOutput,
  PublicPageOutput,
  PublicRoutingOutput,
  ServerFunctionOutput,
  ServerRouteOutput,
} from "./index.js";

const EMPTY_ASSETS: AssetGroup = { js: [], css: [] };
declare const URL: {
  new (
    value: string,
    base?: string | { toString(): string },
  ): { protocol: string };
};

export interface BuildOutputServerModule {
  moduleId: string;
  assets: AssetGroup;
}

export interface BuildOutputLinkInput {
  graph: AppGraph;
  plan: BuildPlan;
  clientEntryAssets?: Record<string, AssetGroup>;
  firstClientEntryAssets?: AssetGroup;
  serverEntryAssets?: Record<string, AssetGroup>;
  serverEntry?: string;
  serverAssets?: AssetGroup;
  serverModules?: BuildOutputServerModule[];
}

export interface ServerManifestOutput {
  version: 1;
  entry?: string;
  routes: ServerManifestRouteOutput[];
}

export type ServerManifestRouteOutput =
  | Extract<DeploymentRouteOutput, { kind: "server-page" }>
  | Extract<DeploymentRouteOutput, { kind: "server-function" }>
  | Extract<DeploymentRouteOutput, { kind: "ppr-endpoint" }>
  | Extract<DeploymentRouteOutput, { kind: "rsc-endpoint" }>
  | Extract<DeploymentRouteOutput, { kind: "api-route" }>;

export function linkBuildOutput(input: BuildOutputLinkInput): BuildOutput {
  const clientEntryAssets = input.clientEntryAssets ?? {};
  const firstClientEntryAssets = input.firstClientEntryAssets ?? EMPTY_ASSETS;
  const serverEntryAssets = input.serverEntryAssets ?? {};
  const fallbackServerAssets = input.serverAssets ?? EMPTY_ASSETS;
  const serverModules = input.serverModules ?? [];
  const clientEntries = input.plan.entries.filter(
    (entry) => entry.environment === "client",
  );
  const shouldUseSingleClientFallback = clientEntries.length === 1;

  const clientAssetsForEntry = (entry: BuildEntry) =>
    clientEntryAssets[entry.name] ??
    (shouldUseSingleClientFallback ? firstClientEntryAssets : EMPTY_ASSETS);
  const serverAssetsForEntry = (entry: BuildEntry) =>
    serverEntryAssets[entry.name] ?? fallbackServerAssets;
  const serverRuntimeEntry = input.plan.entries.find(
    (entry) =>
      entry.environment === "server" && entry.kind === "server-runtime",
  );
  const htmlDocuments = createHtmlDocumentLookup(input.plan.html);
  const serverRuntimeAssets = serverRuntimeEntry
    ? serverAssetsForEntry(serverRuntimeEntry)
    : fallbackServerAssets;
  const serverEntry = serverRuntimeEntry
    ? assertServerRuntimeEntry(
        input.serverEntry ?? serverRuntimeAssets.js[0],
        serverRuntimeAssets,
        serverRuntimeEntry,
      )
    : undefined;
  const serverAssets = serverRuntimeEntry ? serverRuntimeAssets : EMPTY_ASSETS;

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

  const assetsForSource = (sourceRel: string) =>
    serverModules.find((mod) => moduleIdMatchesSource(mod.moduleId, sourceRel))
      ?.assets ?? serverAssets;

  const entryAssets: Record<string, AssetGroup> = {};
  for (const entry of input.plan.entries) {
    entryAssets[entry.name] =
      entry.environment === "client"
        ? clientAssetsForEntry(entry)
        : serverAssetsForEntry(entry);
  }

  const apps = Object.fromEntries(
    Object.entries(input.graph.apps).map(([id, app]) => {
      const entry = findEntryByOwner({ appId: id }, "client");
      const assets = entry ? clientAssetsForEntry(entry) : EMPTY_ASSETS;
      const href = entry
        ? assertClientRuntimeHref(entry, assets, `App "${id}"`)
        : undefined;
      return [
        id,
        {
          assets,
          document: cloneHtmlDocument(htmlDocuments.apps.get(id)),
          mount: app.mount,
          module: entry
            ? {
                type: "entry" as const,
                href,
              }
            : undefined,
        },
      ];
    }),
  );

  const pages = Object.fromEntries(
    Object.entries(input.graph.pages).map(([id, page]) => {
      const entry = findEntryByOwner({ pageId: id }, "client");
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
      const href = entry
        ? assertClientRuntimeHref(entry, baseAssets, `Page "${id}"`)
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
      return [
        id,
        {
          assets,
          document: cloneHtmlDocument(htmlDocuments.pages.get(id)),
          render: page.render,
          rendering: derivePageRendering(page),
          path: page.path,
          routeId: page.routeId,
          componentModel: page.componentModel,
          hydrate: effectivePageHydrate(page),
          mount: page.mount,
          prerender: page.prerender,
          module: entry
            ? {
                type: page.component
                  ? ("react-component" as const)
                  : page.app
                    ? ("lifecycle" as const)
                    : ("entry" as const),
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

  const serverFunctions: Record<string, ServerFunctionOutput> = {};
  for (const fn of input.graph.serverFunctions) {
    serverFunctions[fn.id] = {
      assets: assetsForSource(fn.module),
      exportName: fn.exportName,
    };
  }

  const serverRoutes: ServerRouteOutput[] = input.graph.serverRoutes.map(
    (route) => ({
      path: route.path,
      methods: route.methods,
      assets: assetsForSource(route.module),
    }),
  );
  const rsc = linkRscOutput(input, serverAssetsForEntry);

  return {
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
    routes: input.graph.routes
      .filter((route) => route.kind !== "layout")
      .map((route) =>
        pruneUndefined({
          id: route.id,
          path: route.path,
          appId: route.appId,
          pageId: route.pageId,
        }),
      ),
    server: {
      entry: serverEntry,
      assets: serverAssets,
      renderers: linkServerRenderers(
        input.plan,
        serverAssetsForEntry,
        assetsForSource,
      ),
      functions: serverFunctions,
      routes: serverRoutes,
    },
    ...(rsc ? { rsc } : {}),
  };
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
  const href = getClientRuntimeHref(entry, assets);
  if (href) return href;
  throw new Error(
    `[evjs] ${label} did not produce a client JavaScript asset for build entry "${entry.name}".`,
  );
}

function getClientRuntimeHref(
  entry: BuildEntry,
  assets: AssetGroup,
): string | undefined {
  return (
    assets.js.find((asset) => isNamedEntryAsset(entry.name, asset)) ??
    assets.js[0]
  );
}

function isNamedEntryAsset(entryName: string, asset: string): boolean {
  const fileName = asset.split("/").pop() ?? asset;
  return fileName === `${entryName}.js` || fileName.startsWith(`${entryName}.`);
}

function assertServerRuntimeEntry(
  serverEntry: string | undefined,
  assets: AssetGroup,
  runtimeEntry: BuildEntry | undefined,
): string {
  if (!runtimeEntry) {
    throw new Error(
      "[evjs] Server build did not declare a server runtime entry.",
    );
  }
  if (serverEntry && assets.js.length > 0) return serverEntry;
  throw new Error(
    `[evjs] Server runtime entry "${runtimeEntry.name}" did not produce a server JavaScript asset.`,
  );
}

/**
 * Project the internal build output into a lightweight public manifest that is
 * safe for deployment tooling to read.
 *
 * The public manifest keeps browser-safe assets plus SPA/MPA routing metadata.
 * Runtime startup data stays in the generated ClientRuntime contract, and
 * framework endpoints stay in FrameworkRuntime/deployment metadata.
 */
export function createPublicManifest(
  output: BuildOutput,
): PublicManifestOutput {
  const publicAssetFiles = collectPublicAssetFiles(output);
  const documents = createPublicDocumentManifest(output, publicAssetFiles);
  if (documents) {
    return {
      version: output.version,
      buildId: output.buildId,
      publicPath: output.publicPath,
      documents,
    };
  }
  const routing = createPublicManifestRouting(output, publicAssetFiles);
  const assets =
    routing.kind === "spa"
      ? clonePublicAssetRecord(output.assets, publicAssetFiles)
      : undefined;
  return pruneUndefined({
    version: output.version,
    buildId: output.buildId,
    publicPath: output.publicPath,
    assets: assets && hasAssetRecordEntries(assets) ? assets : undefined,
    routing,
  }) as PublicManifestOutput;
}

function createPublicManifestRouting(
  output: BuildOutput,
  publicAssetFiles: Set<string>,
): PublicRoutingOutput {
  const hasSpaRoute = output.routes.some((route) => route.appId);
  if (!hasSpaRoute && Object.keys(output.pages).length > 0) {
    return {
      kind: "mpa",
      pages: Object.fromEntries(
        Object.entries(output.pages).map(([id, page]) => [
          id,
          sanitizePageOutput(
            page,
            publicAssetFiles,
            findOutputRouteForPage(output, id),
          ),
        ]),
      ),
    };
  }

  return {
    kind: "spa",
    routes: output.routes.map((route) =>
      pruneUndefined({
        id: route.id,
        path: route.path,
        pageId: route.pageId,
        render: route.pageId ? output.pages[route.pageId]?.render : undefined,
      }),
    ),
  };
}

function createPublicDocumentManifest(
  output: BuildOutput,
  publicAssetFiles: Set<string>,
): PublicDocumentOutput[] | undefined {
  if (!isStaticDocumentOnlyOutput(output)) return undefined;
  const documents = createStaticSsgDocumentRecords(output).map((document) =>
    pruneUndefined({
      id: document.id,
      path: document.path,
      fileName: document.fileName,
      render: document.render,
      assets: optionalAssetGroup(
        clonePublicAssets(document.assets, publicAssetFiles),
      ),
    }),
  );
  return documents.length > 0 ? documents : undefined;
}

function isStaticDocumentOnlyOutput(output: BuildOutput): boolean {
  const documentIds = new Set(
    createStaticSsgDocumentRecords(output).map((document) => document.id),
  );
  if (documentIds.size === 0) return false;
  if (
    Object.keys(output.pages).some((pageId) => !documentIds.has(pageId)) ||
    output.routes.some(
      (route) => !route.pageId || !documentIds.has(route.pageId),
    )
  ) {
    return false;
  }
  if (output.server.entry) return false;
  if (Object.keys(output.server.functions).length > 0) return false;
  if (output.server.routes.length > 0) return false;
  if (output.rsc && Object.keys(output.rsc.pages ?? {}).length > 0) {
    return false;
  }
  if (
    Object.values(output.apps).some(
      (app) =>
        app.document ||
        app.assets.js.length > 0 ||
        app.assets.css.length > 0 ||
        app.module,
    )
  ) {
    return false;
  }

  return true;
}

function createStaticSsgDocumentRecords(output: BuildOutput): Array<{
  id: string;
  path: string;
  fileName: string;
  render: Extract<PageOutput["render"], "ssg">;
  assets: AssetGroup;
}> {
  return Object.entries(output.pages).flatMap(([id, page]) => {
    if (
      !page.document ||
      page.render !== "ssg" ||
      page.rendering.html !== "static" ||
      page.rendering.prerender !== "full" ||
      page.ppr
    ) {
      return [];
    }
    const route = findOutputRouteForPage(output, id);
    const path = route?.path ?? page.path;
    if (!path?.startsWith("/")) return [];
    return [
      {
        id,
        path,
        fileName: page.document.fileName,
        render: page.render,
        assets: page.assets,
      },
    ];
  });
}

export function createServerManifest(
  output: BuildOutput,
): ServerManifestOutput {
  return {
    version: 1,
    ...(output.server.entry ? { entry: output.server.entry } : {}),
    routes: createDeploymentRoutes(output).filter(isServerManifestRoute),
  };
}

function isServerManifestRoute(
  route: DeploymentRouteOutput,
): route is ServerManifestRouteOutput {
  return (
    route.kind === "server-page" ||
    route.kind === "server-function" ||
    route.kind === "ppr-endpoint" ||
    route.kind === "rsc-endpoint" ||
    route.kind === "api-route"
  );
}

export interface DeploymentMetadataOptions {
  includeAssets?: boolean;
}

export function createDeploymentMetadata(
  output: BuildOutput,
  options: DeploymentMetadataOptions = {},
): DeploymentMetadata {
  const includeAssets = options.includeAssets ?? true;
  const publicAssetFiles = collectPublicAssetFiles(output);
  const assets = includeAssets
    ? clonePublicAssetRecord(output.assets, publicAssetFiles)
    : undefined;
  return pruneUndefined({
    version: 1 as const,
    buildId: output.buildId,
    paths: output.paths,
    publicPath: output.publicPath,
    assets: assets && hasAssetRecordEntries(assets) ? assets : undefined,
    documents: createDeploymentDocuments(output, includeAssets),
    routes: createDeploymentRoutes(output),
    server: pruneUndefined({
      entry: output.server.entry,
    }),
    metadata: output.deployment,
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

function sanitizePageOutput(
  page: PageOutput,
  publicAssetFiles: Set<string>,
  route?: BuildOutput["routes"][number],
): PublicPageOutput {
  return pruneUndefined({
    assets: clonePublicAssets(page.assets, publicAssetFiles),
    document: cloneHtmlDocument(page.document),
    path: page.path ?? route?.path,
    routeId: page.routeId ?? route?.id,
    render: page.render,
  }) as PublicPageOutput;
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
        fallback: fallbackRoute?.path,
        assets: includeAssets ? optionalAssetGroup(app.assets) : undefined,
      }),
    );
  }
  for (const [id, page] of Object.entries(output.pages)) {
    if (!page.document) continue;
    const route = findOutputRouteForPage(output, id);
    const staticDocument = createStaticDocumentMetadata(page, route);
    documents.push(
      pruneUndefined({
        kind: "page" as const,
        id,
        fileName: page.document.fileName,
        ...staticDocument,
        assets: includeAssets ? optionalAssetGroup(page.assets) : undefined,
      }),
    );
  }
  return documents;
}

function createDeploymentRoutes(output: BuildOutput): DeploymentRouteOutput[] {
  const routes: DeploymentRouteOutput[] = [];
  for (const route of output.routes) {
    if (route.pageId) {
      const page = output.pages[route.pageId];
      if (!page) continue;
      if (page.document && (page.render === "csr" || page.render === "ssg")) {
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

function createStaticDocumentMetadata(
  page: PageOutput,
  route: BuildOutput["routes"][number] | undefined,
): { path?: string; render?: Extract<PageOutput["render"], "csr" | "ssg"> } {
  if (page.render !== "csr" && page.render !== "ssg") return {};
  const path = route?.path ?? page.path;
  if (!path) return {};
  return {
    path,
    render: page.render,
  };
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

function findOutputRouteForPage(
  output: BuildOutput,
  pageId: string,
): BuildOutput["routes"][number] | undefined {
  return output.routes.find((route) => route.pageId === pageId);
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
      apps.set(document.owner.appId, { fileName: document.fileName });
    }
    if (document.owner.pageId) {
      pages.set(document.owner.pageId, { fileName: document.fileName });
    }
  }

  return { apps, pages };
}

function cloneHtmlDocument(
  document: HtmlDocumentOutput | undefined,
): HtmlDocumentOutput | undefined {
  return document ? { fileName: document.fileName } : undefined;
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
  return assets.js.length > 0 || assets.css.length > 0 ? assets : undefined;
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
              return [
                page.id,
                {
                  renderer: renderer.name,
                  assets: serverAssetsForEntry(renderer),
                  routeId: page.routeId,
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
  assetsForSource: (sourceRel: string) => AssetGroup,
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
      return [
        renderer.name,
        pruneUndefined({
          kind: renderer.kind,
          phase: renderer.phase,
          owner: renderer.owner,
          assets: entry
            ? serverAssetsForEntry(entry)
            : assetsForSource(renderer.import),
        }),
      ];
    }),
  );
}

function derivePageRendering(page: PageNode): PageRenderingOutput {
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

function effectivePageHydrate(page: PageNode): HydrationMode {
  return isPartialPrerenderPage(page) || isRscPage(page)
    ? "none"
    : (page.hydrate ?? defaultHydrate(page.render));
}

function defaultHydrate(render: PageNode["render"]): HydrationMode {
  return render === "ssg" ? "none" : "load";
}

function isRscPage(page: Pick<PageNode, "componentModel">): boolean {
  return page.componentModel === "rsc";
}

function isPartialPrerenderPage(
  page: Pick<PageNode, "prerender" | "ppr">,
): boolean {
  return (
    (typeof page.prerender === "object" && page.prerender.partial === true) ||
    Boolean(page.ppr)
  );
}

function isFullPrerenderPage(
  page: Pick<PageNode, "render" | "prerender" | "ppr">,
): boolean {
  if (page.render === "ssg") return true;
  if (!page.prerender || isPartialPrerenderPage(page)) return false;
  return true;
}

function toRuntimePathname(endpoint: string): string {
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}

function moduleIdMatchesSource(moduleId: string, sourceRel: string): boolean {
  return moduleId === sourceRel || moduleId.endsWith(`/${sourceRel}`);
}
