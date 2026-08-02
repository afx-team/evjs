import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DefaultBundlerConfig } from "@evjs/ev/config";
import {
  definePlugin,
  type FrameworkView,
  type GeneratedModuleRef,
  type HtmlDocument,
  type PluginEmitIRContext,
  type PluginHooks,
  type PluginSetupContext,
  pluginOptions,
} from "@evjs/ev/plugin";

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

export interface QiankunSlavePluginOptions {
  runtime?: QiankunModuleRef;
  name?: string;
  externalQiankun?: boolean;
}

interface QiankunSlaveState {
  readonly role: "slave";
  readonly appName: string;
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

interface BaseEntryWrapperState {
  entry: ResolvedAppEntry;
  qiankunRuntime: string;
}

interface MasterEntryWrapperState extends BaseEntryWrapperState {
  readonly role: "master";
  moduleRef: ResolvedModuleRef;
}

interface SlaveEntryWrapperState
  extends BaseEntryWrapperState,
    QiankunSlaveState {
  moduleRef?: ResolvedModuleRef;
}

type EntryWrapperState = MasterEntryWrapperState | SlaveEntryWrapperState;

interface GeneratedSourceHelpers {
  importOf(ref: GeneratedModuleRef): string;
  importFile(file: string): string;
}

const masterPluginId = "qiankun-master";
const slavePluginId = "qiankun-slave";
const qiankunRuntime = resolveQiankunRuntimeModulePath();
const qiankunRuntimeImport = "@evjs/plugin-qiankun/runtime";
const qiankunLifecycleProxyId = "__EVJS_QIANKUN_LIFECYCLE_PROXY__";

/**
 * Add the qiankun master entry contribution to an existing plugin.
 *
 * This is the composable form of {@link evPluginQiankunMaster}.
 */
export async function emitQiankunMasterIR<TBundlerCfg = DefaultBundlerConfig>(
  ctx: PluginEmitIRContext<TBundlerCfg>,
  options: QiankunMasterPluginOptions,
): Promise<void> {
  const state = createMasterState(ctx, options);
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
      createMasterEntryWrapperSource(
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
}

/**
 * Add the qiankun slave replacement entry to an existing plugin.
 *
 * This is the composable form of {@link evPluginQiankunSlave}.
 */
export async function emitQiankunSlaveIR<TBundlerCfg = DefaultBundlerConfig>(
  ctx: PluginEmitIRContext<TBundlerCfg>,
  options: QiankunSlavePluginOptions = {},
): Promise<void> {
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
}

export const evPluginQiankunMaster = definePlugin({
  id: masterPluginId,
  application: pluginOptions<QiankunMasterPluginOptions>(),
  enforce: "pre",
  async emitIR(ctx) {
    await emitQiankunMasterIR(ctx, ctx.options);
  },
  setup() {
    return createQiankunMasterHooks();
  },
});

export const evPluginQiankunSlave = definePlugin({
  id: slavePluginId,
  application: pluginOptions<QiankunSlavePluginOptions>({ defaults: {} }),
  enforce: "pre",
  async emitIR(ctx) {
    await emitQiankunSlaveIR(ctx, ctx.options);
  },
  async setup(ctx) {
    return createQiankunSlaveHooks(ctx, ctx.options);
  },
});

/** Lifecycle hooks reused by standalone and platform-composed master plugins. */
export function createQiankunMasterHooks(): PluginHooks {
  return {
    configureBundler(_config, bundlerCtx) {
      assertSupportedBundler(bundlerCtx.bundlerName);
    },
  };
}

/** Lifecycle hooks reused by standalone and platform-composed slave plugins. */
export async function createQiankunSlaveHooks<
  TBundlerCfg = DefaultBundlerConfig,
>(
  ctx: PluginSetupContext<TBundlerCfg>,
  options: Pick<QiankunSlavePluginOptions, "name"> = {},
): Promise<PluginHooks> {
  const state: QiankunSlaveState = {
    role: "slave",
    appName: options.name ?? (await readPackageName(ctx.cwd)),
  };
  return {
    configureBundler(config, bundlerCtx) {
      applyQiankunSlaveBundlerConfig(config, bundlerCtx.bundlerName, state);
    },
    transformHtml(doc) {
      applyQiankunSlaveHtmlTransform(doc, state);
    },
  };
}

function resolveSingleAppEntry(
  framework: FrameworkView,
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

function createMasterState<TBundlerCfg>(
  ctx: PluginEmitIRContext<TBundlerCfg>,
  options: QiankunMasterPluginOptions,
): MasterEntryWrapperState {
  const entry = resolveSingleAppEntry(ctx.framework, "master");
  const resolver = resolveModuleRef(ctx.cwd, options.resolver);
  return {
    role: "master",
    entry,
    qiankunRuntime,
    moduleRef: resolver,
  };
}

async function createSlaveState<TBundlerCfg>(
  ctx: PluginEmitIRContext<TBundlerCfg>,
  options: QiankunSlavePluginOptions,
): Promise<SlaveEntryWrapperState> {
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

function addQiankunExternalContribution<TBundlerCfg>(
  ctx: PluginEmitIRContext<TBundlerCfg>,
): void {
  ctx.slot("resolve.external").add({
    id: "qiankun-external",
    specifier: "qiankun",
    source: "qiankun",
    runtime: "client",
  });
}

function createMasterEntryWrapperSource(
  state: MasterEntryWrapperState,
  helpers: GeneratedSourceHelpers,
  originalEntry: string,
): string {
  const resolver = state.moduleRef;
  return [
    `import { type QiankunMasterResolver, resolveQiankunModuleExport, startQiankunMaster } from ${JSON.stringify(qiankunRuntimeImport)};`,
    `import * as masterResolverModule from ${JSON.stringify(toModuleImport(resolver, helpers))};`,
    "",
    "const masterResolver = resolveQiankunModuleExport<QiankunMasterResolver>(",
    "  masterResolverModule,",
    `  ${JSON.stringify(resolver.exportName)},`,
    `  "qiankun master resolver",`,
    ");",
    "",
    "export const ready = startQiankunMaster({",
    "  resolver: masterResolver,",
    `  mount: ${JSON.stringify(state.entry.mount)},`,
    `  loadEntry: () => import(${JSON.stringify(originalEntry)}),`,
    "});",
  ].join("\n");
}

function emitOriginalEntryModule<TBundlerCfg>(
  ctx: PluginEmitIRContext<TBundlerCfg>,
): GeneratedModuleRef {
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
  state: SlaveEntryWrapperState,
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
    `  name: ${JSON.stringify(state.appName)},`,
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
    `  (window as unknown as Record<string, unknown>)[${JSON.stringify(state.appName)}] = qiankunLifecycles;`,
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
    `[evjs:plugin-qiankun] Unsupported bundler "${bundlerName}". qiankun supports only webpack and utoopack.`,
  );
}

/**
 * Apply qiankun slave bundler requirements using resolved plugin options.
 */
function applyQiankunSlaveBundlerConfig(
  config: unknown,
  bundlerName: string,
  state: QiankunSlaveState,
): void {
  assertSupportedBundler(bundlerName);
  if (bundlerName === "webpack") {
    applyWebpackSlaveLibraryToConfig(config, state);
  }
}

function applyWebpackSlaveLibraryToConfig(
  config: unknown,
  state: QiankunSlaveState,
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
  state: QiankunSlaveState,
): void {
  const library = { name: state.appName, type: "umd" };
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
  state: EntryWrapperState,
): Promise<void> {
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
 * The lifecycle hooks and generated entry resolve the same deterministic
 * application name independently because setup precedes contribution emission.
 */
function applyQiankunSlaveHtmlTransform(
  doc: HtmlDocument,
  state: QiankunSlaveState,
): void {
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
  proxyScript.textContent = createQiankunLifecycleProxyScript(state.appName);
  entryScript.before(proxyScript);
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
