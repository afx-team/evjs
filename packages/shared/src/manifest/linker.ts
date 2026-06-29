import type {
  AppGraph,
  AppOutput,
  AssetGroup,
  BuildEntry,
  BuildOutput,
  BuildPlan,
  HtmlDocumentOutput,
  HydrationMode,
  PageNode,
  PageOutput,
  PageRenderingOutput,
  PprRegionOutput,
  PublicAppOutput,
  PublicManifestOutput,
  PublicPageOutput,
  PublicPprRegionOutput,
  PublicRuntimeModuleOutput,
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
  functions: string[];
  routes: ServerManifestRouteOutput[];
}

export interface ServerManifestRouteOutput {
  path: string;
  methods: string[];
}

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
  const serverEntry = assertServerRuntimeEntry(
    input.serverEntry ?? serverRuntimeAssets.js[0],
    serverRuntimeAssets,
    serverRuntimeEntry,
  );
  const serverAssets = serverRuntimeAssets;

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
                          hydrate: region.hydrate,
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
 * Project the internal build output into the public runtime manifest that is
 * safe to serve to browsers.
 *
 * The public manifest keeps browser-safe deployment metadata. Runtime startup
 * data lives in `runtime.json`; framework endpoints live under
 * `BuildOutput.runtime.server`.
 */
export function createPublicManifest(
  output: BuildOutput,
): PublicManifestOutput {
  const publicAssetFiles = collectPublicAssetFiles(output);
  return pruneUndefined({
    version: output.version,
    buildId: output.buildId,
    publicPath: output.publicPath,
    assets: clonePublicAssetRecord(output.assets, publicAssetFiles),
    app: createPublicManifestApp(output),
    pages: Object.fromEntries(
      Object.entries(output.pages).map(([id, page]) => [
        id,
        sanitizePageOutput(page, publicAssetFiles),
      ]),
    ),
    routes: output.routes.map((route) =>
      pruneUndefined({
        id: route.id,
        path: route.path,
        pageId: route.pageId,
      }),
    ),
    rsc: output.rsc
      ? pruneUndefined({
          pages: output.rsc.pages
            ? Object.fromEntries(
                Object.entries(output.rsc.pages).map(([id, page]) => [
                  id,
                  pruneUndefined({
                    renderer: page.renderer,
                    assets: clonePublicAssets(page.assets, publicAssetFiles),
                    routeId: page.routeId,
                  }),
                ]),
              )
            : undefined,
        })
      : undefined,
  }) as PublicManifestOutput;
}

function createPublicManifestApp(
  output: BuildOutput,
): PublicAppOutput | undefined {
  const app = output.apps.default ?? Object.values(output.apps)[0];
  return app ? sanitizeAppOutput(app) : undefined;
}

export function createServerManifest(
  output: BuildOutput,
): ServerManifestOutput {
  const routes = output.server.routes.map((route) => ({
    path: route.path,
    methods: [...route.methods],
  }));

  return {
    version: 1,
    ...(output.server.entry ? { entry: output.server.entry } : {}),
    functions: Object.keys(output.server.functions),
    routes,
  };
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

function sanitizeAppOutput(app: AppOutput): PublicAppOutput {
  return pruneUndefined({
    assets: cloneAssets(app.assets),
    document: cloneHtmlDocument(app.document),
    mount: app.mount,
    module: sanitizeRuntimeModule(app.module),
  }) as PublicAppOutput;
}

function sanitizePageOutput(
  page: PageOutput,
  publicAssetFiles: Set<string>,
): PublicPageOutput {
  return pruneUndefined({
    assets: clonePublicAssets(page.assets, publicAssetFiles),
    document: cloneHtmlDocument(page.document),
    render: page.render,
    rendering: page.rendering,
    path: page.path,
    routeId: page.routeId,
    componentModel: page.componentModel,
    hydrate: page.hydrate,
    mount: page.mount,
    prerender: page.prerender,
    module: sanitizeRuntimeModule(page.module),
    ppr: page.ppr
      ? {
          delivery: page.ppr.delivery ?? "merge",
          shell: clonePublicAssets(page.ppr.shell, publicAssetFiles),
          regions: Object.fromEntries(
            Object.entries(page.ppr.regions).map(([id, region]) => [
              id,
              sanitizePprRegion(region, publicAssetFiles),
            ]),
          ),
        }
      : undefined,
  }) as PublicPageOutput;
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

function sanitizePprRegion(
  region: PprRegionOutput,
  publicAssetFiles: Set<string>,
): PublicPprRegionOutput {
  return pruneUndefined({
    id: region.id,
    assets: clonePublicAssets(region.assets, publicAssetFiles),
    cache: region.cache,
    hydrate: region.hydrate,
  }) as PublicPprRegionOutput;
}

function sanitizeRuntimeModule(
  module: PublicRuntimeModuleOutput | undefined,
): PublicRuntimeModuleOutput | undefined {
  if (!module) return undefined;
  return pruneUndefined({
    type: module.type,
    href: module.href,
  }) as PublicRuntimeModuleOutput;
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

function cloneAssets(assets: AssetGroup): AssetGroup {
  return {
    js: [...assets.js],
    css: [...assets.css],
  };
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
        {
          kind: renderer.kind,
          owner: renderer.owner,
          assets: entry
            ? serverAssetsForEntry(entry)
            : assetsForSource(renderer.import),
        },
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

function moduleIdMatchesSource(moduleId: string, sourceRel: string): boolean {
  return moduleId === sourceRel || moduleId.endsWith(`/${sourceRel}`);
}
