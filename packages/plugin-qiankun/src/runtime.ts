type MaybePromise<T> = T | Promise<T>;

export interface QiankunApp {
  name: string;
  entry: string;
  activeRule?: string | string[] | ((location: Location) => boolean);
  container?: Element | string;
  props?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface QiankunMicroAppRoute {
  path: string;
  microApp: string;
  [key: string]: unknown;
}

export interface QiankunMasterOptions {
  apps?: QiankunApp[];
  routes?: QiankunMicroAppRoute[];
  appNameKeyAlias?: string;
  prefetch?: boolean | string[] | ((apps: QiankunApp[]) => unknown);
  sandbox?: boolean | Record<string, unknown>;
  singular?: boolean | ((app: QiankunApp) => Promise<boolean>);
  fetch?: typeof globalThis.fetch;
  excludeAssetFilter?: (assetUrl: string) => boolean;
  getPublicPath?: (entry: string) => string;
  getTemplate?: (template: string) => string;
  [key: string]: unknown;
}

export type QiankunMasterResolver = () => MaybePromise<QiankunMasterOptions>;

export interface QiankunLifecycleProps {
  container?: Element | string | null;
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

export async function startQiankunMaster(
  resolver: QiankunMasterResolver,
): Promise<QiankunMasterOptions> {
  const masterOptions = await resolver();
  const {
    apps = [],
    routes = [],
    appNameKeyAlias,
    ...frameworkOptions
  } = masterOptions;
  const qiankun = await importQiankun();
  const registeredApps = normalizeRegisteredApps(
    applyRouteActiveRules(apps, routes, appNameKeyAlias),
  );

  if (registeredApps.length > 0) {
    qiankun.registerMicroApps(registeredApps);
  }
  qiankun.start(frameworkOptions);
  return masterOptions;
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
    await runtime.bootstrap?.(props, ctx());
  }

  async function mount(props: QiankunLifecycleProps = {}): Promise<void> {
    currentContainer = resolveMountContainer(props, options.mount);
    const context = ctx();
    await runtime.mount?.(props, context);
    const restoreDocumentLookup = scopeDocumentMountLookup(
      currentContainer,
      options.mount,
    );
    try {
      await context.loadEntry();
    } finally {
      restoreDocumentLookup();
    }
  }

  async function unmount(props: QiankunLifecycleProps = {}): Promise<void> {
    const context = ctx();
    await runtime.unmount?.(props, context);
    await unmountLoadedEntry(loadedEntryModule);
    clearContainer(currentContainer);
    currentContainer = undefined;
  }

  async function update(props: QiankunLifecycleProps = {}): Promise<void> {
    await runtime.update?.(props, ctx());
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

interface QiankunRuntimeModule {
  registerMicroApps(apps: QiankunRegisteredApp[]): void;
  start(options: Record<string, unknown>): void;
}

interface QiankunRegisteredApp extends Omit<QiankunApp, "container"> {
  container: Element;
}

async function importQiankun(): Promise<QiankunRuntimeModule> {
  const mod = await import("qiankun");
  return mod as QiankunRuntimeModule;
}

function applyRouteActiveRules(
  apps: QiankunApp[],
  routes: QiankunMicroAppRoute[],
  appNameKeyAlias: string | undefined,
): QiankunApp[] {
  if (routes.length === 0) return apps;

  return apps.map((app) => {
    if (app.activeRule !== undefined) return app;
    const routePaths = routes
      .filter((route) => matchesRouteApp(app, route, appNameKeyAlias))
      .map((route) => route.path);
    if (routePaths.length === 0) return app;
    return {
      ...app,
      activeRule: routePaths.length === 1 ? routePaths[0] : routePaths,
    };
  });
}

function matchesRouteApp(
  app: QiankunApp,
  route: QiankunMicroAppRoute,
  appNameKeyAlias: string | undefined,
): boolean {
  if (route.microApp === app.name) return true;
  if (!appNameKeyAlias) return false;
  return route.microApp === app[appNameKeyAlias];
}

function normalizeRegisteredApps(apps: QiankunApp[]): QiankunRegisteredApp[] {
  return apps.map((app) => ({
    ...app,
    container: resolveAppContainer(app),
  }));
}

function resolveAppContainer(app: QiankunApp): Element {
  const container = app.container;
  if (isElementLike(container)) return container;

  if (typeof container === "string") {
    const resolved = queryDocument(container);
    if (resolved) return resolved;
    throw new Error(
      `[evjs:plugin-qiankun] qiankun master app "${app.name}" container "${container}" was not found. Keep the container mounted by the master shell before qiankun starts.`,
    );
  }

  throw new Error(
    `[evjs:plugin-qiankun] qiankun master app "${app.name}" requires a container element or selector.`,
  );
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
  if (container) {
    container.innerHTML = "";
  }
}

async function unmountLoadedEntry(entryModule: unknown): Promise<void> {
  const unmount = resolveEntryUnmount(entryModule);
  await unmount?.();
}

function resolveEntryUnmount(
  entryModule: unknown,
): (() => MaybePromise<void>) | undefined {
  if (!isRecord(entryModule)) return undefined;
  for (const candidate of [entryModule.app, entryModule.default, entryModule]) {
    if (isRecord(candidate) && typeof candidate.unmount === "function") {
      return candidate.unmount as () => MaybePromise<void>;
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
