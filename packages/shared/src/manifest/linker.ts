import type {
  AppGraph,
  AppOutput,
  AssetGroup,
  BuildEntry,
  BuildOutput,
  BuildPlan,
  HydrationMode,
  PageNode,
  PageOutput,
  PageRenderingOutput,
  PprRegionOutput,
  RemoteManifest,
  RuntimeModuleOutput,
  ServerFunctionOutput,
  ServerRouteOutput,
} from "./index.js";

const EMPTY_ASSETS: AssetGroup = { js: [], css: [] };

export interface BuildOutputServerModule {
  moduleId: string;
  assets: AssetGroup;
}

export interface BuildOutputLinkInput {
  graph: AppGraph;
  plan: BuildPlan;
  serverEnabled?: boolean;
  clientEntryAssets?: Record<string, AssetGroup>;
  firstClientEntryAssets?: AssetGroup;
  serverEntryAssets?: Record<string, AssetGroup>;
  serverEntry?: string;
  serverAssets?: AssetGroup;
  serverModules?: BuildOutputServerModule[];
  rscManifests?: {
    clientReferenceManifest?: Record<string, unknown>;
    serverConsumerManifest?: Record<string, unknown>;
  };
}

export function linkBuildOutput(input: BuildOutputLinkInput): BuildOutput {
  const serverEnabled = input.serverEnabled ?? input.plan.serverEnabled;
  const clientEntryAssets = input.clientEntryAssets ?? {};
  const firstClientEntryAssets = input.firstClientEntryAssets ?? EMPTY_ASSETS;
  const serverEntryAssets = input.serverEntryAssets ?? {};
  const serverAssets = input.serverAssets ?? EMPTY_ASSETS;
  const serverModules = input.serverModules ?? [];
  const clientEntries = input.plan.entries.filter(
    (entry) => entry.environment === "client",
  );
  const shouldUseSingleClientFallback = clientEntries.length === 1;

  const clientAssetsForEntry = (entry: BuildEntry) =>
    clientEntryAssets[entry.name] ??
    (shouldUseSingleClientFallback ? firstClientEntryAssets : EMPTY_ASSETS);
  const serverAssetsForEntry = (entry: BuildEntry) =>
    serverEntryAssets[entry.name] ?? serverAssets;

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
      return [
        id,
        {
          assets,
          entry: app.entry,
          routes: app.routes,
          mount: app.mount,
          module: entry
            ? {
                type: "entry" as const,
                href: assets.js[0],
                source: app.entry,
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
        : page.render === "rsc" && rscClientRuntimeEntry
          ? clientAssetsForEntry(rscClientRuntimeEntry)
          : EMPTY_ASSETS;
      const serverCss =
        page.render === "rsc"
          ? [
              ...serverCssForPage(id, "page-server"),
              ...serverCssForPage(id, "rsc-page"),
            ]
          : page.render === "ssr" || page.render === "ssg"
            ? serverCssForPage(id, "page-server")
            : page.render === "ppr"
              ? serverCssForPage(id, "ppr-shell")
              : [];
      const assets = mergeAssetGroups(baseAssets, {
        js: [],
        css: serverCss,
      });
      return [
        id,
        {
          assets,
          render: page.render,
          rendering: derivePageRendering(page),
          path: page.path,
          routeId: page.routeId,
          entry: page.entry,
          component: page.component,
          app: page.app,
          hydrate: page.hydrate,
          mount: page.mount,
          module: entry
            ? {
                type: page.component
                  ? ("react-component" as const)
                  : page.app
                    ? ("lifecycle" as const)
                    : ("entry" as const),
                href: assets.js[0],
                source: page.component ?? page.app ?? page.entry,
              }
            : undefined,
          ppr:
            page.render === "ppr"
              ? {
                  shell: shellEntry
                    ? serverAssetsForEntry(shellEntry)
                    : serverAssets,
                  regions: Object.fromEntries(
                    Object.entries(page.ppr?.regions ?? {}).map(
                      ([regionId, region]) => {
                        const regionEntry = findEntryByOwner(
                          { pageId: id, regionId },
                          "server",
                          "ppr-region",
                        );
                        return [
                          regionId,
                          {
                            id: regionId,
                            assets: regionEntry
                              ? serverAssetsForEntry(regionEntry)
                              : serverAssets,
                            component: region.component,
                            fallback: region.fallback,
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
      module: fn.module,
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
  const rsc = linkRscOutput(input, serverAssetsForEntry, serverAssets);

  return {
    version: 1,
    buildId: input.plan.buildId,
    distDir: input.plan.distDir,
    publicPath: input.plan.runtime.publicPath,
    runtime: {
      server: input.plan.runtime.server,
      transport: input.plan.runtime.transport,
    },
    assets: entryAssets,
    apps,
    pages,
    routes: input.graph.routes.map((route) => ({
      id: route.id,
      path: route.path,
      appId: route.appId,
      pageId: route.pageId,
      module: route.module,
      render: route.render,
      hydrate: route.hydrate,
      runtime: route.runtime,
    })),
    server: serverEnabled
      ? {
          entry: input.serverEntry,
          assets: serverAssets,
          renderers: linkServerRenderers(
            input.plan,
            serverAssetsForEntry,
            assetsForSource,
          ),
          functions: serverFunctions,
          routes: serverRoutes,
        }
      : undefined,
    remotes: Object.fromEntries(
      Object.entries(input.graph.remotes).map(([id, remote]) => [
        id,
        {
          manifest: remote.manifest,
          activeWhen: remote.activeWhen,
        },
      ]),
    ),
    ...(rsc ? { rsc } : {}),
  };
}

/**
 * Project the internal build output into the public runtime manifest that is
 * safe to serve to browsers and deployment adapters.
 *
 * The internal `BuildOutput` intentionally keeps source modules, server
 * renderer modules, and raw React Flight manifests because the server runtime
 * needs those facts. The public manifest must not expose that implementation
 * metadata.
 */
export function createPublicManifest(output: BuildOutput): BuildOutput {
  const publicAssetFiles = collectPublicAssetFiles(output);
  return pruneUndefined({
    version: output.version,
    buildId: output.buildId,
    distDir: output.distDir,
    publicPath: output.publicPath,
    runtime: output.runtime,
    assets: clonePublicAssetRecord(output.assets, publicAssetFiles),
    apps: Object.fromEntries(
      Object.entries(output.apps).map(([id, app]) => [
        id,
        sanitizeAppOutput(app),
      ]),
    ),
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
        appId: route.appId,
        pageId: route.pageId,
        render: route.render,
        hydrate: route.hydrate,
        runtime: route.runtime,
      }),
    ),
    server: output.server
      ? pruneUndefined({
          assets: clonePublicAssets(output.server.assets, publicAssetFiles),
          functions: Object.fromEntries(
            Object.entries(output.server.functions).map(([id, fn]) => [
              id,
              pruneUndefined({
                assets: clonePublicAssets(fn.assets, publicAssetFiles),
                exportName: fn.exportName,
              }),
            ]),
          ),
          routes: output.server.routes.map((route) =>
            pruneUndefined({
              path: route.path,
              methods: [...route.methods],
              assets: clonePublicAssets(route.assets, publicAssetFiles),
            }),
          ),
        })
      : undefined,
    remotes: output.remotes
      ? Object.fromEntries(
          Object.entries(output.remotes).map(([id, remote]) => [
            id,
            pruneUndefined({
              manifest: remote.manifest,
              activeWhen: remote.activeWhen
                ? [...remote.activeWhen]
                : undefined,
            }),
          ]),
        )
      : undefined,
    rsc: output.rsc
      ? pruneUndefined({
          endpoint: output.rsc.endpoint,
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
    deployment: output.deployment
      ? sanitizePublicMetadata(output.deployment)
      : undefined,
  }) as BuildOutput;
}

export interface RemoteManifestLinkInput {
  plan: BuildPlan;
  clientEntryAssets?: Record<string, AssetGroup>;
  firstClientEntryAssets?: AssetGroup;
}

export function linkRemoteManifest(
  input: RemoteManifestLinkInput,
): RemoteManifest | undefined {
  const remote = input.plan.remote;
  if (!remote) return undefined;

  const clientEntryAssets = input.clientEntryAssets ?? {};
  const firstClientEntryAssets = input.firstClientEntryAssets ?? EMPTY_ASSETS;
  const remoteEntries = input.plan.entries.filter(
    (entry) => entry.environment === "client" && entry.kind === "remote-client",
  );
  const shouldUseSingleRemoteFallback = remoteEntries.length === 1;

  return {
    version: 1,
    name: remote.name,
    baseUrl: remote.baseUrl,
    ...(remote.shared ? { shared: remote.shared } : {}),
    entries: Object.fromEntries(
      Object.values(remote.entries).map((entry) => {
        const buildEntry = remoteEntries.find(
          (candidate) =>
            candidate.owner?.remoteId === remote.name &&
            candidate.owner?.remoteEntryId === entry.id,
        );
        const assets = buildEntry
          ? (clientEntryAssets[buildEntry.name] ??
            (shouldUseSingleRemoteFallback
              ? firstClientEntryAssets
              : EMPTY_ASSETS))
          : EMPTY_ASSETS;

        return [
          entry.id,
          {
            assets,
            module: {
              type: "lifecycle" as const,
              href: assets.js[0],
            },
            activeWhen: entry.activeWhen,
            mount: entry.mount,
          },
        ];
      }),
    ),
  };
}

function sanitizeAppOutput(app: AppOutput): AppOutput {
  return pruneUndefined({
    assets: cloneAssets(app.assets),
    mount: app.mount,
    module: sanitizeRuntimeModule(app.module),
  }) as AppOutput;
}

function sanitizePageOutput(
  page: PageOutput,
  publicAssetFiles: Set<string>,
): PageOutput {
  return pruneUndefined({
    assets: clonePublicAssets(page.assets, publicAssetFiles),
    render: page.render,
    rendering: page.rendering,
    path: page.path,
    routeId: page.routeId,
    hydrate: page.hydrate,
    mount: page.mount,
    module: sanitizeRuntimeModule(page.module),
    ppr: page.ppr
      ? {
          shell: clonePublicAssets(page.ppr.shell, publicAssetFiles),
          regions: Object.fromEntries(
            Object.entries(page.ppr.regions).map(([id, region]) => [
              id,
              sanitizePprRegion(region, publicAssetFiles),
            ]),
          ),
        }
      : undefined,
  }) as PageOutput;
}

function sanitizePprRegion(
  region: PprRegionOutput,
  publicAssetFiles: Set<string>,
): PprRegionOutput {
  return pruneUndefined({
    id: region.id,
    assets: clonePublicAssets(region.assets, publicAssetFiles),
    cache: region.cache,
    hydrate: region.hydrate,
  }) as PprRegionOutput;
}

function sanitizeRuntimeModule(
  module: RuntimeModuleOutput | undefined,
): RuntimeModuleOutput | undefined {
  if (!module) return undefined;
  return pruneUndefined({
    type: module.type,
    href: module.href,
  }) as RuntimeModuleOutput;
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

function sanitizePublicMetadata(
  value: unknown,
  key = "",
): Record<string, unknown> | undefined {
  const sanitized = sanitizeMetadataValue(value, key);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : undefined;
}

function sanitizeMetadataValue(value: unknown, key: string): unknown {
  if (value === undefined || typeof value === "function") return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeMetadataValue(item, key))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    return pruneUndefined(
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .map(([childKey, childValue]) => [
            childKey,
            sanitizeMetadataValue(childValue, childKey),
          ])
          .filter(([, childValue]) => childValue !== undefined),
      ),
    );
  }
  if (typeof value === "string" && isSourceLikeString(value, key)) {
    return undefined;
  }
  return value;
}

function isSourceLikeString(value: string, key: string): boolean {
  if (key === "href" || key === "manifest") return false;
  if (/^file:\/\//.test(value)) return true;
  if (/\.[cm]?tsx?(?:[?#]|$)/.test(value)) return true;
  return /(?:^|\/)(?:Users|home|private|tmp)\//.test(value);
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
  fallbackAssets: AssetGroup,
): BuildOutput["rsc"] | undefined {
  const endpoint = input.plan.runtime.server?.rsc;
  const rscRenderers = input.plan.entries.filter(
    (entry) => entry.environment === "server" && entry.kind === "rsc-page",
  );
  const rscPages = Object.values(input.graph.pages).filter(
    (page) => page.render === "rsc",
  );

  if (
    !endpoint &&
    rscPages.length === 0 &&
    !input.graph.clientReferences?.length &&
    !input.graph.serverReferences?.length &&
    !input.rscManifests?.clientReferenceManifest &&
    !input.rscManifests?.serverConsumerManifest
  ) {
    return undefined;
  }

  return {
    endpoint,
    pages:
      rscPages.length > 0
        ? Object.fromEntries(
            rscPages.map((page) => {
              const renderer = rscRenderers.find(
                (entry) => entry.owner?.pageId === page.id,
              );
              return [
                page.id,
                {
                  renderer: renderer?.name,
                  assets: renderer
                    ? serverAssetsForEntry(renderer)
                    : fallbackAssets,
                  component: page.component,
                  routeId: page.routeId,
                },
              ];
            }),
          )
        : undefined,
    clientReferences: referencesToRecord(input.graph.clientReferences),
    serverReferences: referencesToRecord(input.graph.serverReferences),
    clientReferenceManifest: input.rscManifests?.clientReferenceManifest,
    serverConsumerManifest: input.rscManifests?.serverConsumerManifest,
  };
}

function referencesToRecord(
  references:
    | Array<{ id: string; module: string; exportName?: string }>
    | undefined,
): Record<string, unknown> | undefined {
  if (!references?.length) return undefined;
  return Object.fromEntries(
    references.map((reference) => [
      reference.id,
      {
        module: reference.module,
        exportName: reference.exportName,
      },
    ]),
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
          module: renderer.import,
          assets: entry
            ? serverAssetsForEntry(entry)
            : assetsForSource(renderer.import),
        },
      ];
    }),
  );
}

function derivePageRendering(page: PageNode): PageRenderingOutput {
  const hydrate = page.hydrate ?? defaultHydrate(page.render);

  switch (page.render) {
    case "csr":
      return {
        mode: page.render,
        component: "client",
        html: "client",
        streaming: false,
        hydrate,
      };
    case "ssg":
      return {
        mode: page.render,
        component: "server",
        html: "static",
        prerender: "full",
        streaming: false,
        hydrate,
      };
    case "ppr":
      return {
        mode: page.render,
        component: "server",
        html: "partial",
        prerender: "partial",
        streaming: true,
        hydrate,
      };
    case "rsc":
      return {
        mode: page.render,
        component: "rsc",
        html: "server",
        streaming: true,
        hydrate: "load",
      };
    default:
      return {
        mode: page.render,
        component: "server",
        html: "server",
        streaming: false,
        hydrate,
      };
  }
}

function defaultHydrate(render: PageNode["render"]): HydrationMode {
  return render === "ssg" ? "none" : "load";
}

function moduleIdMatchesSource(moduleId: string, sourceRel: string): boolean {
  return moduleId === sourceRel || moduleId.endsWith(`/${sourceRel}`);
}
