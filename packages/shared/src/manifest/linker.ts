import {
  BUILD_IDENTIFIER_DESCRIPTION,
  isBuildIdentifier,
} from "../build-identifier.js";
import {
  getPathPatternListValidationError,
  type PathPatternListValidationError,
  type PathPatternValidationError,
} from "../path-pattern.js";
import {
  getSharedVersionRangeValidationError,
  SHARED_VERSION_RANGE_DESCRIPTION,
} from "../shared-version-range.js";
import { getHttpUrlOrPathValidationError } from "../url-validation.js";
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
  RemoteEntry,
  RemoteManifest,
  RscReferenceOutput,
  RuntimeModuleOutput,
  ServerFunctionOutput,
  ServerRouteOutput,
  SharedDependencyMap,
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
  const serverEntry = serverEnabled
    ? assertServerRuntimeEntry(
        input.serverEntry ?? serverRuntimeAssets.js[0],
        serverRuntimeAssets,
        serverRuntimeEntry,
      )
    : undefined;
  const serverAssets = serverEnabled
    ? serverRuntimeAssets
    : fallbackServerAssets;

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
          entry: app.entry,
          mount: app.mount,
          module: entry
            ? {
                type: "entry" as const,
                href,
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
          entry: page.entry,
          component: page.component,
          componentModel: page.componentModel,
          app: page.app,
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
                source: page.component ?? page.app ?? page.entry,
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
  const rsc = linkRscOutput(input, serverAssetsForEntry);

  return {
    version: 1,
    buildId: input.plan.buildId,
    distDir: input.plan.distDir,
    paths: createBuildOutputPaths(input.plan.distDir, serverEnabled),
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
          entry: serverEntry,
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
      "[evjs] Server-enabled build did not declare a server runtime entry.",
    );
  }
  if (serverEntry && assets.js.length > 0) return serverEntry;
  throw new Error(
    `[evjs] Server runtime entry "${runtimeEntry.name}" did not produce a server JavaScript asset.`,
  );
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
    paths: output.paths,
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

function createBuildOutputPaths(
  distDir: string,
  serverEnabled: boolean,
): NonNullable<BuildOutput["paths"]> {
  return {
    rootDir: distDir,
    publicDir: serverEnabled ? joinManifestPath(distDir, "client") : distDir,
    ...(serverEnabled
      ? {
          serverDir: joinManifestPath(distDir, "server"),
        }
      : {}),
  };
}

function joinManifestPath(...parts: string[]): string {
  return parts
    .map((part, index) =>
      index === 0 ? part.replace(/\/+$/, "") : part.replace(/^\/+|\/+$/g, ""),
    )
    .filter(Boolean)
    .join("/");
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

  const name = assertRemoteManifestBuildIdentifier(remote.name, "remote.name");
  const baseUrl = assertRemoteManifestBaseUrl(remote.baseUrl, "remote.baseUrl");
  const shared =
    remote.shared === undefined
      ? undefined
      : assertRemoteManifestShared(remote.shared);
  const entries = Object.entries(remote.entries);
  if (entries.length === 0) {
    throw new Error(
      "[evjs] remote.entries must declare at least one remote entry before remote manifest emission.",
    );
  }
  const clientEntryAssets = input.clientEntryAssets ?? {};
  const remoteEntries = input.plan.entries.filter(
    (entry) => entry.environment === "client" && entry.kind === "remote-client",
  );
  const activeWhenOwners = new Map<string, string>();

  return {
    version: 1,
    name,
    baseUrl,
    ...(shared !== undefined ? { shared } : {}),
    entries: Object.fromEntries(
      entries.map(([entryId, entry]) => {
        assertRemoteManifestBuildIdentifierKey(entryId, "remote.entries");
        const id = assertRemoteManifestBuildIdentifier(
          entry.id,
          `remote.entries.${entryId}.id`,
        );
        if (id !== entryId) {
          throw new Error(
            `[evjs] remote.entries.${entryId}.id "${id}" must match remote.entries key "${entryId}" before remote manifest emission.`,
          );
        }
        const activeWhen =
          entry.activeWhen === undefined
            ? undefined
            : assertRemoteManifestActiveWhenPatterns(
                entry.activeWhen,
                `remote.entries.${entryId}.activeWhen`,
              );
        registerRemoteManifestActiveWhenPatterns(
          activeWhen,
          `remote.entries.${entryId}.activeWhen`,
          activeWhenOwners,
        );
        const mount =
          entry.mount === undefined
            ? undefined
            : assertRemoteManifestString(
                entry.mount,
                `remote.entries.${entryId}.mount`,
              );
        const buildEntry = assertRemoteClientBuildEntry(
          name,
          entryId,
          remoteEntries,
        );
        const assets = clientEntryAssets[buildEntry.name] ?? EMPTY_ASSETS;
        assertRemoteManifestAssetGroup(
          assets,
          `remote.entries.${entryId}.assets`,
        );
        const href = getClientRuntimeHref(buildEntry, assets);
        if (!href) {
          throw new Error(
            `[evjs] Remote entry "${entryId}" for remote "${remote.name}" did not produce a client JavaScript asset.`,
          );
        }

        const remoteEntry: RemoteEntry = {
          assets,
          module: {
            type: "lifecycle",
            href,
          },
          ...(activeWhen !== undefined ? { activeWhen } : {}),
          ...(mount !== undefined ? { mount } : {}),
        };
        return [entryId, remoteEntry];
      }),
    ),
  };
}

function assertRemoteClientBuildEntry(
  remoteName: string,
  entryId: string,
  remoteEntries: BuildEntry[],
): BuildEntry {
  const buildEntry = remoteEntries.find(
    (candidate) =>
      candidate.owner?.remoteId === remoteName &&
      candidate.owner?.remoteEntryId === entryId,
  );
  if (buildEntry) return buildEntry;

  throw new Error(
    `[evjs] Remote entry "${entryId}" for remote "${remoteName}" did not declare a matching remote-client build entry.`,
  );
}

function assertRemoteManifestBuildIdentifierKey(
  key: string,
  path: string,
): void {
  if (!key.trim()) {
    throw new Error(
      `[evjs] ${path} must not contain empty keys before remote manifest emission.`,
    );
  }
  if (isBuildIdentifier(key)) return;
  throw new Error(
    `[evjs] ${path} key "${key}" must contain only ${BUILD_IDENTIFIER_DESCRIPTION} before remote manifest emission.`,
  );
}

function assertRemoteManifestBuildIdentifier(
  value: unknown,
  path: string,
): string {
  const identifier = assertRemoteManifestString(value, path);
  if (isBuildIdentifier(identifier)) return identifier;
  throw new Error(
    `[evjs] ${path} must contain only ${BUILD_IDENTIFIER_DESCRIPTION} before remote manifest emission.`,
  );
}

function assertRemoteManifestBaseUrl(value: unknown, path: string): string {
  const error = getHttpUrlOrPathValidationError(value);
  if (!error) return value as string;

  switch (error) {
    case "empty":
      throw new Error(
        `[evjs] ${path} must be a non-empty string before remote manifest emission.`,
      );
    case "whitespace":
      throw new Error(
        `[evjs] ${path} must not contain leading or trailing whitespace before remote manifest emission.`,
      );
    case "not-http-url-or-path":
      throw new Error(
        `[evjs] ${path} must be an http(s) URL or path before remote manifest emission.`,
      );
  }
}

function assertRemoteManifestString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `[evjs] ${path} must be a non-empty string before remote manifest emission.`,
    );
  }
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] ${path} must not contain leading or trailing whitespace before remote manifest emission.`,
    );
  }
  return value;
}

function assertRemoteManifestAssetGroup(
  assets: AssetGroup,
  path: string,
): void {
  assertRemoteManifestStringArray(assets.js, `${path}.js`);
  assertRemoteManifestStringArray(assets.css, `${path}.css`);
}

function assertRemoteManifestStringArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new Error(
      `[evjs] ${path} must be an array before remote manifest emission.`,
    );
  }
  for (const item of value) {
    assertRemoteManifestString(item, path);
  }
}

function assertRemoteManifestActiveWhenPatterns(
  value: unknown,
  path: string,
): string[] {
  const error = getPathPatternListValidationError(value);
  if (error) throwRemoteManifestPathPatternListError(error, path);
  return [...(value as string[])];
}

function throwRemoteManifestPathPatternListError(
  error: PathPatternListValidationError,
  path: string,
): never {
  switch (error.kind) {
    case "not-array":
      throw new Error(
        `[evjs] ${path} must be an array of path patterns before remote manifest emission.`,
      );
    case "empty-array":
      throw new Error(
        `[evjs] ${path} must contain at least one path before remote manifest emission.`,
      );
    case "duplicate-pattern":
      throw new Error(
        `[evjs] ${path} must not contain duplicate pattern "${error.pattern}" before remote manifest emission.`,
      );
    case "invalid-pattern":
      throwRemoteManifestPathPatternError(error.value, error.error, path);
  }
}

function throwRemoteManifestPathPatternError(
  value: unknown,
  error: PathPatternValidationError,
  path: string,
): never {
  if (error === "empty" || typeof value !== "string") {
    throw new Error(
      `[evjs] ${path} must contain only non-empty strings before remote manifest emission.`,
    );
  }
  if (error === "whitespace") {
    throw new Error(
      `[evjs] ${path} pattern "${value}" must not contain whitespace before remote manifest emission.`,
    );
  }
  if (error === "missing-leading-slash") {
    throw new Error(
      `[evjs] ${path} pattern "${value}" must start with "/" before remote manifest emission.`,
    );
  }
  throw new Error(
    `[evjs] ${path} pattern "${value}" must not include a query string or hash before remote manifest emission.`,
  );
}

function registerRemoteManifestActiveWhenPatterns(
  patterns: string[] | undefined,
  path: string,
  owners: Map<string, string>,
): void {
  for (const pattern of patterns ?? []) {
    const existing = owners.get(pattern);
    if (existing) {
      throw new Error(
        `[evjs] ${path} duplicates ${existing} pattern "${pattern}". Remote entry activeWhen patterns must be unique before remote manifest emission.`,
      );
    }
    owners.set(pattern, path);
  }
}

function assertRemoteManifestShared(shared: unknown): SharedDependencyMap {
  assertRemoteManifestRecord(shared, "remote.shared");
  const dependencies: SharedDependencyMap = {};

  for (const [name, dependency] of Object.entries(shared)) {
    if (!name.trim()) {
      throw new Error(
        "[evjs] remote.shared must not contain empty keys before remote manifest emission.",
      );
    }
    const path = `remote.shared.${name}`;
    assertRemoteManifestRecord(dependency, path);
    dependencies[name] = {
      ...(dependency.shareKey !== undefined
        ? {
            shareKey: assertRemoteManifestString(
              dependency.shareKey,
              `${path}.shareKey`,
            ),
          }
        : {}),
      ...(dependency.requiredVersion !== undefined
        ? {
            requiredVersion: assertRemoteManifestSharedVersionRange(
              dependency.requiredVersion,
              `${path}.requiredVersion`,
            ),
          }
        : {}),
      ...(dependency.singleton !== undefined
        ? {
            singleton: assertRemoteManifestOptionalBoolean(
              dependency.singleton,
              `${path}.singleton`,
            ),
          }
        : {}),
      ...(dependency.strictVersion !== undefined
        ? {
            strictVersion: assertRemoteManifestOptionalBoolean(
              dependency.strictVersion,
              `${path}.strictVersion`,
            ),
          }
        : {}),
      ...(dependency.eager !== undefined
        ? {
            eager: assertRemoteManifestOptionalBoolean(
              dependency.eager,
              `${path}.eager`,
            ),
          }
        : {}),
    };
  }

  return dependencies;
}

function assertRemoteManifestRecord(
  value: unknown,
  path: string,
): asserts value is Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return;
  throw new Error(
    `[evjs] ${path} must be an object before remote manifest emission.`,
  );
}

function assertRemoteManifestSharedVersionRange(
  value: unknown,
  path: string,
): string {
  const error = getSharedVersionRangeValidationError(value);
  if (!error) return value as string;
  if (error === "empty") {
    throw new Error(
      `[evjs] ${path} must be a non-empty string before remote manifest emission.`,
    );
  }
  if (error === "whitespace") {
    throw new Error(
      `[evjs] ${path} must not contain leading or trailing whitespace before remote manifest emission.`,
    );
  }
  throw new Error(
    `[evjs] ${path} must use ${SHARED_VERSION_RANGE_DESCRIPTION} before remote manifest emission.`,
  );
}

function assertRemoteManifestOptionalBoolean(
  value: unknown,
  path: string,
): boolean {
  if (typeof value === "boolean") return value;
  throw new Error(
    `[evjs] ${path} must be a boolean when provided before remote manifest emission.`,
  );
}

function sanitizeAppOutput(app: AppOutput): AppOutput {
  return pruneUndefined({
    assets: cloneAssets(app.assets),
    document: cloneHtmlDocument(app.document),
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
  }) as PageOutput;
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
): BuildOutput["rsc"] | undefined {
  const endpoint = input.plan.runtime.server?.rsc;
  const rscRenderers = input.plan.entries.filter(
    (entry) => entry.environment === "server" && entry.kind === "rsc-page",
  );
  const rscPages = Object.values(input.graph.pages).filter(isRscPage);

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
  if (!endpoint && rscPages.length > 0) {
    throw new Error(
      `[evjs] RSC page "${rscPages[0].id}" requires runtime.server.rsc before RSC manifest emission.`,
    );
  }

  return {
    endpoint,
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

function referencesToRecord(
  references:
    | Array<{ id: string; module: string; exportName?: string }>
    | undefined,
): Record<string, RscReferenceOutput> | undefined {
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
