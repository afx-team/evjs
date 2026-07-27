import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ContributionContext,
  FrameworkIRView,
  GeneratedModuleRef,
  HtmlDocument,
  Plugin,
  PluginRouteExtensionContext,
} from "@evjs/ev/plugin";
import type { QiankunMicroAppRoute } from "./runtime.js";

export interface QiankunModuleRefObject {
  module: string | GeneratedModuleRef;
  exportName?: string;
}

export type QiankunModuleRef =
  | string
  | GeneratedModuleRef
  | QiankunModuleRefObject;

export interface QiankunMasterPluginOptions {
  resolver: QiankunModuleRef;
  externalQiankun?: boolean;
}

export interface QiankunRouteExtension {
  microApp: string;
}

export interface QiankunSlavePluginOptions {
  runtime?: QiankunModuleRef;
  name?: string;
  externalQiankun?: boolean;
}

/**
 * State returned by the composable qiankun contribution helpers.
 *
 * Pass this value to the slave bundler and HTML helpers so they use the same
 * application name selected while generating the entry wrapper.
 */
export interface QiankunContributionState {
  readonly role: "master" | "slave";
  readonly appName?: string;
}

interface ResolvedExternalModuleRef {
  raw: string;
  absolutePath?: string;
  importSpecifier: string;
  exportName: string;
  kind: "file" | "package";
}

interface ResolvedGeneratedModuleRef {
  raw: string;
  ref: GeneratedModuleRef;
  exportName: string;
  kind: "generated";
}

type ResolvedModuleRef = ResolvedExternalModuleRef | ResolvedGeneratedModuleRef;

interface ResolvedAppEntry {
  kind: "application";
  mount: string;
}

interface EntryWrapperState extends QiankunContributionState {
  entry: ResolvedAppEntry;
  qiankunRuntime: string;
  moduleRef?: ResolvedModuleRef;
  routeMappings?: QiankunMicroAppRoute[];
}

interface GeneratedSourceHelpers {
  importOf(ref: GeneratedModuleRef): string;
  importFile(file: string): string;
}

const masterPluginName = "@evjs/plugin-qiankun:master";
const slavePluginName = "@evjs/plugin-qiankun:slave";
const qiankunRuntime = resolveQiankunRuntimeModulePath();
const qiankunRuntimeImport = "@evjs/plugin-qiankun/runtime";
const qiankunLifecycleProxyId = "__EVJS_QIANKUN_LIFECYCLE_PROXY__";
export const QIANKUN_ROUTE_EXTENSION_NAMESPACE = "@evjs/qiankun";

/**
 * Add the qiankun master entry contribution to an existing plugin.
 *
 * This is the composable form of {@link evPluginQiankunMaster}.
 */
export async function contributeQiankunMaster(
  ctx: ContributionContext,
  options: QiankunMasterPluginOptions,
): Promise<QiankunContributionState> {
  const state = await createMasterState(ctx, options);
  addEntryWrapperWatchFiles(ctx.addWatchFile, state);
  await validateEntryWrapperState(state);
  if (options.externalQiankun) {
    addQiankunExternalContribution(ctx);
  }
  const wrapper = ctx.emit.module({
    id: "entry-wrapper",
    scope: { kind: "application" },
    source: (helpers) => createMasterEntryWrapperSource(state, helpers),
  });
  ctx.slot("client.entry").add({
    id: "entry-wrapper-slot",
    module: wrapper,
    position: "after-main",
    target: { kind: "application" },
  });
  return { role: state.role };
}

/**
 * Add the qiankun slave replacement entry to an existing plugin.
 *
 * This is the composable form of {@link evPluginQiankunSlave}.
 */
export async function contributeQiankunSlave(
  ctx: ContributionContext,
  options: QiankunSlavePluginOptions = {},
): Promise<QiankunContributionState> {
  const state = await createSlaveState(ctx, options);
  addEntryWrapperWatchFiles(ctx.addWatchFile, state);
  await validateEntryWrapperState(state);
  if (options.externalQiankun) {
    addQiankunExternalContribution(ctx);
  }
  const originalEntry = emitOriginalEntryModule(ctx);
  const wrapper = ctx.emit.module({
    id: "entry-wrapper",
    scope: { kind: "application" },
    source: ({ importFile, importOf }) =>
      createSlaveEntryWrapperSource(
        state,
        { importFile, importOf },
        importOf(originalEntry),
      ),
  });
  ctx.slot("client.entry").add({
    id: "entry-wrapper-slot",
    module: wrapper,
    position: "before-main",
    mode: "replace",
    target: { kind: "application" },
  });
  return { role: state.role, appName: state.appName };
}

export function evPluginQiankunMaster(
  options: QiankunMasterPluginOptions,
): Plugin {
  return {
    name: masterPluginName,
    enforce: "pre",
    describe(api) {
      api.routeExtension<QiankunRouteExtension, QiankunRouteExtension>({
        namespace: QIANKUN_ROUTE_EXTENSION_NAMESPACE,
        validate: validateQiankunRouteExtension,
      });
    },
    async contributions(ctx) {
      await contributeQiankunMaster(ctx, options);
    },
    setup() {
      return {
        bundlerConfig(_config, bundlerCtx) {
          assertSupportedBundler(bundlerCtx.bundlerName);
        },
      };
    },
  };
}

export function evPluginQiankunSlave(
  options: QiankunSlavePluginOptions = {},
): Plugin {
  let state: QiankunContributionState | undefined;

  return {
    name: slavePluginName,
    enforce: "pre",
    async contributions(ctx) {
      state = await contributeQiankunSlave(ctx, options);
    },
    setup() {
      return {
        bundlerConfig(config, bundlerCtx) {
          applyQiankunSlaveBundlerConfig(config, bundlerCtx.bundlerName, state);
        },
        transformHtml(doc) {
          applyQiankunSlaveHtmlTransform(doc, state);
        },
      };
    },
  };
}

function resolveSingleAppEntry(
  framework: FrameworkIRView,
  role: "master" | "slave",
): ResolvedAppEntry {
  if (framework.applications.length !== 1) {
    throw new Error(
      `[evjs:plugin-qiankun] ${role} mode requires exactly one normalized SPA Application, but found ${framework.applications.length}.`,
    );
  }
  const application = framework.applications[0];
  if (!application || application.routingMode !== "spa") {
    throw new Error(
      `[evjs:plugin-qiankun] ${role} mode only supports a normalized SPA Application.`,
    );
  }
  const applicationEntry = framework.getApplicationEntry(application.id);
  if (applicationEntry) {
    return {
      kind: "application",
      mount: applicationEntry.metadata.mount,
    };
  }
  throw new Error(
    `[evjs:plugin-qiankun] ${role} mode requires a generated client entry for normalized SPA Application "${application.id}".`,
  );
}

function resolveModuleRef(
  cwd: string,
  ref: QiankunModuleRef,
): ResolvedModuleRef {
  const normalized = normalizeModuleRef(ref);
  if (typeof normalized.module !== "string") {
    return {
      raw: "generated module",
      ref: normalized.module,
      exportName: normalized.exportName,
      kind: "generated",
    };
  }
  const raw = normalized.module;
  return {
    raw,
    exportName: normalized.exportName,
    ...resolveModuleSpecifier(cwd, raw),
  };
}

function normalizeModuleRef(ref: QiankunModuleRef): {
  module: string | GeneratedModuleRef;
  exportName: string;
} {
  if (typeof ref === "string") {
    return { module: ref, exportName: "default" };
  }
  if (isQiankunModuleRefObject(ref)) {
    return {
      module: ref.module,
      exportName: ref.exportName ?? "default",
    };
  }
  return { module: ref, exportName: "default" };
}

function isQiankunModuleRefObject(
  ref: GeneratedModuleRef | QiankunModuleRefObject,
): ref is QiankunModuleRefObject {
  return Object.hasOwn(ref, "module");
}

function resolveModuleSpecifier(
  cwd: string,
  specifier: string,
): Pick<
  ResolvedExternalModuleRef,
  "absolutePath" | "importSpecifier" | "kind"
> {
  if (isPathSpecifier(specifier)) {
    const absolutePath = resolveModulePath(cwd, specifier);
    return {
      absolutePath,
      importSpecifier: toImportPath(absolutePath),
      kind: "file",
    };
  }

  const projectRequire = createRequire(path.join(cwd, "package.json"));
  try {
    const absolutePath = projectRequire.resolve(specifier);
    return { absolutePath, importSpecifier: specifier, kind: "package" };
  } catch (error) {
    throw new Error(
      `[evjs:plugin-qiankun] Failed to resolve module "${specifier}" from ${cwd}.${formatErrorDetail(error)}`,
    );
  }
}

function resolveModulePath(cwd: string, specifier: string): string {
  return path.isAbsolute(specifier) ? specifier : path.resolve(cwd, specifier);
}

async function createMasterState(
  ctx: ContributionContext,
  options: QiankunMasterPluginOptions,
): Promise<EntryWrapperState> {
  const entry = resolveSingleAppEntry(ctx.framework, "master");
  const resolver = resolveModuleRef(ctx.cwd, options.resolver);
  return {
    role: "master",
    entry,
    qiankunRuntime,
    moduleRef: resolver,
    routeMappings: collectQiankunRouteMappings(ctx.framework),
  };
}

async function createSlaveState(
  ctx: ContributionContext,
  options: QiankunSlavePluginOptions,
): Promise<EntryWrapperState> {
  const entry = resolveSingleAppEntry(ctx.framework, "slave");
  const runtime = options.runtime
    ? resolveModuleRef(ctx.cwd, options.runtime)
    : undefined;
  const appName = options.name ?? (await readPackageName(ctx.cwd));
  return {
    role: "slave",
    entry,
    qiankunRuntime,
    moduleRef: runtime,
    appName,
  };
}

function addQiankunExternalContribution(ctx: ContributionContext): void {
  ctx.slot("resolve.external").add({
    id: "qiankun-external",
    specifier: "qiankun",
    source: "qiankun",
    runtime: "client",
  });
}

function createMasterEntryWrapperSource(
  state: EntryWrapperState,
  helpers: GeneratedSourceHelpers,
): string {
  const resolver = state.moduleRef;
  if (!resolver) {
    throw new Error(
      "[evjs:plugin-qiankun] master resolver was not initialized.",
    );
  }
  return [
    `import { type QiankunMasterResolver, resolveQiankunModuleExport, startQiankunMaster } from ${JSON.stringify(qiankunRuntimeImport)};`,
    `import * as masterResolverModule from ${JSON.stringify(toModuleImport(resolver, helpers))};`,
    "",
    "const masterResolver = resolveQiankunModuleExport<QiankunMasterResolver>(",
    "  masterResolverModule,",
    `  ${JSON.stringify(resolver.exportName)},`,
    `  "qiankun master resolver",`,
    ");",
    `const routeMappings = ${JSON.stringify(state.routeMappings ?? [])};`,
    "",
    "void startQiankunMaster(masterResolver, routeMappings);",
  ].join("\n");
}

function validateQiankunRouteExtension(
  value: Readonly<QiankunRouteExtension>,
  context: PluginRouteExtensionContext,
): true | string {
  if (!isRecord(value)) {
    return "expected an object with exactly one microApp field";
  }
  const unknownField = Object.keys(value).find((key) => key !== "microApp");
  if (unknownField) {
    return `unknown field "${unknownField}"; expected only microApp`;
  }
  if (typeof value.microApp !== "string" || !value.microApp.trim()) {
    return "microApp must be a non-empty string";
  }
  if (context.target.kind !== "page") {
    return "qiankun route mapping must target a Page Route";
  }
  if (context.pattern.segments.some((segment) => segment.kind !== "static")) {
    return "qiankun route mapping requires a static Route pattern";
  }
  return true;
}

function collectQiankunRouteMappings(
  framework: FrameworkIRView,
): QiankunMicroAppRoute[] {
  const mappings = new Map<string, QiankunMicroAppRoute>();
  for (const route of framework.routes) {
    const value = route.extensions[QIANKUN_ROUTE_EXTENSION_NAMESPACE];
    if (value === undefined) continue;
    const validation = validateQiankunRouteExtension(
      value as QiankunRouteExtension,
      {
        routeId: route.id,
        applicationId: route.applicationId,
        ...(route.parentId ? { parentId: route.parentId } : {}),
        pattern: route.pattern,
        target: route.target,
        facets: route.facets,
        ...(route.provenance.source ? { source: route.provenance.source } : {}),
      },
    );
    if (validation !== true) {
      throw new Error(
        `[evjs:plugin-qiankun] Route "${route.id}" extension "${QIANKUN_ROUTE_EXTENSION_NAMESPACE}" is invalid: ${validation}.`,
      );
    }
    const path = formatStaticRoutePattern(route.pattern);
    const microApp = (value as QiankunRouteExtension).microApp.trim();
    const previous = mappings.get(path);
    if (previous && previous.microApp !== microApp) {
      throw new Error(
        `[evjs:plugin-qiankun] Static Route "${path}" maps to both micro-app "${previous.microApp}" and "${microApp}".`,
      );
    }
    mappings.set(path, { path, microApp });
  }
  return [...mappings.values()];
}

function formatStaticRoutePattern(
  pattern: FrameworkIRView["routes"][number]["pattern"],
): string {
  if (pattern.segments.length === 0) return "/";
  return `/${pattern.segments
    .map((segment) => {
      if (segment.kind !== "static") {
        throw new Error(
          "[evjs:plugin-qiankun] qiankun route mapping requires a static Route pattern.",
        );
      }
      return segment.value;
    })
    .join("/")}`;
}

function emitOriginalEntryModule(ctx: ContributionContext): GeneratedModuleRef {
  const entry = ctx.framework.getApplicationEntry();
  if (!entry) {
    throw new Error(
      "[evjs:plugin-qiankun] Failed to find generated SPA routing entry metadata.",
    );
  }
  return ctx.emit.entryFacade({
    id: "original-entry",
    entry,
    autoStart: false,
  });
}

function createSlaveEntryWrapperSource(
  state: EntryWrapperState,
  helpers: GeneratedSourceHelpers,
  originalEntry: string,
): string {
  const runtime = state.moduleRef;
  const runtimeImport = runtime
    ? `import * as slaveRuntimeModule from ${JSON.stringify(toModuleImport(runtime, helpers))};`
    : "";
  const runtimeValue = runtime
    ? [
        "const slaveRuntime = resolveQiankunModuleExport<QiankunSlaveRuntime>(",
        "  slaveRuntimeModule,",
        `  ${JSON.stringify(runtime.exportName)},`,
        `  "qiankun slave runtime",`,
        ");",
      ].join("\n")
    : "const slaveRuntime = {};";

  return [
    runtimeImport,
    `import { type QiankunSlaveRuntime, createQiankunSlaveLifecycles, resolveQiankunModuleExport } from ${JSON.stringify(qiankunRuntimeImport)};`,
    "",
    runtimeValue,
    "",
    "const qiankunSlave = createQiankunSlaveLifecycles({",
    `  name: ${JSON.stringify(state.appName ?? "evjs-qiankun-slave")},`,
    `  mount: ${JSON.stringify(state.entry.mount)},`,
    "  runtime: slaveRuntime,",
    `  loadEntry: () => import(${JSON.stringify(originalEntry)}),`,
    "});",
    "",
    "export const bootstrap = qiankunSlave.bootstrap;",
    "export const mount = qiankunSlave.mount;",
    "export const unmount = qiankunSlave.unmount;",
    "export const update = qiankunSlave.update;",
    "",
    "const qiankunLifecycles = { bootstrap, mount, unmount, update };",
    'if (typeof window !== "undefined") {',
    `  (window as unknown as Record<string, unknown>)[${JSON.stringify(state.appName ?? "evjs-qiankun-slave")}] = qiankunLifecycles;`,
    "}",
    "",
    "if (!qiankunSlave.isPoweredByQiankun()) {",
    "  void qiankunSlave.standalone();",
    "}",
  ]
    .filter(Boolean)
    .join("\n");
}

function toModuleImport(
  moduleRef: ResolvedModuleRef,
  helpers: GeneratedSourceHelpers,
): string {
  if (moduleRef.kind === "generated") {
    return helpers.importOf(moduleRef.ref);
  }
  if (moduleRef.kind === "package") return moduleRef.importSpecifier;
  if (!moduleRef.absolutePath) return moduleRef.importSpecifier;
  return helpers.importFile(moduleRef.absolutePath);
}

function assertSupportedBundler(bundlerName: string): void {
  if (bundlerName === "webpack" || bundlerName === "utoopack") return;
  throw new Error(
    `[evjs:plugin-qiankun] Unsupported bundler "${bundlerName}". qiankun currently supports webpack and utoopack.`,
  );
}

/**
 * Apply qiankun slave bundler requirements using contribution state.
 */
export function applyQiankunSlaveBundlerConfig(
  config: unknown,
  bundlerName: string,
  state: QiankunContributionState | undefined,
): void {
  assertSupportedBundler(bundlerName);
  if (!state) {
    throw new Error(
      "[evjs:plugin-qiankun] qiankun entry wrapper was not initialized. The contributions hook must run before bundlerConfig.",
    );
  }
  assertSlaveContributionState(state);
  if (bundlerName === "webpack") {
    applyWebpackSlaveLibraryToConfig(config, state);
  }
}

function applyWebpackSlaveLibraryToConfig(
  config: unknown,
  state: QiankunContributionState,
): void {
  const configs = Array.isArray(config) ? config : [config];
  for (const webpackConfig of configs) {
    if (!isRecord(webpackConfig)) continue;
    if (webpackConfig.target === "node") continue;
    applyWebpackSlaveLibrary(webpackConfig, state);
  }
}

function applyWebpackSlaveLibrary(
  config: Record<string, unknown>,
  state: QiankunContributionState,
): void {
  const libraryName = state.appName ?? "evjs-qiankun-slave";
  const library = { name: libraryName, type: "umd" };
  const entry = config.entry;
  if (!isRecord(entry)) {
    config.output = {
      ...asRecord(config.output),
      library,
    };
    return;
  }

  for (const [name, value] of Object.entries(entry)) {
    if (isRecord(value)) {
      value.library = library;
      continue;
    }
    if (typeof value === "string") {
      entry[name] = { import: value, library };
    }
  }
}

function addEntryWrapperWatchFiles(
  addWatchFile: (file: string) => void,
  state: EntryWrapperState,
): void {
  const moduleRef = state.moduleRef;
  if (moduleRef?.kind !== "generated" && moduleRef?.absolutePath) {
    addWatchFile(moduleRef.absolutePath);
  }
  addWatchFile(state.qiankunRuntime);
}

async function validateEntryWrapperState(
  state: EntryWrapperState | undefined,
): Promise<void> {
  if (!state) {
    throw new Error(
      "[evjs:plugin-qiankun] qiankun entry wrapper was not initialized. The plugin setup hook must run before buildStart.",
    );
  }

  await assertFileExists(state.role, "qiankun runtime", state.qiankunRuntime);
  const moduleRef = state.moduleRef;
  if (moduleRef?.kind !== "generated" && moduleRef?.absolutePath) {
    await assertFileExists(
      state.role,
      `module "${moduleRef.raw}"`,
      moduleRef.absolutePath,
    );
  }
}

async function assertFileExists(
  role: "master" | "slave",
  label: string,
  file: string,
): Promise<void> {
  try {
    await fs.access(file);
  } catch {
    throw new Error(
      `[evjs:plugin-qiankun] ${role} ${label} file was not found: ${file}`,
    );
  }
}

/**
 * Rewrite qiankun slave HTML and install the lifecycle proxy.
 *
 * Pass the state returned by {@link contributeQiankunSlave} when a custom
 * application name is used. Omitting it preserves the default slave name.
 */
export function applyQiankunSlaveHtmlTransform(
  doc: HtmlDocument,
  state?: QiankunContributionState,
): void {
  if (state) assertSlaveContributionState(state);
  for (const link of doc.getElementsByTagName("link")) {
    if (link.getAttribute("rel") === "stylesheet") {
      rewriteRootRelativeAttribute(link, "href");
    }
  }

  const scripts = doc
    .getElementsByTagName("script")
    .filter((script) => script.hasAttribute("src"));
  for (const script of scripts) {
    rewriteRootRelativeAttribute(script, "src");
  }

  const entryScript =
    scripts.find((script) => script.hasAttribute("entry")) ?? scripts.at(-1);
  if (!entryScript) return;

  entryScript.setAttribute("entry", "");
  if (doc.getElementById(qiankunLifecycleProxyId)) return;

  const proxyScript = doc.createElement("script");
  proxyScript.id = qiankunLifecycleProxyId;
  proxyScript.textContent = createQiankunLifecycleProxyScript(
    state?.appName ?? "evjs-qiankun-slave",
  );
  entryScript.before(proxyScript);
}

function assertSlaveContributionState(state: QiankunContributionState): void {
  if (state.role === "slave") return;
  throw new Error(
    "[evjs:plugin-qiankun] Expected qiankun slave contribution state.",
  );
}

function createQiankunLifecycleProxyScript(appName: string): string {
  return `(function() {
  var appName = ${JSON.stringify(appName)};
  var lifecycleNames = ["bootstrap", "mount", "unmount", "update"];
  var global = window;
  var existed = global[appName];
  if (existed && typeof existed.bootstrap === "function" && typeof existed.mount === "function" && typeof existed.unmount === "function") return;
  var resolveReady;
  var ready = new Promise(function(resolve) { resolveReady = resolve; });
  var proxy = {};
  lifecycleNames.forEach(function(name) {
    proxy[name] = function() {
      var context = this;
      var args = arguments;
      return ready.then(function(lifecycles) {
        var lifecycle = lifecycles && lifecycles[name];
        if (typeof lifecycle !== "function") {
          if (name === "update") return undefined;
          throw new Error("[evjs:plugin-qiankun] lifecycle " + name + " is not available for " + appName + ".");
        }
        return lifecycle.apply(context, args);
      });
    };
  });
  Object.defineProperty(global, appName, {
    configurable: true,
    enumerable: true,
    get: function() { return proxy; },
    set: function(lifecycles) {
      Object.defineProperty(global, appName, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: lifecycles
      });
      resolveReady(lifecycles);
    }
  });
})();`;
}

function rewriteRootRelativeAttribute(
  element: HtmlDocument,
  name: string,
): void {
  const value = element.getAttribute(name);
  if (!value?.startsWith("/") || value.startsWith("//")) return;
  element.setAttribute(name, value.replace(/^\/+/, ""));
}

async function readPackageName(cwd: string): Promise<string> {
  const packageJsonPath = path.join(cwd, "package.json");
  try {
    const source = await fs.readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(source) as { name?: unknown };
    if (typeof pkg.name === "string" && pkg.name.trim()) return pkg.name;
  } catch {
    // Fall through to a deterministic default below.
  }
  return "evjs-qiankun-slave";
}

function resolveQiankunRuntimeModulePath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const builtRuntime = path.join(currentDir, "runtime.js");
  if (existsSync(builtRuntime)) return builtRuntime;
  return path.join(currentDir, "runtime.ts");
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function toImportPath(file: string): string {
  return file.split(path.sep).join(path.posix.sep);
}

function isPathSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    path.isAbsolute(specifier)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatErrorDetail(error: unknown): string {
  if (error instanceof Error && error.message) {
    return ` ${error.message}`;
  }
  return "";
}
