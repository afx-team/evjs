import {
  createBrowserHistory,
  createHashHistory,
  type RouterHistory,
  useLocation,
} from "@evjs/ev/navigation";
import type { AppConfiguration, LifeCycleFn, LifeCycles } from "qiankun";
import {
  createElement,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

type MaybePromise<T> = T | Promise<T>;

export type QiankunHistoryType = "browser" | "hash" | "memory";
export type QiankunRouteMode = "prepend" | "match";

export type QiankunLoadSettings = AppConfiguration;
export type QiankunLifeCycles = LifeCycles<Record<string, unknown>>;
type QiankunLifeCycle = LifeCycleFn<Record<string, unknown>>;

export type QiankunAppProps = Record<string, unknown> & {
  settings?: QiankunLoadSettings;
};

export type QiankunRouteProps = Record<string, unknown> & {
  settings?: QiankunLoadSettings;
  lifeCycles?: QiankunLifeCycles;
};

/** Canonical app descriptor consumed by the public qiankun bridge. */
export interface QiankunApp {
  name: string;
  entry: string;
  props?: QiankunAppProps;
}

export interface QiankunMicroAppRoute {
  path: string;
  microApp: string;
  mode?: QiankunRouteMode;
  microAppProps?: QiankunRouteProps;
  redirect?: never;
}

export interface QiankunRedirectRoute {
  path: string;
  redirect: string;
  microApp?: never;
  mode?: never;
  microAppProps?: never;
}

export type QiankunRoute = QiankunMicroAppRoute | QiankunRedirectRoute;

export interface QiankunMasterOptions {
  apps?: QiankunApp[];
  /** Application-level route snapshot, typically supplied by a site platform. */
  routes?: QiankunRoute[];
  /** Base path already owned by the master Application. */
  base?: string;
  /** History mode projected into mounted slave Applications. */
  history?: QiankunHistoryType;
  /** qiankun loadMicroApp settings shared by route-mounted Applications. */
  settings?: QiankunLoadSettings;
  lifeCycles?: QiankunLifeCycles;
  prefetch?: boolean | "all" | string[];
  prefetchThreshold?: number;
}

export type QiankunMasterResolver = () => MaybePromise<QiankunMasterOptions>;

export type QiankunHistoryOptions =
  | { type: "browser" }
  | { type: "hash" }
  | {
      type: "memory";
      initialEntries?: string[];
      initialIndex?: number;
    };

export interface QiankunLifecycleProps {
  container?: Element | string | null;
  base?: string;
  history?: QiankunHistoryType | QiankunHistoryOptions;
  [key: string]: unknown;
}

export interface QiankunSlaveRuntimeContext {
  name: string;
  mount: string;
  container?: Element;
  loadEntry(): Promise<unknown>;
}

export type QiankunSlaveLifecycle = (
  props: QiankunLifecycleProps,
  ctx: QiankunSlaveRuntimeContext,
) => MaybePromise<void>;

export interface QiankunSlaveRuntime {
  bootstrap?: QiankunSlaveLifecycle;
  mount?: QiankunSlaveLifecycle;
  /** Runs after runtime projection and entry mounting complete successfully. */
  afterMount?: QiankunSlaveLifecycle;
  update?: QiankunSlaveLifecycle;
  /** Runs after a mounted update settles, including projection-neutral updates. */
  afterUpdate?: QiankunSlaveLifecycle;
  unmount?: QiankunSlaveLifecycle;
}

type QiankunRuntimePageKind = "page" | "layout" | "group" | "redirect";

type QiankunRuntimePageRedirect =
  | { kind: "path"; path: string }
  | { kind: "url"; href: string };

interface QiankunRuntimePageModule {
  default?: () => ReactElement;
}

export interface QiankunRuntimePageDefinition {
  id: string;
  path: string;
  kind?: QiankunRuntimePageKind;
  module?: QiankunRuntimePageModule;
  redirect?: QiankunRuntimePageRedirect;
}

interface NormalizedQiankunMasterOptions {
  apps: QiankunApp[];
  routes: QiankunRoute[];
  base: string;
  history: QiankunHistoryType;
  settings: QiankunLoadSettings;
  lifeCycles?: QiankunLifeCycles;
  prefetch?: boolean | "all" | string[];
  prefetchThreshold: number;
  prefetchState: { scheduled: boolean };
}

interface GeneratedPagesAppRuntimeUpdate {
  routes?: QiankunRuntimePageDefinition[];
  basepath?: string;
  history?: QiankunHistoryOptions | RouterHistory;
}

interface QiankunMicroAppInstance {
  mountPromise?: Promise<unknown>;
  unmount(): MaybePromise<unknown>;
  update?(props: Record<string, unknown>): MaybePromise<unknown>;
}

interface SlaveRuntimeProjection {
  basepath: string;
  history: QiankunHistoryOptions;
}

interface QiankunRuntimeModule {
  loadMicroApp(
    app: {
      name: string;
      entry: string;
      container: HTMLElement;
      props?: Record<string, unknown>;
    },
    settings?: Record<string, unknown>,
    lifeCycles?: QiankunLifeCycles,
  ): QiankunMicroAppInstance;
  prefetchApps?(
    apps: Array<{ name: string; entry: string }>,
    fetch?: typeof globalThis.fetch,
  ): void;
}

const qiankunLifecycleNames = [
  "beforeLoad",
  "beforeMount",
  "afterMount",
  "beforeUnmount",
  "afterUnmount",
] as const;

const qiankunMasterOptionFields = [
  "apps",
  "routes",
  "base",
  "history",
  "settings",
  "lifeCycles",
  "prefetch",
  "prefetchThreshold",
] as const;
const qiankunAppFields = ["name", "entry", "props"] as const;
const qiankunMicroAppRouteFields = [
  "path",
  "microApp",
  "mode",
  "microAppProps",
] as const;
const qiankunRedirectRouteFields = ["path", "redirect"] as const;
const qiankunRouteParamNamePattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const reservedQiankunRouteParamNames = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "_splat",
]);
export function defineQiankunMasterResolver<T extends QiankunMasterResolver>(
  resolver: T,
): T {
  return resolver;
}

export function defineQiankunSlaveRuntime<T extends QiankunSlaveRuntime>(
  runtime: T,
): T {
  return runtime;
}

export function resolveQiankunModuleExport<T>(
  module: Record<string, unknown>,
  exportName: string,
  label: string,
): T {
  const value = module[exportName];
  if (value === undefined) {
    throw new Error(
      `[evjs:plugin-qiankun] ${label} export "${exportName}" was not found.`,
    );
  }
  return value as T;
}

/**
 * Resolve one authoritative master snapshot, install its runtime route overlay,
 * and only then render the framework-owned Application.
 */
export async function startQiankunMaster(options: {
  resolver: QiankunMasterResolver;
  mount: string;
  loadEntry(): Promise<unknown>;
}): Promise<QiankunMasterOptions> {
  const masterOptions = await options.resolver();
  const normalized = normalizeQiankunMasterOptions(masterOptions);
  const routes = createNormalizedQiankunMasterRoutes(normalized);
  const entryModule = await options.loadEntry();
  await updateGeneratedPagesApp(entryModule, { routes });
  const start = resolveEntryStart(entryModule);
  if (!start) {
    throw new Error(
      "[evjs:plugin-qiankun] The generated master entry does not expose start().",
    );
  }
  await start(options.mount);
  await prefetchQiankunApps(normalized);
  return masterOptions;
}

/** Convert an application-level route snapshot into an evjs runtime overlay. */
export function createQiankunMasterRoutes(
  masterOptions: QiankunMasterOptions,
): QiankunRuntimePageDefinition[] {
  return createNormalizedQiankunMasterRoutes(
    normalizeQiankunMasterOptions(masterOptions),
  );
}

function createNormalizedQiankunMasterRoutes(
  normalized: NormalizedQiankunMasterOptions,
): QiankunRuntimePageDefinition[] {
  return normalized.routes.map((route, index) => {
    if (isQiankunRedirectRoute(route)) {
      return {
        id: `__evjs_qiankun_redirect_${index}`,
        path: toEvjsRoutePath(route.path, false),
        kind: "redirect" as const,
        redirect: toEvjsRedirect(route.redirect),
      };
    }

    const app = resolveRouteApp(normalized, route);
    const routePath = toEvjsRoutePath(
      route.path,
      (route.mode ?? "prepend") === "prepend",
    );
    return {
      id: `__evjs_qiankun_app_${index}_${sanitizeRouteId(app.name)}`,
      path: routePath,
      module: {
        default: createQiankunRouteComponent(normalized, route, app),
      },
    };
  });
}

export function createQiankunSlaveLifecycles(options: {
  name: string;
  mount: string;
  runtime?: QiankunSlaveRuntime;
  loadEntry(): Promise<unknown>;
}) {
  const runtime = options.runtime ?? {};
  let loadedEntry: Promise<unknown> | undefined;
  let loadedEntryModule: unknown;
  let currentContainer: Element | undefined;
  let bootstrapped = false;
  let entryInitialized = false;
  let entryMounted = false;
  let lifecycleQueue = Promise.resolve();
  let scopedHistory: RouterHistory | undefined;
  let runtimeProjection: SlaveRuntimeProjection = {
    basepath: "/",
    history: { type: "browser" },
  };

  const ctx = (): QiankunSlaveRuntimeContext => ({
    name: options.name,
    mount: options.mount,
    container: currentContainer,
    loadEntry,
  });

  async function loadEntry(): Promise<unknown> {
    let pendingEntry = loadedEntry;
    if (!pendingEntry) {
      pendingEntry = Promise.resolve().then(() => options.loadEntry());
      loadedEntry = pendingEntry;
    }
    try {
      const entryModule = await pendingEntry;
      loadedEntryModule = entryModule;
      return entryModule;
    } catch (error) {
      if (loadedEntry === pendingEntry) {
        loadedEntry = undefined;
        loadedEntryModule = undefined;
      }
      throw error;
    }
  }

  async function runBootstrap(
    props: QiankunLifecycleProps = {},
  ): Promise<void> {
    if (bootstrapped) return;
    currentContainer = resolveMountContainer(props, options.mount);
    try {
      await runtime.bootstrap?.(props, ctx());
      bootstrapped = true;
    } catch (error) {
      currentContainer = undefined;
      throw error;
    }
  }

  async function runMount(
    props: QiankunLifecycleProps = {},
    useStandaloneDefaults = false,
  ): Promise<void> {
    if (entryMounted) return;
    currentContainer = resolveMountContainer(props, options.mount);
    const context = ctx();
    const previousProjection = runtimeProjection;
    let nextProjection = previousProjection;
    let projectionUpdate:
      | ((update: GeneratedPagesAppRuntimeUpdate) => MaybePromise<void>)
      | undefined;
    let projectionAttempted = false;
    let runtimeHookAttempted = false;
    let entryMountAttempted = false;
    let nextScopedHistory: RouterHistory | undefined;
    let rollbackScopedHistory: RouterHistory | undefined;
    let entryModule: unknown;

    try {
      runtimeHookAttempted = runtime.mount !== undefined;
      await runtime.mount?.(props, context);
      entryModule = await context.loadEntry();
      nextProjection = resolveSlaveRuntimeProjection(
        props,
        previousProjection,
        useStandaloneDefaults,
      );
      nextScopedHistory = useStandaloneDefaults
        ? undefined
        : createScopedSlaveHistory(nextProjection.history.type);
      const projectionOptions = createSlaveRuntimeProjectionUpdate(
        previousProjection,
        nextProjection,
        nextScopedHistory,
      );
      if (projectionOptions) {
        projectionUpdate = resolveRequiredSlavePagesAppUpdate(entryModule);
        projectionAttempted = true;
        await projectionUpdate(projectionOptions);
      }
      const start = entryInitialized
        ? undefined
        : resolveEntryStart(entryModule);
      if (start) {
        entryMountAttempted = true;
        await start(currentContainer ?? options.mount);
      } else {
        const render = resolveEntryRender(entryModule);
        if (!render) {
          throw new Error(
            "[evjs:plugin-qiankun] The generated slave entry does not expose an app.render() method required for mounting.",
          );
        }
        entryMountAttempted = true;
        await render(currentContainer ?? options.mount);
      }
      entryInitialized = true;
      if (runtime.afterMount) {
        runtimeHookAttempted = true;
        await runtime.afterMount(props, context);
      }
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      if (entryMountAttempted) {
        await collectQiankunCleanupError(rollbackErrors, () =>
          unmountLoadedEntry(entryModule),
        );
      }
      if (projectionAttempted && projectionUpdate) {
        rollbackScopedHistory = useStandaloneDefaults
          ? undefined
          : createScopedSlaveHistory(previousProjection.history.type);
        const rollbackProjection = createSlaveRuntimeProjectionUpdate(
          nextProjection,
          previousProjection,
          rollbackScopedHistory ?? previousProjection.history,
        );
        if (rollbackProjection) {
          try {
            await projectionUpdate(rollbackProjection);
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
            rollbackScopedHistory?.destroy();
            rollbackScopedHistory = undefined;
          }
        }
      }
      if (runtimeHookAttempted) {
        await collectQiankunCleanupError(rollbackErrors, () =>
          runtime.unmount?.(props, context),
        );
      }
      await collectQiankunCleanupError(rollbackErrors, () =>
        clearContainer(currentContainer),
      );
      await collectQiankunCleanupError(rollbackErrors, () =>
        nextScopedHistory?.destroy(),
      );
      if (projectionAttempted) {
        if (rollbackScopedHistory !== scopedHistory) {
          scopedHistory?.destroy();
        }
        scopedHistory = rollbackScopedHistory;
      }
      currentContainer = undefined;
      entryMounted = false;
      throwQiankunMountError(error, rollbackErrors);
    }

    entryMounted = true;
    if (scopedHistory !== nextScopedHistory) {
      scopedHistory?.destroy();
    }
    scopedHistory = nextScopedHistory;
    runtimeProjection = nextProjection;
  }

  async function runUnmount(props: QiankunLifecycleProps = {}): Promise<void> {
    if (!entryMounted) {
      scopedHistory?.destroy();
      scopedHistory = undefined;
      currentContainer = undefined;
      return;
    }
    const context = ctx();
    const errors: unknown[] = [];
    await collectQiankunCleanupError(errors, () =>
      runtime.unmount?.(props, context),
    );
    await collectQiankunCleanupError(errors, () =>
      unmountLoadedEntry(loadedEntryModule),
    );
    await collectQiankunCleanupError(errors, () =>
      clearContainer(currentContainer),
    );
    await collectQiankunCleanupError(errors, () => scopedHistory?.destroy());
    scopedHistory = undefined;
    currentContainer = undefined;
    entryMounted = false;
    throwQiankunCleanupErrors(errors);
  }

  async function runUpdate(props: QiankunLifecycleProps = {}): Promise<void> {
    if (!entryMounted) return;
    const context = ctx();
    await runtime.update?.(props, context);
    if (!loadedEntryModule) return;
    const previousProjection = runtimeProjection;
    const nextProjection = resolveSlaveRuntimeProjection(
      props,
      previousProjection,
      false,
    );
    const historyChanged = !equalHistoryOptions(
      nextProjection.history,
      previousProjection.history,
    );
    const refreshScopedHistory = shouldRefreshScopedHistory(
      nextProjection.history.type,
      scopedHistory,
    );
    const nextScopedHistory =
      historyChanged || refreshScopedHistory
        ? createScopedSlaveHistory(nextProjection.history.type)
        : scopedHistory;
    const updateOptions = createSlaveRuntimeProjectionUpdate(
      previousProjection,
      nextProjection,
      historyChanged || refreshScopedHistory ? nextScopedHistory : undefined,
    );
    if (updateOptions) {
      const update = resolveRequiredSlavePagesAppUpdate(loadedEntryModule);
      try {
        await update(updateOptions);
      } catch (error) {
        if (nextScopedHistory !== scopedHistory) {
          nextScopedHistory?.destroy();
        }
        throw error;
      }
      if (nextScopedHistory !== scopedHistory) {
        scopedHistory?.destroy();
      }
      scopedHistory = nextScopedHistory;
      runtimeProjection = nextProjection;
    }
    await runtime.afterUpdate?.(props, context);
  }

  function enqueueLifecycle(operation: () => Promise<void>): Promise<void> {
    const result = lifecycleQueue.then(operation);
    lifecycleQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  const bootstrap = (props: QiankunLifecycleProps = {}) =>
    enqueueLifecycle(() => runBootstrap(props));
  const mount = (props: QiankunLifecycleProps = {}) =>
    enqueueLifecycle(() => runMount(props));
  const unmount = (props: QiankunLifecycleProps = {}) =>
    enqueueLifecycle(() => runUnmount(props));
  const update = (props: QiankunLifecycleProps = {}) =>
    enqueueLifecycle(() => runUpdate(props));

  return {
    bootstrap,
    mount,
    unmount,
    update,
    standalone: () => enqueueLifecycle(() => runMount({}, true)),
    isPoweredByQiankun,
  };
}

function normalizeQiankunMasterOptions(
  value: QiankunMasterOptions,
): NormalizedQiankunMasterOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "[evjs:plugin-qiankun] Master resolver must return an object.",
    );
  }
  assertNoUnknownFields(value, qiankunMasterOptionFields, "options");
  const apps = value.apps ?? [];
  const routes = value.routes ?? [];
  if (!Array.isArray(apps)) {
    throw new Error(
      "[evjs:plugin-qiankun] Master resolver apps must be an array.",
    );
  }
  if (!Array.isArray(routes)) {
    throw new Error(
      "[evjs:plugin-qiankun] Master resolver routes must be an array.",
    );
  }

  const appNames = new Set<string>();
  apps.forEach((app, index) => {
    if (!isRecord(app)) {
      throw new Error(
        `[evjs:plugin-qiankun] Master resolver apps[${index}] must be an object.`,
      );
    }
    assertNoUnknownFields(app, qiankunAppFields, `apps[${index}]`);
    assertTrimmedString(app.name, `apps[${index}].name`);
    assertTrimmedString(app.entry, `apps[${index}].entry`);
    if (appNames.has(app.name)) {
      throw new Error(
        `[evjs:plugin-qiankun] Master resolver contains duplicate app name "${app.name}".`,
      );
    }
    appNames.add(app.name);
    assertOptionalRecord(app.props, `apps[${index}].props`);
    if (isRecord(app.props)) {
      assertOptionalRecord(app.props.settings, `apps[${index}].props.settings`);
    }
  });

  const routePaths = new Set<string>();
  const runtimeRouteShapes = new Map<
    string,
    { index: number; path: string; runtimePath: string }
  >();
  routes.forEach((route, index) => {
    if (!isRecord(route)) {
      throw new Error(
        `[evjs:plugin-qiankun] Master resolver routes[${index}] must be an object.`,
      );
    }
    assertAbsoluteRoutePath(route.path, `routes[${index}].path`);
    const normalizedRoutePath = normalizeQiankunRoutePath(route.path);
    if (routePaths.has(normalizedRoutePath)) {
      throw new Error(
        `[evjs:plugin-qiankun] Master resolver contains duplicate route path "${normalizedRoutePath}".`,
      );
    }
    routePaths.add(normalizedRoutePath);

    const hasMicroApp = Object.hasOwn(route, "microApp");
    const hasRedirect = Object.hasOwn(route, "redirect");
    if (hasMicroApp === hasRedirect) {
      throw new Error(
        `[evjs:plugin-qiankun] Master resolver routes[${index}] must define exactly one of microApp or redirect.`,
      );
    }
    if (hasMicroApp) {
      assertNoUnknownFields(
        route,
        qiankunMicroAppRouteFields,
        `routes[${index}]`,
      );
      assertTrimmedString(route.microApp, `routes[${index}].microApp`);
      if (
        route.mode !== undefined &&
        route.mode !== "prepend" &&
        route.mode !== "match"
      ) {
        throw new Error(
          `[evjs:plugin-qiankun] Master resolver routes[${index}].mode must be "prepend" or "match".`,
        );
      }
      assertOptionalRecord(
        route.microAppProps,
        `routes[${index}].microAppProps`,
      );
      if (isRecord(route.microAppProps)) {
        assertOptionalRecord(
          route.microAppProps.settings,
          `routes[${index}].microAppProps.settings`,
        );
        assertLifeCycles(
          route.microAppProps.lifeCycles,
          `routes[${index}].microAppProps.lifeCycles`,
        );
      }
    } else {
      assertNoUnknownFields(
        route,
        qiankunRedirectRouteFields,
        `routes[${index}]`,
      );
      assertTrimmedString(route.redirect, `routes[${index}].redirect`);
    }

    const runtimePath = isQiankunRedirectRoute(route)
      ? toEvjsRoutePath(route.path, false)
      : toEvjsRoutePath(route.path, (route.mode ?? "prepend") === "prepend");
    const runtimeShape = qiankunRuntimeRouteShape(runtimePath);
    const previousRuntimeRoute = runtimeRouteShapes.get(runtimeShape);
    if (previousRuntimeRoute) {
      throw new Error(
        `[evjs:plugin-qiankun] Master resolver routes[${index}].path "${route.path}" conflicts with routes[${previousRuntimeRoute.index}].path "${previousRuntimeRoute.path}" after runtime route normalization ("${runtimePath}" and "${previousRuntimeRoute.runtimePath}" have the same shape).`,
      );
    }
    runtimeRouteShapes.set(runtimeShape, {
      index,
      path: route.path,
      runtimePath,
    });
  });

  const base = normalizeBase(value.base ?? "/", "base");
  const history = value.history ?? "browser";
  assertHistoryType(history, "history");
  assertOptionalRecord(value.settings, "settings");
  assertOptionalRecord(value.lifeCycles, "lifeCycles");
  assertLifeCycles(value.lifeCycles, "lifeCycles");
  assertPrefetch(value.prefetch);
  const prefetchThreshold = value.prefetchThreshold ?? 5;
  if (!Number.isInteger(prefetchThreshold) || prefetchThreshold < 0) {
    throw new Error(
      "[evjs:plugin-qiankun] Master resolver prefetchThreshold must be a non-negative integer.",
    );
  }

  const normalized: NormalizedQiankunMasterOptions = {
    apps,
    routes,
    base,
    history,
    settings: value.settings ?? {},
    prefetchThreshold,
    prefetchState: { scheduled: false },
    ...(value.lifeCycles ? { lifeCycles: value.lifeCycles } : {}),
    ...(value.prefetch !== undefined ? { prefetch: value.prefetch } : {}),
  };

  for (const route of routes) {
    if (!isQiankunRedirectRoute(route)) resolveRouteApp(normalized, route);
  }
  return normalized;
}

function resolveRouteApp(
  master: NormalizedQiankunMasterOptions,
  route: QiankunMicroAppRoute,
): QiankunApp {
  const app = master.apps.find(
    (candidate) => candidate.name === route.microApp,
  );
  if (app) return app;
  throw new Error(
    `[evjs:plugin-qiankun] Route "${route.path}" references unknown micro-app "${route.microApp}".`,
  );
}

function createQiankunRouteComponent(
  master: NormalizedQiankunMasterOptions,
  route: QiankunMicroAppRoute,
  app: QiankunApp,
): () => ReactElement {
  return function QiankunMicroAppRouteComponent() {
    const containerRef = useRef<HTMLDivElement>(null);
    const microAppRef = useRef<QiankunMicroAppInstance | undefined>(undefined);
    const mountedBaseRef = useRef<string | undefined>(undefined);
    const mountedHrefRef = useRef<string | undefined>(undefined);
    const latestBaseRef = useRef<string | undefined>(undefined);
    const latestHrefRef = useRef<string | undefined>(undefined);
    const updateQueueRef = useRef(Promise.resolve());
    const [error, setError] = useState<unknown>();
    const routePathname = useLocation({
      select: (location) => location.pathname,
    });
    const routeHref = useLocation({
      select: (location) => location.href,
    });
    const base = resolveQiankunSlaveBase(master.base, route, routePathname);
    latestBaseRef.current = base;
    latestHrefRef.current = routeHref;

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      let disposed = false;
      let microApp: QiankunMicroAppInstance | undefined;

      void importQiankun()
        .then((qiankun) => {
          if (disposed) return;
          const appProps = splitAppProps(app.props);
          const routeProps = splitRouteProps(route.microAppProps);
          const mountedBase = latestBaseRef.current;
          if (!mountedBase) return;
          const settings = {
            globalContext: globalThis.window,
            ...master.settings,
            ...appProps.settings,
            ...routeProps.settings,
          };
          microApp = qiankun.loadMicroApp(
            {
              name: app.name,
              entry: app.entry,
              container,
              props: createMountedAppProps(
                appProps.props,
                routeProps.props,
                mountedBase,
                master.history,
              ),
            },
            settings,
            mergeQiankunLifeCycles(master.lifeCycles, routeProps.lifeCycles),
          );
          microAppRef.current = microApp;
          mountedBaseRef.current = mountedBase;
          mountedHrefRef.current = latestHrefRef.current;
          void microApp.mountPromise
            ?.then(() => prefetchQiankunApps(master, "after-mount", app.name))
            .catch(reportError);
          void microApp.mountPromise?.catch((mountError) => {
            if (!disposed) setError(mountError);
          });
        })
        .catch((loadError) => {
          if (!disposed) setError(loadError);
        });

      return () => {
        disposed = true;
        if (microAppRef.current === microApp) {
          microAppRef.current = undefined;
        }
        if (!microApp) return;
        void unmountQiankunMicroAppAfterUpdates(
          microApp,
          updateQueueRef.current,
        ).catch(reportError);
      };
    }, []);

    useEffect(() => {
      const microApp = microAppRef.current;
      if (
        !microApp?.update ||
        (mountedBaseRef.current === base &&
          mountedHrefRef.current === routeHref)
      ) {
        return;
      }

      const update = updateQueueRef.current.then(async () => {
        await microApp.mountPromise;
        if (microAppRef.current !== microApp) return;
        const nextBase = latestBaseRef.current ?? base;
        const nextHref = latestHrefRef.current ?? routeHref;
        if (
          mountedBaseRef.current === nextBase &&
          mountedHrefRef.current === nextHref
        ) {
          return;
        }
        const appProps = splitAppProps(app.props);
        const routeProps = splitRouteProps(route.microAppProps);
        await microApp.update?.(
          createMountedAppProps(
            appProps.props,
            routeProps.props,
            nextBase,
            master.history,
          ),
        );
        mountedBaseRef.current = nextBase;
        mountedHrefRef.current = nextHref;
      });
      updateQueueRef.current = update.catch(() => {});
      void update.catch((updateError) => {
        if (microAppRef.current === microApp) setError(updateError);
      });
    }, [base, routeHref]);

    if (error) throw error;
    return createElement("div", {
      ref: containerRef,
      "data-evjs-qiankun-app": app.name,
    });
  };
}

/** @internal */
export async function unmountQiankunMicroAppAfterUpdates(
  microApp: QiankunMicroAppInstance,
  updateQueue: Promise<unknown>,
): Promise<void> {
  if (microApp.mountPromise) {
    await microApp.mountPromise.catch(() => {});
  }
  await updateQueue.catch(() => {});
  await microApp.unmount();
}

function createMountedAppProps(
  appProps: Record<string, unknown>,
  routeProps: Record<string, unknown>,
  base: string,
  history: QiankunHistoryType,
): Record<string, unknown> {
  return {
    ...appProps,
    ...routeProps,
    base,
    history,
  };
}

function splitAppProps(value: QiankunAppProps | undefined): {
  props: Record<string, unknown>;
  settings: QiankunLoadSettings;
} {
  if (!value) return { props: {}, settings: {} };
  const { settings, ...props } = value;
  return {
    props,
    settings: isRecord(settings) ? settings : {},
  };
}

function splitRouteProps(value: QiankunRouteProps | undefined): {
  props: Record<string, unknown>;
  settings: QiankunLoadSettings;
  lifeCycles?: QiankunLifeCycles;
} {
  if (!value) return { props: {}, settings: {} };
  const { settings, lifeCycles, ...props } = value;
  return {
    props,
    settings: isRecord(settings) ? settings : {},
    ...(lifeCycles ? { lifeCycles } : {}),
  };
}

function mergeQiankunLifeCycles(
  globalLifeCycles: QiankunLifeCycles | undefined,
  routeLifeCycles: QiankunLifeCycles | undefined,
): QiankunLifeCycles | undefined {
  if (!globalLifeCycles) return routeLifeCycles;
  if (!routeLifeCycles) return globalLifeCycles;

  const merged: QiankunLifeCycles = {};
  for (const name of qiankunLifecycleNames) {
    const lifecycles = [
      ...toLifecycleArray(globalLifeCycles[name]),
      ...toLifecycleArray(routeLifeCycles[name]),
    ];
    if (lifecycles.length > 0) merged[name] = lifecycles;
  }
  return merged;
}

function toLifecycleArray(
  lifecycle: QiankunLifeCycle | QiankunLifeCycle[] | undefined,
): QiankunLifeCycle[] {
  if (!lifecycle) return [];
  return Array.isArray(lifecycle) ? lifecycle : [lifecycle];
}

/** @internal */
export function resolveQiankunSlaveBase(
  masterBase: string,
  route: QiankunMicroAppRoute,
  routePathname: string,
): string {
  if ((route.mode ?? "prepend") === "match") return masterBase;
  const matchedPrefix = matchRoutePrefix(
    route.path,
    stripBase(routePathname, masterBase),
  );
  if (!matchedPrefix) {
    throw new Error(
      `[evjs:plugin-qiankun] Route "${route.path}" did not match the active router pathname "${routePathname}".`,
    );
  }
  return joinBase(masterBase, matchedPrefix);
}

function matchRoutePrefix(
  pattern: string,
  pathname: string,
): string | undefined {
  const patternSegments = splitPath(pattern).filter(
    (segment) => segment !== "*" && segment !== "$",
  );
  const pathnameSegments = splitPath(pathname);
  if (pathnameSegments.length < patternSegments.length) {
    return undefined;
  }
  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const pathnameSegment = pathnameSegments[index];
    if (
      patternSegment &&
      !patternSegment.startsWith(":") &&
      !patternSegment.startsWith("$") &&
      patternSegment !== pathnameSegment
    ) {
      return undefined;
    }
  }
  return `/${pathnameSegments.slice(0, patternSegments.length).join("/")}`;
}

function stripBase(pathname: string, base: string): string {
  if (base === "/") return pathname;
  if (pathname === base) return "/";
  return pathname.startsWith(`${base}/`)
    ? pathname.slice(base.length)
    : pathname;
}

function joinBase(base: string, path: string): string {
  if (base === "/") return normalizeBase(path, "route base");
  if (path === "/") return base;
  return `${base}${path}`.replace(/\/{2,}/g, "/");
}

function toEvjsRoutePath(path: string, prepend: boolean): string {
  let normalized = normalizeQiankunRoutePath(path);
  normalized = normalized
    .split("/")
    .map((segment) => {
      if (segment === "*") return "$";
      if (segment.startsWith(":")) return `$${segment.slice(1)}`;
      return segment;
    })
    .join("/");
  if (!prepend || normalized.endsWith("/$") || normalized === "/$") {
    return normalized;
  }
  return normalized === "/" ? "/$" : `${normalized}/$`;
}

function toEvjsRedirect(
  redirect: string,
): { kind: "path"; path: string } | { kind: "url"; href: string } {
  if (/^https?:\/\//.test(redirect)) return { kind: "url", href: redirect };
  assertAbsoluteRoutePath(redirect, "redirect");
  return { kind: "path", path: toEvjsRoutePath(redirect, false) };
}

function isQiankunRedirectRoute(
  route: QiankunRoute,
): route is QiankunRedirectRoute {
  return typeof route.redirect === "string";
}

function resolveSlaveRuntimeProjection(
  props: QiankunLifecycleProps,
  current: SlaveRuntimeProjection,
  useStandaloneDefaults = true,
): SlaveRuntimeProjection {
  return {
    basepath: resolveSlaveBasepath(
      props.base,
      current.basepath,
      useStandaloneDefaults,
    ),
    history:
      normalizeSlaveHistory(props.history) ??
      (useStandaloneDefaults ? { type: "browser" } : current.history),
  };
}

function resolveSlaveBasepath(
  base: string | undefined,
  current: string,
  useStandaloneDefaults: boolean,
): string {
  if (base !== undefined) return normalizeBase(base, "slave base");
  return useStandaloneDefaults ? "/" : current;
}

function createSlaveRuntimeProjectionUpdate(
  current: SlaveRuntimeProjection,
  next: SlaveRuntimeProjection,
  historyOverride?: QiankunHistoryOptions | RouterHistory,
): GeneratedPagesAppRuntimeUpdate | undefined {
  let history: QiankunHistoryOptions | RouterHistory | undefined;
  if (historyOverride) {
    history = historyOverride;
  } else if (!equalHistoryOptions(next.history, current.history)) {
    history = next.history;
  }
  const updateOptions: GeneratedPagesAppRuntimeUpdate = {
    ...(next.basepath !== current.basepath ? { basepath: next.basepath } : {}),
    ...(history ? { history } : {}),
  };
  return Object.keys(updateOptions).length > 0 ? updateOptions : undefined;
}

/**
 * Create a browser-backed history whose TanStack method interception is scoped
 * to the slave instead of replacing the host's global history methods.
 *
 * @internal
 */
export function createQiankunSlaveHistory(
  type: Exclude<QiankunHistoryType, "memory">,
  win: Window = globalThis.window,
): RouterHistory {
  const scopedWindow = createScopedHistoryWindow(win);
  return type === "hash"
    ? createHashHistory({ window: scopedWindow })
    : createBrowserHistory({ window: scopedWindow });
}

function createScopedSlaveHistory(
  type: QiankunHistoryType,
): RouterHistory | undefined {
  if (type === "memory" || typeof globalThis.window === "undefined") {
    return undefined;
  }
  return createQiankunSlaveHistory(type);
}

function shouldRefreshScopedHistory(
  type: QiankunHistoryType,
  history: RouterHistory | undefined,
): boolean {
  if (type === "memory" || typeof globalThis.window === "undefined") {
    return false;
  }
  if (!history) return true;
  return (
    history.location.href !== readWindowHistoryHref(type, globalThis.window)
  );
}

function readWindowHistoryHref(
  type: Exclude<QiankunHistoryType, "memory">,
  win: Window,
): string {
  if (type === "browser") {
    return `${win.location.pathname}${win.location.search}${win.location.hash}`;
  }
  const hashParts = win.location.hash.split("#").slice(1);
  const pathname = hashParts[0] ?? "/";
  const nestedHash =
    hashParts.length > 1 ? `#${hashParts.slice(1).join("#")}` : "";
  return `${pathname}${win.location.search}${nestedHash}`;
}

function createScopedHistoryWindow(win: Window) {
  const history = {
    get length() {
      return win.history.length;
    },
    get state() {
      return win.history.state;
    },
    back() {
      win.history.back();
    },
    forward() {
      win.history.forward();
    },
    go(delta?: number) {
      win.history.go(delta);
    },
    pushState(data: unknown, unused: string, url?: string | URL | null) {
      win.history.pushState(data, unused, url);
    },
    replaceState(data: unknown, unused: string, url?: string | URL | null) {
      win.history.replaceState(data, unused, url);
    },
  };
  return {
    history,
    get location() {
      return win.location;
    },
    addEventListener: win.addEventListener.bind(win),
    removeEventListener: win.removeEventListener.bind(win),
  };
}

function resolveRequiredSlavePagesAppUpdate(
  entryModule: unknown,
): (update: GeneratedPagesAppRuntimeUpdate) => MaybePromise<void> {
  const update = resolvePagesAppUpdate(entryModule);
  if (!update) {
    throw new Error(
      "[evjs:plugin-qiankun] The generated slave entry does not expose pagesApp.updateRuntime() required for base/history projection.",
    );
  }
  return update;
}

function equalHistoryOptions(
  left: QiankunHistoryOptions,
  right: QiankunHistoryOptions,
): boolean {
  if (left.type !== right.type) return false;
  if (left.type !== "memory" || right.type !== "memory") return true;
  if (left.initialIndex !== right.initialIndex) return false;
  const leftEntries = left.initialEntries ?? ["/"];
  const rightEntries = right.initialEntries ?? ["/"];
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every((entry, index) => entry === rightEntries[index])
  );
}

function normalizeSlaveHistory(
  history: QiankunLifecycleProps["history"],
): QiankunHistoryOptions | undefined {
  if (history === undefined) return undefined;
  if (typeof history === "string") {
    assertHistoryType(history, "slave history");
    return { type: history } as QiankunHistoryOptions;
  }
  if (!isRecord(history)) {
    throw new Error(
      "[evjs:plugin-qiankun] Slave history must be a history type or options object.",
    );
  }
  assertHistoryType(history.type, "slave history.type");
  if (history.type === "memory") {
    assertMemoryHistoryOptions(history);
  }
  return history as QiankunHistoryOptions;
}

async function updateGeneratedPagesApp(
  entryModule: unknown,
  update: GeneratedPagesAppRuntimeUpdate,
): Promise<void> {
  const updateRuntime = resolvePagesAppUpdate(entryModule);
  if (!updateRuntime) {
    throw new Error(
      "[evjs:plugin-qiankun] The generated Application entry does not expose pagesApp.updateRuntime().",
    );
  }
  await updateRuntime(update);
}

function resolvePagesAppUpdate(
  entryModule: unknown,
):
  | ((update: GeneratedPagesAppRuntimeUpdate) => MaybePromise<void>)
  | undefined {
  if (!isRecord(entryModule) || !isRecord(entryModule.pagesApp)) {
    return undefined;
  }
  const pagesApp = entryModule.pagesApp;
  if (typeof pagesApp.updateRuntime !== "function") return undefined;
  return (update) =>
    (
      pagesApp.updateRuntime as (
        value: GeneratedPagesAppRuntimeUpdate,
      ) => MaybePromise<void>
    ).call(pagesApp, update);
}

async function prefetchQiankunApps(
  master: NormalizedQiankunMasterOptions,
  phase: "initial" | "after-mount" = "initial",
  mountedAppName?: string,
): Promise<void> {
  const prefetch = master.prefetch;
  if (!prefetch || master.prefetchState.scheduled) return;

  let selected: QiankunApp[];
  if (phase === "initial") {
    if (prefetch !== "all" && !Array.isArray(prefetch)) return;
    selected = Array.isArray(prefetch)
      ? master.apps.filter((app) => prefetch.includes(app.name))
      : master.apps;
  } else {
    if (prefetch !== true) return;
    selected = master.apps
      .filter((app) => app.name !== mountedAppName)
      .slice(0, master.prefetchThreshold);
  }
  if (selected.length === 0) return;
  master.prefetchState.scheduled = true;
  const qiankun = await importQiankun();
  qiankun.prefetchApps?.(
    selected.map(({ name, entry }) => ({ name, entry })),
    master.settings.fetch,
  );
}

async function importQiankun(): Promise<QiankunRuntimeModule> {
  const mod = await import("qiankun");
  return mod as unknown as QiankunRuntimeModule;
}

function isPoweredByQiankun(): boolean {
  return Boolean(
    (globalThis as { __POWERED_BY_QIANKUN__?: unknown }).__POWERED_BY_QIANKUN__,
  );
}

function resolveMountContainer(
  props: QiankunLifecycleProps,
  mount: string,
): Element | undefined {
  const propsContainer = props.container;
  if (isElementLike(propsContainer)) {
    const nested = querySelector(propsContainer, mount);
    return nested ?? propsContainer;
  }
  if (typeof propsContainer === "string") {
    return queryDocument(propsContainer);
  }
  return queryDocument(mount);
}

function queryDocument(selector: string): Element | undefined {
  const doc = globalThis.document;
  if (!doc || typeof doc.querySelector !== "function") return undefined;
  return doc.querySelector(selector) ?? undefined;
}

function querySelector(
  container: Element,
  selector: string,
): Element | undefined {
  if (typeof container.querySelector !== "function") return undefined;
  return container.querySelector(selector) ?? undefined;
}

function clearContainer(container: Element | undefined): void {
  if (container) container.innerHTML = "";
}

async function unmountLoadedEntry(entryModule: unknown): Promise<void> {
  const unmount = resolveEntryUnmount(entryModule);
  await unmount?.();
}

async function collectQiankunCleanupError(
  errors: unknown[],
  cleanup: () => MaybePromise<unknown>,
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    errors.push(error);
  }
}

function throwQiankunMountError(
  error: unknown,
  rollbackErrors: unknown[],
): never {
  if (rollbackErrors.length === 0) throw error;
  throw new AggregateError(
    [error, ...rollbackErrors],
    "[evjs:plugin-qiankun] Slave mount failed and one or more rollback steps also failed.",
  );
}

function throwQiankunCleanupErrors(errors: unknown[]): void {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(
    errors,
    "[evjs:plugin-qiankun] Multiple slave unmount steps failed.",
  );
}

function resolveEntryRender(
  entryModule: unknown,
): ((container: Element | string) => MaybePromise<void>) | undefined {
  if (!isRecord(entryModule)) return undefined;
  for (const candidate of [entryModule.app, entryModule.default, entryModule]) {
    if (isRecord(candidate) && typeof candidate.render === "function") {
      return (container) =>
        (
          candidate.render as (target: Element | string) => MaybePromise<void>
        ).call(candidate, container);
    }
  }
  return undefined;
}

function resolveEntryStart(
  entryModule: unknown,
): ((container: Element | string) => MaybePromise<void>) | undefined {
  if (!isRecord(entryModule) || typeof entryModule.start !== "function") {
    return undefined;
  }
  return (container) =>
    (
      entryModule.start as (target: Element | string) => MaybePromise<void>
    ).call(entryModule, container);
}

function resolveEntryUnmount(
  entryModule: unknown,
): (() => MaybePromise<void>) | undefined {
  if (!isRecord(entryModule)) return undefined;
  for (const candidate of [entryModule.app, entryModule.default, entryModule]) {
    if (isRecord(candidate) && typeof candidate.unmount === "function") {
      return () =>
        (candidate.unmount as () => MaybePromise<void>).call(candidate);
    }
  }
  return undefined;
}

function normalizeBase(value: string, label: string): string {
  assertTrimmedString(value, label);
  if (!value.startsWith("/")) {
    throw new Error(`[evjs:plugin-qiankun] ${label} must start with "/".`);
  }
  return value === "/" ? "/" : value.replace(/\/+$/, "");
}

function assertAbsoluteRoutePath(
  value: unknown,
  label: string,
): asserts value is string {
  assertTrimmedString(value, label);
  if (!value.startsWith("/")) {
    throw new Error(`[evjs:plugin-qiankun] ${label} must start with "/".`);
  }
  if (/\s|[?#]/.test(value)) {
    throw new Error(
      `[evjs:plugin-qiankun] ${label} must not contain whitespace, a query string, or a hash.`,
    );
  }
  if (value.includes("//")) {
    throw new Error(
      `[evjs:plugin-qiankun] ${label} must not contain repeated "/" separators.`,
    );
  }

  const segments = splitPath(value);
  const paramNames = new Set<string>();
  for (const [index, segment] of segments.entries()) {
    if (segment === "*") {
      if (index !== segments.length - 1) {
        throw new Error(
          `[evjs:plugin-qiankun] ${label} wildcard must be the terminal path segment.`,
        );
      }
      continue;
    }
    if (segment.includes("*")) {
      throw new Error(
        `[evjs:plugin-qiankun] ${label} wildcard must be "*" as a complete terminal path segment.`,
      );
    }
    if (segment.startsWith("$")) {
      throw new Error(
        `[evjs:plugin-qiankun] ${label} must use ":param" or "*" syntax instead of evjs "$" route segments.`,
      );
    }
    if (!segment.startsWith(":")) continue;

    const name = segment.slice(1);
    if (!name) {
      throw new Error(
        `[evjs:plugin-qiankun] ${label} contains dynamic segment ":" without a param name.`,
      );
    }
    if (!qiankunRouteParamNamePattern.test(name)) {
      throw new Error(
        `[evjs:plugin-qiankun] ${label} dynamic segment "${segment}" must use ":param" with an identifier-style param name.`,
      );
    }
    if (reservedQiankunRouteParamNames.has(name)) {
      throw new Error(
        `[evjs:plugin-qiankun] ${label} uses reserved dynamic param name "${name}".`,
      );
    }
    if (paramNames.has(name)) {
      throw new Error(
        `[evjs:plugin-qiankun] ${label} uses duplicate dynamic param name "${name}".`,
      );
    }
    paramNames.add(name);
  }
}

function normalizeQiankunRoutePath(path: string): string {
  return path === "/" ? "/" : path.replace(/\/$/, "");
}

function qiankunRuntimeRouteShape(path: string): string {
  return path
    .split("/")
    .map((segment) =>
      segment !== "$" && segment.startsWith("$") ? "$param" : segment,
    )
    .join("/");
}

function assertTrimmedString(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value) {
    throw new Error(
      `[evjs:plugin-qiankun] Master resolver ${label} must be a non-empty trimmed string.`,
    );
  }
}

function assertOptionalRecord(value: unknown, label: string): void {
  if (value !== undefined && !isRecord(value)) {
    throw new Error(
      `[evjs:plugin-qiankun] Master resolver ${label} must be an object.`,
    );
  }
}

function assertNoUnknownFields(
  value: object,
  allowedFields: readonly string[],
  label: string,
): void {
  const unknownField = Object.keys(value).find(
    (field) => !allowedFields.includes(field),
  );
  if (unknownField === undefined) return;
  throw new Error(
    `[evjs:plugin-qiankun] Master resolver ${label} contains unknown field "${unknownField}".`,
  );
}

function assertLifeCycles(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new Error(
      `[evjs:plugin-qiankun] Master resolver ${label} must be an object.`,
    );
  }
  assertNoUnknownFields(value, qiankunLifecycleNames, label);
  for (const name of qiankunLifecycleNames) {
    const lifecycle = value[name];
    if (lifecycle === undefined || typeof lifecycle === "function") continue;
    if (
      Array.isArray(lifecycle) &&
      lifecycle.every((candidate) => typeof candidate === "function")
    ) {
      continue;
    }
    throw new Error(
      `[evjs:plugin-qiankun] Master resolver ${label}.${name} must be a function or an array of functions.`,
    );
  }
}

function assertPrefetch(value: unknown): void {
  if (value === undefined || typeof value === "boolean" || value === "all") {
    return;
  }
  if (
    Array.isArray(value) &&
    value.every(
      (name) =>
        typeof name === "string" && name.trim() === name && name.length > 0,
    )
  ) {
    return;
  }
  throw new Error(
    '[evjs:plugin-qiankun] Master resolver prefetch must be a boolean, "all", or an array of app names.',
  );
}

function assertMemoryHistoryOptions(history: Record<string, unknown>): void {
  if (
    history.initialEntries !== undefined &&
    (!Array.isArray(history.initialEntries) ||
      history.initialEntries.length === 0 ||
      history.initialEntries.some(
        (entry) => typeof entry !== "string" || !entry.trim(),
      ))
  ) {
    throw new Error(
      "[evjs:plugin-qiankun] Slave memory history initialEntries must be a non-empty array of non-empty strings.",
    );
  }
  if (
    history.initialIndex !== undefined &&
    (typeof history.initialIndex !== "number" ||
      !Number.isInteger(history.initialIndex) ||
      history.initialIndex < 0)
  ) {
    throw new Error(
      "[evjs:plugin-qiankun] Slave memory history initialIndex must be a non-negative integer.",
    );
  }
}

function assertHistoryType(
  value: unknown,
  label: string,
): asserts value is QiankunHistoryType {
  if (value !== "browser" && value !== "hash" && value !== "memory") {
    throw new Error(
      `[evjs:plugin-qiankun] ${label} must be "browser", "hash", or "memory".`,
    );
  }
}

function splitPath(value: string): string[] {
  return value.split("/").filter(Boolean);
}

function sanitizeRouteId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_") || "app";
}

function reportError(error: unknown): void {
  const runtime = globalThis as typeof globalThis & {
    reportError?: (error: unknown) => void;
  };
  if (typeof runtime.reportError === "function") {
    runtime.reportError(error);
  } else {
    setTimeout(() => {
      throw error;
    }, 0);
  }
}

function isElementLike(value: unknown): value is Element {
  return Boolean(
    value &&
      typeof value === "object" &&
      "innerHTML" in value &&
      "querySelector" in value,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
