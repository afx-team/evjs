import type {
  AppOutput,
  BuildOutput,
  PageOutput,
  RemoteEntry,
  RemoteManifest,
  RemoteOutput,
} from "@evjs/shared/manifest";

export interface AppModule {
  init?: (sharedScope: SharedScope, ctx: AppContext) => void | Promise<void>;
  mount?: (mountPoint: Element, ctx: AppContext) => void | Promise<void>;
  hydrate?: (mountPoint: Element, ctx: AppContext) => void | Promise<void>;
  unmount?: (mountPoint: Element, ctx: AppContext) => void | Promise<void>;
}

export type ShellModuleRegistration =
  | AppModule
  | ((ctx: AppContext) => AppModule | Promise<AppModule>);

declare global {
  var __EVJS_SHELL_MODULES__:
    | Record<string, ShellModuleRegistration>
    | undefined;
  var __EVJS_SHARED_SCOPE__: SharedScope | undefined;
}

export interface AppContext {
  id: string;
  kind: "app" | "page" | "remote";
  manifest: BuildOutput;
  output: AppOutput | PageOutput | RemoteOutput;
  request: ActivationRequest;
  remote?: {
    id: string;
    entryId: string;
    manifest: RemoteManifest;
    entry: RemoteEntry;
    shared: RemoteSharedResolution;
  };
}

export interface ActivationRequest {
  appId?: string;
  pageId?: string;
  remoteId?: string;
  remoteEntryId?: string;
  buildId?: string;
  url?: string | URL;
  mountPoint?: Element;
  hydrate?: boolean;
}

export interface ShellOptions {
  manifest: BuildOutput;
  drivers?: ShellDriver[];
  loadModule?: (href: string, ctx: AppContext) => Promise<AppModule>;
  loadRemoteManifest?: (
    remote: RemoteOutput,
    ctx: RemoteManifestLoadContext,
  ) => Promise<RemoteManifest>;
  resolveMountPoint?: (ctx: AppContext) => Element | null;
  shared?: SharedScope;
  sharedPolicy?: "warn" | "error";
  onRemoteSharedNegotiated?: (
    event: RemoteSharedNegotiationContext,
  ) => void | Promise<void>;
  onError?: (error: unknown, ctx: ShellErrorContext) => void | Promise<void>;
  onWarning?: (warning: ShellWarningContext) => void | Promise<void>;
}

export interface RemoteManifestLoadContext {
  id: string;
  request: ActivationRequest;
  manifest: BuildOutput;
}

export interface ShellErrorContext {
  phase: "resolve" | "load" | "init" | "mount" | "hydrate" | "unmount";
  app: AppContext;
}

export type ShellWarningContext = RemoteSharedDependenciesWarning;

export type SharedScope = Record<string, SharedScopeEntry>;

export interface SharedScopeEntry {
  version?: string;
  singleton?: boolean;
  eager?: boolean;
  loaded?: boolean;
  from?: string;
  value?: unknown;
  get?: () => unknown | Promise<unknown>;
}

export interface RemoteSharedResolution {
  provided: Record<string, SharedScopeEntry>;
  missing: string[];
  incompatible: Array<{
    name: string;
    shareKey?: string;
    requiredVersion: string;
    providedVersion?: string;
    reason: "version" | "singleton";
  }>;
}

export interface RemoteSharedDependenciesWarning {
  code: "remote-shared-dependencies";
  message: string;
  remoteId: string;
  dependencies: string[];
  missing: string[];
  incompatible: RemoteSharedResolution["incompatible"];
  resolution: RemoteSharedResolution;
  manifest: RemoteManifest;
  request: ActivationRequest;
}

export interface RemoteSharedNegotiationContext {
  remoteId: string;
  dependencies: string[];
  resolution: RemoteSharedResolution;
  manifest: RemoteManifest;
  request: ActivationRequest;
}

export interface Shell {
  start(request?: ActivationRequest): Promise<void>;
  activate(request: ActivationRequest): Promise<void>;
  preload(request: ActivationRequest): Promise<void>;
  dispose(): Promise<void>;
}

export interface ShellDriver {
  current(): ActivationRequest;
  subscribe?(callback: (request: ActivationRequest) => void): () => void;
}

export interface PageDriverOptions {
  document?: Document;
}

export interface PageDriver extends ShellDriver {}

export interface HistoryDriverOptions {
  manifest: BuildOutput;
  window?: BrowserWindowLike;
}

export interface HistoryDriver extends ShellDriver {
  subscribe(callback: (request: ActivationRequest) => void): () => void;
}

interface ActiveModule {
  id: string;
  module: AppModule;
  mountPoint: Element;
  ctx: AppContext;
  stylesheets: string[];
}

const loadingScripts = new Map<string, Promise<void>>();
const loadingStylesheets = new Map<string, Promise<void>>();
const stylesheetReferences = new Map<
  string,
  { count: number; element?: HTMLLinkElement }
>();

type BrowserWindowLike = Pick<
  Window,
  "addEventListener" | "location" | "removeEventListener"
>;

export function registerShellModule(
  href: string,
  module: ShellModuleRegistration,
): void {
  getShellModuleRegistry()[href] = module;
}

export function registerSharedDependency(
  name: string,
  entry: SharedScopeEntry,
): void {
  getSharedScope()[name] = entry;
}

export async function loadSharedDependency(name: string): Promise<unknown> {
  const entry = getSharedScope()[name];
  if (!entry) {
    throw new Error(`[evjs] Shared dependency "${name}" is not registered.`);
  }
  return entry.get ? entry.get() : entry.value;
}

export function createShell(options: ShellOptions): Shell {
  const loadModule = options.loadModule ?? defaultLoadModule;
  const loadRemoteManifest =
    options.loadRemoteManifest ?? defaultLoadRemoteManifest;
  const moduleCache = new Map<string, Promise<AppModule>>();
  const moduleInitCache = new Map<string, Promise<void>>();
  const remoteManifestCache = new Map<string, Promise<RemoteManifest>>();
  const warnedSharedRemotes = new Set<string>();
  const driverDisposers: Array<() => void> = [];
  const sharedScope = createShellSharedScope(options.shared);
  let active: ActiveModule | undefined;

  async function resolve(request: ActivationRequest): Promise<{
    id: string;
    href: string;
    ctx: AppContext;
    mountPoint: Element;
  }> {
    const target = await resolveTarget(
      options.manifest,
      request,
      loadRemoteManifest,
      remoteManifestCache,
      warnedSharedRemotes,
      options.onWarning,
      options.sharedPolicy ?? "warn",
      options.onRemoteSharedNegotiated,
      sharedScope,
    );
    const mountPoint =
      request.mountPoint ?? options.resolveMountPoint?.(target.ctx);
    if (!mountPoint) {
      const error = new Error(
        `[evjs] Unable to resolve mount point for ${target.ctx.kind} "${target.id}".`,
      );
      await options.onError?.(error, {
        phase: "resolve",
        app: target.ctx,
      });
      throw error;
    }
    return {
      ...target,
      mountPoint,
    };
  }

  async function getModule(href: string, ctx: AppContext) {
    let promise = moduleCache.get(href);
    if (!promise) {
      promise = callShellPhase(
        "load",
        ctx,
        () => loadModule(href, ctx),
        options.onError,
      ).catch((error) => {
        moduleCache.delete(href);
        throw error;
      });
      moduleCache.set(href, promise);
    }
    const module = await promise;
    await initializeModule(
      href,
      module,
      ctx,
      moduleInitCache,
      options.onError,
      sharedScope,
    );
    return module;
  }

  return {
    async start(request) {
      if (driverDisposers.length === 0) {
        for (const driver of options.drivers ?? []) {
          const dispose = driver.subscribe?.((next) => {
            void this.activate(next);
          });
          if (dispose) driverDisposers.push(dispose);
        }
      }

      const initialRequest =
        request ?? options.drivers?.[0]?.current() ?? ({} as ActivationRequest);
      await this.activate(initialRequest);
    },
    async activate(request) {
      const target = await resolve(request);
      if (active?.id === target.id && active.mountPoint === target.mountPoint) {
        return;
      }

      const previous = active;
      if (previous) {
        try {
          if (previous.module.unmount) {
            await callShellPhase(
              "unmount",
              previous.ctx,
              () =>
                previous.module.unmount?.(previous.mountPoint, previous.ctx),
              options.onError,
            );
          }
        } finally {
          releaseStylesheets(previous.stylesheets);
          if (active === previous) active = undefined;
        }
      }

      const stylesheets = await loadRemoteStylesheets(target.ctx);
      const module = await getModule(target.href, target.ctx);
      const shouldHydrate = request.hydrate ?? target.ctx.kind === "page";
      try {
        if (shouldHydrate && module.hydrate) {
          await callShellPhase(
            "hydrate",
            target.ctx,
            () => module.hydrate?.(target.mountPoint, target.ctx),
            options.onError,
          );
        } else if (module.mount) {
          await callShellPhase(
            "mount",
            target.ctx,
            () => module.mount?.(target.mountPoint, target.ctx),
            options.onError,
          );
        }
      } catch (error) {
        releaseStylesheets(stylesheets);
        throw error;
      }

      active = {
        id: target.id,
        module,
        mountPoint: target.mountPoint,
        ctx: target.ctx,
        stylesheets,
      };
    },
    async preload(request) {
      const target = await resolve(request);
      await getModule(target.href, target.ctx);
    },
    async dispose() {
      for (const dispose of driverDisposers.splice(0)) {
        dispose();
      }
      const current = active;
      if (current) {
        try {
          if (current.module.unmount) {
            await callShellPhase(
              "unmount",
              current.ctx,
              () => current.module.unmount?.(current.mountPoint, current.ctx),
              options.onError,
            );
          }
        } finally {
          releaseStylesheets(current.stylesheets);
        }
      }
      active = undefined;
      moduleCache.clear();
      moduleInitCache.clear();
      remoteManifestCache.clear();
    },
  };
}

async function initializeModule(
  href: string,
  module: AppModule,
  ctx: AppContext,
  moduleInitCache: Map<string, Promise<void>>,
  onError: ShellOptions["onError"],
  sharedScope: SharedScope,
): Promise<void> {
  if (!module.init) return;

  let initialized = moduleInitCache.get(href);
  if (!initialized) {
    initialized = callShellPhase(
      "init",
      ctx,
      async () => {
        await module.init?.(sharedScope, ctx);
      },
      onError,
    ).catch((error) => {
      moduleInitCache.delete(href);
      throw error;
    });
    moduleInitCache.set(href, initialized);
  }

  await initialized;
}

async function callShellPhase<T>(
  phase: ShellErrorContext["phase"],
  app: AppContext,
  run: () => T | Promise<T>,
  onError: ShellOptions["onError"],
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    await onError?.(error, { phase, app });
    throw error;
  }
}

export function createPageDriver(options: PageDriverOptions = {}): PageDriver {
  return {
    current() {
      const doc = options.document ?? globalThis.document;
      const root = doc.documentElement;
      const kind = getOptionalAttribute(root, "data-evjs-kind");
      const id = getOptionalAttribute(root, "data-evjs-id");

      return {
        appId:
          kind === "app" ? id : getOptionalAttribute(root, "data-evjs-app"),
        pageId:
          kind === "page" ? id : getOptionalAttribute(root, "data-evjs-page"),
        buildId: getOptionalAttribute(root, "data-evjs-build"),
        url: doc.location?.href,
      };
    },
  };
}

export function createHistoryDriver(
  options: HistoryDriverOptions,
): HistoryDriver {
  return {
    current() {
      return createActivationRequestFromUrl(
        options.manifest,
        getWindow(options).location.href,
      );
    },
    subscribe(callback) {
      const win = getWindow(options);
      const listener = () =>
        callback(
          createActivationRequestFromUrl(options.manifest, win.location.href),
        );
      win.addEventListener("popstate", listener);
      return () => win.removeEventListener("popstate", listener);
    },
  };
}

function getOptionalAttribute(
  element: Element,
  name: string,
): string | undefined {
  return element.getAttribute(name) ?? undefined;
}

async function resolveTarget(
  manifest: BuildOutput,
  request: ActivationRequest,
  loadRemoteManifest: ShellOptions["loadRemoteManifest"],
  remoteManifestCache: Map<string, Promise<RemoteManifest>>,
  warnedSharedRemotes: Set<string>,
  onWarning: ShellOptions["onWarning"],
  sharedPolicy: NonNullable<ShellOptions["sharedPolicy"]>,
  onRemoteSharedNegotiated: ShellOptions["onRemoteSharedNegotiated"],
  sharedScope: SharedScope,
) {
  if (request.pageId) {
    const page = manifest.pages[request.pageId];
    if (!page) {
      throw new Error(
        `[evjs] Page "${request.pageId}" is not in the manifest.`,
      );
    }
    const href = page.module?.href;
    if (!href) {
      throw new Error(
        `[evjs] Page "${request.pageId}" does not expose an importable runtime module.`,
      );
    }
    return {
      id: request.pageId,
      href,
      ctx: {
        id: request.pageId,
        kind: "page" as const,
        manifest,
        output: page,
        request,
      },
    };
  }

  const remoteTarget = await resolveRemoteTarget(
    manifest,
    request,
    loadRemoteManifest,
    remoteManifestCache,
    warnedSharedRemotes,
    onWarning,
    sharedPolicy,
    onRemoteSharedNegotiated,
    sharedScope,
  );
  if (remoteTarget) return remoteTarget;

  const appId = request.appId ?? Object.keys(manifest.apps)[0];
  const app = appId ? manifest.apps[appId] : undefined;
  if (!appId || !app) {
    throw new Error("[evjs] No app target is available in the manifest.");
  }
  const href = app.module?.href;
  if (!href) {
    throw new Error(
      `[evjs] App "${appId}" does not expose an importable runtime module.`,
    );
  }
  return {
    id: appId,
    href,
    ctx: {
      id: appId,
      kind: "app" as const,
      manifest,
      output: app,
      request,
    },
  };
}

async function resolveRemoteTarget(
  manifest: BuildOutput,
  request: ActivationRequest,
  loadRemoteManifest: ShellOptions["loadRemoteManifest"],
  remoteManifestCache: Map<string, Promise<RemoteManifest>>,
  warnedSharedRemotes: Set<string>,
  onWarning: ShellOptions["onWarning"],
  sharedPolicy: NonNullable<ShellOptions["sharedPolicy"]>,
  onRemoteSharedNegotiated: ShellOptions["onRemoteSharedNegotiated"],
  sharedScope: SharedScope,
) {
  const pathname = getRequestPathname(request);
  const remoteId =
    request.remoteId ?? findRemoteIdForPath(manifest.remotes, pathname);
  if (!remoteId) return undefined;

  const remote = manifest.remotes?.[remoteId];
  if (!remote) {
    throw new Error(`[evjs] Remote "${remoteId}" is not in the manifest.`);
  }
  if (!loadRemoteManifest) {
    throw new Error("[evjs] No remote manifest loader is configured.");
  }

  let remoteManifestPromise = remoteManifestCache.get(remoteId);
  if (!remoteManifestPromise) {
    remoteManifestPromise = loadRemoteManifest(remote, {
      id: remoteId,
      request,
      manifest,
    }).catch((error) => {
      remoteManifestCache.delete(remoteId);
      throw error;
    });
    remoteManifestCache.set(remoteId, remoteManifestPromise);
  }

  const remoteManifest = await remoteManifestPromise;
  const shared = await negotiateRemoteSharedDependencies(
    remoteId,
    remoteManifest,
    request,
    warnedSharedRemotes,
    onWarning,
    sharedPolicy,
    onRemoteSharedNegotiated,
    sharedScope,
  );
  const entryId = resolveRemoteEntryId(remoteManifest, request, pathname);
  const entry = remoteManifest.entries[entryId];
  const href = entry.module.href;
  if (!href) {
    throw new Error(
      `[evjs] Remote "${remoteId}" entry "${entryId}" does not expose an importable runtime module.`,
    );
  }

  return {
    id: `${remoteId}:${entryId}`,
    href: resolveRemoteHref(remoteManifest.baseUrl, href),
    ctx: {
      id: remoteId,
      kind: "remote" as const,
      manifest,
      output: remote,
      request,
      remote: {
        id: remoteId,
        entryId,
        manifest: remoteManifest,
        entry,
        shared,
      },
    },
  };
}

async function negotiateRemoteSharedDependencies(
  remoteId: string,
  manifest: RemoteManifest,
  request: ActivationRequest,
  warnedSharedRemotes: Set<string>,
  onWarning: ShellOptions["onWarning"],
  sharedPolicy: NonNullable<ShellOptions["sharedPolicy"]>,
  onRemoteSharedNegotiated: ShellOptions["onRemoteSharedNegotiated"],
  sharedScope: SharedScope,
): Promise<RemoteSharedResolution> {
  const dependencies = Object.keys(manifest.shared ?? {});
  const resolution: RemoteSharedResolution = {
    provided: {},
    missing: [],
    incompatible: [],
  };
  if (dependencies.length === 0) return resolution;

  for (const [name, requirement] of Object.entries(manifest.shared ?? {})) {
    const shareKey = requirement.shareKey ?? name;
    const provided = sharedScope[shareKey];
    if (!provided) {
      resolution.missing.push(name);
      continue;
    }

    if (requirement.singleton && provided.singleton === false) {
      resolution.incompatible.push({
        name,
        shareKey,
        requiredVersion: requirement.requiredVersion ?? "*",
        providedVersion: provided.version,
        reason: "singleton",
      });
      continue;
    }

    if (
      requirement.requiredVersion &&
      (!provided.version ||
        !satisfiesRequiredVersion(
          provided.version,
          requirement.requiredVersion,
        ))
    ) {
      resolution.incompatible.push({
        name,
        shareKey,
        requiredVersion: requirement.requiredVersion,
        providedVersion: provided.version,
        reason: "version",
      });
      continue;
    }

    resolution.provided[name] = provided;
  }

  if (resolution.missing.length === 0 && resolution.incompatible.length === 0) {
    await onRemoteSharedNegotiated?.({
      remoteId,
      dependencies,
      resolution,
      manifest,
      request,
    });
    return resolution;
  }

  if (
    sharedPolicy === "error" ||
    hasStrictSharedFailure(manifest, resolution)
  ) {
    throw new Error(
      formatSharedDependencyMessage(remoteId, dependencies, resolution),
    );
  }

  if (warnedSharedRemotes.has(remoteId)) return resolution;

  warnedSharedRemotes.add(remoteId);
  const warning: RemoteSharedDependenciesWarning = {
    code: "remote-shared-dependencies",
    remoteId,
    dependencies,
    missing: resolution.missing,
    incompatible: resolution.incompatible,
    resolution,
    manifest,
    request,
    message: formatSharedDependencyMessage(remoteId, dependencies, resolution),
  };

  if (onWarning) {
    await onWarning(warning);
  } else {
    console.warn(warning.message);
  }

  await onRemoteSharedNegotiated?.({
    remoteId,
    dependencies,
    resolution,
    manifest,
    request,
  });

  return resolution;
}

function getSharedScope(): SharedScope {
  let scope = globalThis.__EVJS_SHARED_SCOPE__;
  if (!scope) {
    scope = {};
    globalThis.__EVJS_SHARED_SCOPE__ = scope;
  }
  return scope;
}

function createShellSharedScope(shared: SharedScope | undefined): SharedScope {
  return {
    ...getSharedScope(),
    ...(shared ?? {}),
  };
}

function hasStrictSharedFailure(
  manifest: RemoteManifest,
  resolution: RemoteSharedResolution,
): boolean {
  const failed = new Set([
    ...resolution.missing,
    ...resolution.incompatible.map((item) => item.name),
  ]);

  return Object.entries(manifest.shared ?? {}).some(
    ([name, requirement]) => requirement.strictVersion && failed.has(name),
  );
}

function formatSharedDependencyMessage(
  remoteId: string,
  dependencies: string[],
  resolution: RemoteSharedResolution,
): string {
  const details = [
    resolution.missing.length > 0
      ? `missing: ${resolution.missing.join(", ")}`
      : undefined,
    resolution.incompatible.length > 0
      ? `incompatible: ${resolution.incompatible
          .map((item) =>
            item.reason === "singleton"
              ? `${item.name} requires a singleton shared module`
              : `${item.name}@${item.providedVersion ?? "unknown"} does not satisfy ${item.requiredVersion}`,
          )
          .join(", ")}`
      : undefined,
  ].filter(Boolean);

  return (
    `[evjs] Remote "${remoteId}" declares shared dependencies (${dependencies.join(", ")}), ` +
    `but the host share scope cannot satisfy all requirements` +
    (details.length > 0 ? ` (${details.join("; ")})` : "") +
    "."
  );
}

function satisfiesRequiredVersion(version: string, required: string): boolean {
  const normalizedRequired = required.trim();
  if (!normalizedRequired || normalizedRequired === "*") return true;

  if (normalizedRequired.includes("||")) {
    return normalizedRequired
      .split("||")
      .some((part) => satisfiesRequiredVersion(version, part));
  }

  const comparators = normalizedRequired.split(/\s+/).filter(Boolean);
  if (comparators.length > 1) {
    return comparators.every((part) => satisfiesRequiredVersion(version, part));
  }

  if (normalizedRequired.startsWith("^")) {
    return sameMajor(version, normalizedRequired.slice(1));
  }
  if (normalizedRequired.startsWith("~")) {
    return sameMajorMinor(version, normalizedRequired.slice(1));
  }
  if (normalizedRequired.startsWith(">=")) {
    return compareVersions(version, normalizedRequired.slice(2)) >= 0;
  }
  if (normalizedRequired.startsWith(">")) {
    return compareVersions(version, normalizedRequired.slice(1)) > 0;
  }
  if (normalizedRequired.startsWith("<=")) {
    return compareVersions(version, normalizedRequired.slice(2)) <= 0;
  }
  if (normalizedRequired.startsWith("<")) {
    return compareVersions(version, normalizedRequired.slice(1)) < 0;
  }
  return normalizeVersion(version) === normalizeVersion(normalizedRequired);
}

function sameMajor(left: string, right: string): boolean {
  return parseVersion(left)[0] === parseVersion(right)[0];
}

function sameMajorMinor(left: string, right: string): boolean {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  return (
    leftVersion[0] === rightVersion[0] && leftVersion[1] === rightVersion[1]
  );
}

function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  for (let index = 0; index < 3; index++) {
    const diff = leftVersion[index] - rightVersion[index];
    if (diff !== 0) return diff;
  }
  return 0;
}

function normalizeVersion(version: string): string {
  return parseVersion(version).join(".");
}

function parseVersion(version: string): [number, number, number] {
  const match = version.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return [
    Number(match?.[1] ?? 0),
    Number(match?.[2] ?? 0),
    Number(match?.[3] ?? 0),
  ];
}

function findRemoteIdForPath(
  remotes: BuildOutput["remotes"],
  pathname: string | undefined,
): string | undefined {
  if (!pathname) return undefined;

  for (const [id, remote] of Object.entries(remotes ?? {})) {
    if (matchesAnyPattern(pathname, remote.activeWhen)) {
      return id;
    }
  }

  return undefined;
}

export function createActivationRequestFromUrl(
  manifest: BuildOutput,
  url: string | URL,
): ActivationRequest {
  const href = url.toString();
  const pathname = getPathname(href);
  const route = manifest.routes.find((candidate) =>
    routePathMatches(candidate.path, pathname),
  );

  return {
    url: href,
    appId: route?.appId,
    pageId: route?.pageId,
  };
}

function routePathMatches(routePath: string, pathname: string): boolean {
  const routeSegments = splitPath(routePath);
  const pathSegments = splitPath(pathname);
  if (routeSegments.length !== pathSegments.length) {
    if (routePath.endsWith("/*")) {
      const prefix = routePath.slice(0, -2);
      return pathname === prefix || pathname.startsWith(`${prefix}/`);
    }
    return false;
  }

  return routeSegments.every((segment, index) => {
    const value = pathSegments[index];
    return (
      segment === value ||
      segment.startsWith("$") ||
      segment.startsWith(":") ||
      segment === "*"
    );
  });
}

function splitPath(pathname: string): string[] {
  return normalizePathname(pathname).split("/").filter(Boolean);
}

function normalizePathname(pathname: string): string {
  if (!pathname.startsWith("/")) return normalizePathname(`/${pathname}`);
  if (pathname.length === 1) return pathname;
  return pathname.replace(/\/+$/, "");
}

function getPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.startsWith("/") ? url : "/";
  }
}

function getWindow(options: HistoryDriverOptions): BrowserWindowLike {
  const win = options.window ?? globalThis.window;
  if (!win) {
    throw new Error("[evjs] HistoryDriver requires a browser window.");
  }
  return win;
}

function resolveRemoteEntryId(
  manifest: RemoteManifest,
  request: ActivationRequest,
  pathname: string | undefined,
): string {
  if (request.remoteEntryId) {
    if (manifest.entries[request.remoteEntryId]) return request.remoteEntryId;
    throw new Error(
      `[evjs] Remote entry "${request.remoteEntryId}" is not in remote "${manifest.name}".`,
    );
  }

  if (pathname) {
    for (const [id, entry] of Object.entries(manifest.entries)) {
      if (matchesAnyPattern(pathname, entry.activeWhen)) return id;
    }
  }

  if (manifest.entries.default) return "default";

  const firstEntryId = Object.keys(manifest.entries)[0];
  if (firstEntryId) return firstEntryId;

  throw new Error(`[evjs] Remote "${manifest.name}" has no entries.`);
}

function getRequestPathname(request: ActivationRequest): string | undefined {
  if (!request.url) return undefined;
  if (request.url instanceof URL) return request.url.pathname;

  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url.startsWith("/") ? request.url : undefined;
  }
}

function matchesAnyPattern(
  pathname: string,
  patterns: string[] | undefined,
): boolean {
  return (
    patterns?.some((pattern) => matchesPattern(pathname, pattern)) ?? false
  );
}

function matchesPattern(pathname: string, pattern: string): boolean {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  }

  if (!pattern.includes("*")) return pathname === pattern;

  const expression = pattern.split("*").map(escapeRegExp).join(".*");
  return new RegExp(`^${expression}$`).test(pathname);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveRemoteHref(baseUrl: string, href: string): string {
  return new URL(href, ensureTrailingSlash(baseUrl)).toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

async function defaultLoadModule(
  href: string,
  ctx: AppContext,
): Promise<AppModule> {
  const registered = await readRegisteredModule(href, ctx);
  if (registered) return registered;

  await loadScriptAsset(href);

  const loaded = await readRegisteredModule(href, ctx);
  if (loaded) return loaded;

  throw new Error(
    `[evjs] Shell module script "${href}" loaded but did not register a module. ` +
      `Call registerShellModule("${href}", module) from the built entry or pass loadModule to createShell().`,
  );
}

function getShellModuleRegistry(): Record<string, ShellModuleRegistration> {
  let registry = globalThis.__EVJS_SHELL_MODULES__;
  if (!registry) {
    registry = {};
    globalThis.__EVJS_SHELL_MODULES__ = registry;
  }
  return registry;
}

async function readRegisteredModule(
  href: string,
  ctx: AppContext,
): Promise<AppModule | undefined> {
  const registry = globalThis.__EVJS_SHELL_MODULES__;
  const registered = getRegistryKeys(href)
    .map((key) => registry?.[key])
    .find((entry) => Boolean(entry));
  if (!registered) return undefined;

  return typeof registered === "function" ? registered(ctx) : registered;
}

function getRegistryKeys(href: string): string[] {
  const keys = [href];
  const absoluteHref = resolveBrowserHref(href);
  if (absoluteHref && absoluteHref !== href) {
    keys.push(absoluteHref);
  }
  return keys;
}

function resolveBrowserHref(href: string): string | undefined {
  try {
    return new URL(href, globalThis.location?.href).toString();
  } catch {
    return undefined;
  }
}

async function loadScriptAsset(href: string): Promise<void> {
  const doc = globalThis.document;
  if (!doc) {
    throw new Error(
      `[evjs] Shell cannot load "${href}" outside a browser document. Pass loadModule to createShell().`,
    );
  }

  let promise = loadingScripts.get(href);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const script = doc.createElement("script");
      script.async = true;
      script.src = href;
      script.setAttribute?.("data-evjs-shell-load", "true");
      script.onload = () => resolve();
      script.onerror = () =>
        reject(
          new Error(`[evjs] Failed to load shell module script "${href}".`),
        );
      doc.head.appendChild(script);
    }).catch((error) => {
      loadingScripts.delete(href);
      throw error;
    });
    loadingScripts.set(href, promise);
  }

  await promise;
}

async function loadRemoteStylesheets(ctx: AppContext): Promise<string[]> {
  if (ctx.kind !== "remote" || !ctx.remote) return [];

  const remote = ctx.remote;
  const cssAssets = remote.entry.assets?.css ?? [];
  if (cssAssets.length === 0) return [];

  const hrefs = [
    ...new Set(
      cssAssets.map((asset) =>
        resolveRemoteHref(remote.manifest.baseUrl, asset),
      ),
    ),
  ];
  return Promise.all(hrefs.map((href) => acquireStylesheetAsset(href)));
}

async function acquireStylesheetAsset(href: string): Promise<string> {
  const doc = globalThis.document;
  if (!doc) {
    throw new Error(
      `[evjs] Shell cannot load stylesheet "${href}" outside a browser document.`,
    );
  }

  const current = stylesheetReferences.get(href);
  if (current) {
    current.count += 1;
    await loadingStylesheets.get(href);
    return href;
  }

  const existing = findManagedStylesheet(doc, href);
  if (existing) {
    stylesheetReferences.set(href, {
      count: 1,
      element: existing,
    });
    return href;
  }

  let element: HTMLLinkElement | undefined;
  let promise = loadingStylesheets.get(href);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const link = doc.createElement("link");
      element = link;
      link.rel = "stylesheet";
      link.href = href;
      link.setAttribute?.("data-evjs-shell-style", "true");
      link.onload = () => resolve();
      link.onerror = () =>
        reject(new Error(`[evjs] Failed to load shell stylesheet "${href}".`));
      doc.head.appendChild(link);
    }).catch((error) => {
      loadingStylesheets.delete(href);
      stylesheetReferences.delete(href);
      throw error;
    });
    loadingStylesheets.set(href, promise);
    stylesheetReferences.set(href, {
      count: 1,
      element,
    });
  }

  await promise;
  return href;
}

function releaseStylesheets(hrefs: string[]): void {
  for (const href of hrefs) {
    const reference = stylesheetReferences.get(href);
    if (!reference) continue;

    reference.count -= 1;
    if (reference.count > 0) continue;

    reference.element?.remove?.();
    stylesheetReferences.delete(href);
    loadingStylesheets.delete(href);
  }
}

function findManagedStylesheet(
  doc: Document,
  href: string,
): HTMLLinkElement | undefined {
  if (!doc.querySelectorAll) return undefined;
  const links = doc.querySelectorAll<HTMLLinkElement>(
    "link[data-evjs-shell-style]",
  );

  return Array.from(links).find((link) => {
    const rawHref = link.getAttribute("href");
    return rawHref === href || link.href === resolveBrowserHref(href);
  });
}

async function defaultLoadRemoteManifest(
  remote: RemoteOutput,
): Promise<RemoteManifest> {
  const response = await fetch(remote.manifest);
  if (!response.ok) {
    throw new Error(
      `[evjs] Failed to load remote manifest "${remote.manifest}": ${response.status} ${response.statusText}`,
    );
  }
  const manifest = (await response.json()) as RemoteManifest;
  if (isLocalRemoteManifestUrl(remote.manifest)) {
    return {
      ...manifest,
      baseUrl: new URL(".", remote.manifest).toString(),
    };
  }
  return manifest;
}

function isLocalRemoteManifestUrl(manifestUrl: string): boolean {
  try {
    const url = new URL(manifestUrl, globalThis.location?.href);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}
