import { useLocation } from "@evjs/ev/navigation";
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
  unmount?: QiankunSlaveLifecycle;
  update?: QiankunSlaveLifecycle;
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
  history?: QiankunHistoryOptions;
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
  let hasMountedEntry = false;
  let entryMounted = false;
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
    loadedEntry ??= options.loadEntry();
    loadedEntryModule = await loadedEntry;
    return loadedEntryModule;
  }

  async function bootstrap(props: QiankunLifecycleProps = {}): Promise<void> {
    currentContainer = resolveMountContainer(props, options.mount);
    await runtime.bootstrap?.(props, ctx());
  }

  async function mount(props: QiankunLifecycleProps = {}): Promise<void> {
    if (entryMounted) return;
    currentContainer = resolveMountContainer(props, options.mount);
    const context = ctx();
    const restoreDocumentLookup = scopeDocumentMountLookup(
      currentContainer,
      options.mount,
    );
    try {
      await runtime.mount?.(props, context);
      const entryModule = await context.loadEntry();
      runtimeProjection = await configureSlaveEntry(
        entryModule,
        props,
        runtimeProjection,
      );
      const start = hasMountedEntry
        ? undefined
        : resolveEntryStart(entryModule);
      if (start) {
        await start(currentContainer ?? options.mount);
      } else {
        await mountLoadedEntry(entryModule, currentContainer, options.mount);
      }
      hasMountedEntry = true;
      entryMounted = true;
    } finally {
      restoreDocumentLookup();
    }
  }

  async function unmount(props: QiankunLifecycleProps = {}): Promise<void> {
    const context = ctx();
    const errors: unknown[] = [];
    try {
      await runtime.unmount?.(props, context);
    } catch (error) {
      errors.push(error);
    }
    try {
      await unmountLoadedEntry(loadedEntryModule);
    } catch (error) {
      errors.push(error);
    }
    try {
      clearContainer(currentContainer);
    } catch (error) {
      errors.push(error);
    }
    currentContainer = undefined;
    entryMounted = false;
    throwQiankunCleanupErrors(errors);
  }

  async function update(props: QiankunLifecycleProps = {}): Promise<void> {
    await runtime.update?.(props, ctx());
    if (!entryMounted || !loadedEntryModule) return;
    runtimeProjection = await configureSlaveEntry(
      loadedEntryModule,
      props,
      runtimeProjection,
      false,
    );
  }

  return {
    bootstrap,
    mount,
    unmount,
    update,
    standalone: () => mount({}),
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
  routes.forEach((route, index) => {
    if (!isRecord(route)) {
      throw new Error(
        `[evjs:plugin-qiankun] Master resolver routes[${index}] must be an object.`,
      );
    }
    assertAbsoluteRoutePath(route.path, `routes[${index}].path`);
    if (routePaths.has(route.path)) {
      throw new Error(
        `[evjs:plugin-qiankun] Master resolver contains duplicate route path "${route.path}".`,
      );
    }
    routePaths.add(route.path);

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
    const latestBaseRef = useRef<string | undefined>(undefined);
    const updateQueueRef = useRef(Promise.resolve());
    const [error, setError] = useState<unknown>();
    const routePathname = useLocation({
      select: (location) => location.pathname,
    });
    const base = resolveQiankunSlaveBase(master.base, route, routePathname);
    latestBaseRef.current = base;

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
      if (!microApp?.update || mountedBaseRef.current === base) {
        return;
      }

      const update = updateQueueRef.current.then(async () => {
        await microApp.mountPromise;
        if (microAppRef.current !== microApp) return;
        const nextBase = latestBaseRef.current ?? base;
        if (mountedBaseRef.current === nextBase) return;
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
      });
      updateQueueRef.current = update.catch(() => {});
      void update.catch((updateError) => {
        if (microAppRef.current === microApp) setError(updateError);
      });
    }, [base]);

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
  let normalized = path === "/" ? "/" : path.replace(/\/+$/, "");
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

async function configureSlaveEntry(
  entryModule: unknown,
  props: QiankunLifecycleProps,
  current: SlaveRuntimeProjection,
  useStandaloneDefaults = true,
): Promise<SlaveRuntimeProjection> {
  const next: SlaveRuntimeProjection = {
    basepath:
      props.base === undefined
        ? useStandaloneDefaults
          ? "/"
          : current.basepath
        : normalizeBase(props.base, "slave base"),
    history:
      normalizeSlaveHistory(props.history) ??
      (useStandaloneDefaults ? { type: "browser" } : current.history),
  };
  const updateOptions: GeneratedPagesAppRuntimeUpdate = {
    ...(next.basepath !== current.basepath ? { basepath: next.basepath } : {}),
    ...(!equalHistoryOptions(next.history, current.history)
      ? { history: next.history }
      : {}),
  };
  if (Object.keys(updateOptions).length === 0) return next;

  const update = resolvePagesAppUpdate(entryModule);
  if (!update) {
    throw new Error(
      "[evjs:plugin-qiankun] The generated slave entry does not expose pagesApp.updateRuntime() required for base/history projection.",
    );
  }
  await update(updateOptions);
  return next;
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

function throwQiankunCleanupErrors(errors: unknown[]): void {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(
    errors,
    "[evjs:plugin-qiankun] Multiple slave unmount steps failed.",
  );
}

async function mountLoadedEntry(
  entryModule: unknown,
  container: Element | undefined,
  mount: string,
): Promise<void> {
  const render = resolveEntryRender(entryModule);
  if (!render) {
    throw new Error(
      "[evjs:plugin-qiankun] The generated slave entry does not expose an app.render() method required for mounting.",
    );
  }
  await render(container ?? mount);
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

function scopeDocumentMountLookup(
  container: Element | undefined,
  mount: string,
): () => void {
  const doc = globalThis.document;
  if (!container || !doc) return () => {};

  const originalQuerySelector = doc.querySelector;
  const originalGetElementById = doc.getElementById;
  const mountId = mount.startsWith("#") ? mount.slice(1) : undefined;

  if (typeof originalQuerySelector === "function") {
    doc.querySelector = function scopedQuerySelector(
      selector: string,
    ): Element | null {
      if (selector === mount) {
        return querySelector(container, mount) ?? container;
      }
      return originalQuerySelector.call(this, selector);
    };
  }

  if (mountId && typeof originalGetElementById === "function") {
    doc.getElementById = function scopedGetElementById(
      id: string,
    ): HTMLElement | null {
      if (id === mountId) {
        const nested = querySelector(container, mount);
        return (nested ?? container) as HTMLElement;
      }
      return originalGetElementById.call(this, id);
    };
  }

  return () => {
    doc.querySelector = originalQuerySelector;
    doc.getElementById = originalGetElementById;
  };
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
  const segments = splitPath(value);
  const wildcardIndex = segments.findIndex(
    (segment) => segment === "*" || segment === "$",
  );
  if (wildcardIndex >= 0 && wildcardIndex !== segments.length - 1) {
    throw new Error(
      `[evjs:plugin-qiankun] ${label} wildcard must be the terminal path segment.`,
    );
  }
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
    (!Number.isInteger(history.initialIndex) ||
      (history.initialIndex as number) < 0)
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
