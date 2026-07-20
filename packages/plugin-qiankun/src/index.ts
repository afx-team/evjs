import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DEFAULTS, type ResolvedConfig } from "@evjs/ev/config";
import type {
  ContributionContext,
  GeneratedModuleRef,
  HtmlDocument,
  Plugin,
} from "@evjs/ev/plugin";

export interface QiankunModuleRefObject {
  module: string;
  exportName?: string;
}

export type QiankunModuleRef = string | QiankunModuleRefObject;

export interface QiankunMasterPluginOptions {
  resolver: QiankunModuleRef;
  externalQiankun?: boolean;
}

export interface QiankunSlavePluginOptions {
  runtime?: QiankunModuleRef;
  name?: string;
  externalQiankun?: boolean;
}

interface ResolvedModuleRef {
  raw: string;
  absolutePath?: string;
  importSpecifier: string;
  exportName: string;
  kind: "file" | "package";
}

type ResolvedAppEntry =
  | {
      kind: "file";
      entry: string;
      absolutePath: string;
      mount: string;
    }
  | {
      kind: "pages-app";
      mount: string;
    };

interface EntryWrapperState {
  role: "master" | "slave";
  entry: ResolvedAppEntry;
  qiankunRuntime: string;
  moduleRef?: ResolvedModuleRef;
  appName?: string;
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

export function evPluginQiankunMaster(
  options: QiankunMasterPluginOptions,
): Plugin {
  let state: EntryWrapperState | undefined;

  return {
    name: masterPluginName,
    enforce: "pre",
    async contributions(ctx) {
      state = await createMasterState(ctx, options);
      const currentState = state;
      addEntryWrapperWatchFiles(ctx.addWatchFile, currentState);
      await validateEntryWrapperState(currentState);
      if (options.externalQiankun) {
        addQiankunExternalContribution(ctx);
      }
      const wrapper = ctx.emit.module({
        id: "entry-wrapper",
        scope: { kind: "app" },
        source: (helpers) =>
          createMasterEntryWrapperSource(currentState, helpers),
      });
      ctx.slot("client.entry").add({
        id: "entry-wrapper-slot",
        module: wrapper,
        position: "after-main",
        target: { kind: "app" },
      });
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
  let state: EntryWrapperState | undefined;

  return {
    name: slavePluginName,
    enforce: "pre",
    async contributions(ctx) {
      state = await createSlaveState(ctx, options);
      const currentState = state;
      addEntryWrapperWatchFiles(ctx.addWatchFile, currentState);
      await validateEntryWrapperState(currentState);
      if (options.externalQiankun) {
        addQiankunExternalContribution(ctx);
      }
      const originalEntry = emitOriginalEntryModule(ctx, currentState);
      const wrapper = ctx.emit.module({
        id: "entry-wrapper",
        scope: { kind: "app" },
        source: ({ importFile, importOf }) =>
          createSlaveEntryWrapperSource(
            currentState,
            { importFile, importOf },
            originalEntry
              ? importOf(originalEntry)
              : getFileEntryImport(currentState, importFile),
          ),
      });
      ctx.slot("client.entry").add({
        id: "entry-wrapper-slot",
        module: wrapper,
        position: "before-main",
        mode: "replace",
        target: { kind: "app" },
      });
    },
    setup() {
      return {
        bundlerConfig(config, bundlerCtx) {
          assertSupportedBundler(bundlerCtx.bundlerName);
          applySlaveBundlerConfig(config, bundlerCtx.bundlerName, state);
        },
        transformHtml(doc) {
          transformQiankunSlaveHtml(doc, state);
        },
      };
    },
  };
}

function resolveSingleAppEntry(
  config: ResolvedConfig,
  cwd: string,
  role: "master" | "slave",
): ResolvedAppEntry {
  if (config.pages !== undefined) {
    throw new Error(
      `[evjs:plugin-qiankun] ${role} mode only supports a single SPA app entry. Remove pages or use SPA file routing for the qiankun application.`,
    );
  }
  if (config.routing?.mode === "mpa") {
    throw new Error(
      `[evjs:plugin-qiankun] ${role} mode only supports SPA file routing. qiankun entry wrapping cannot target MPA routing.`,
    );
  }
  if (
    config.app !== undefined &&
    (typeof config.app === "string" || "source" in config.app)
  ) {
    throw new Error(
      `[evjs:plugin-qiankun] ${role} mode requires app.entry. app.source lifecycle modules are not wrapped by qiankun v1.`,
    );
  }

  if (config.routing?.mode === "spa" && config.app === undefined) {
    return {
      kind: "pages-app",
      mount: config.routing.mount,
    };
  }

  const entry = config.app?.entry ?? config.entry ?? CONFIG_DEFAULTS.entry;
  return {
    kind: "file",
    entry,
    absolutePath: resolveModulePath(cwd, entry),
    mount: config.app?.mount ?? CONFIG_DEFAULTS.mount,
  };
}

function resolveModuleRef(
  cwd: string,
  ref: QiankunModuleRef,
): ResolvedModuleRef {
  const raw = typeof ref === "string" ? ref : ref.module;
  const exportName =
    typeof ref === "string" ? "default" : (ref.exportName ?? "default");
  return {
    raw,
    exportName,
    ...resolveModuleSpecifier(cwd, raw),
  };
}

function resolveModuleSpecifier(
  cwd: string,
  specifier: string,
): Pick<ResolvedModuleRef, "absolutePath" | "importSpecifier" | "kind"> {
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
  const entry = resolveSingleAppEntry(ctx.config, ctx.cwd, "master");
  const resolver = resolveModuleRef(ctx.cwd, options.resolver);
  return {
    role: "master",
    entry,
    qiankunRuntime,
    moduleRef: resolver,
  };
}

async function createSlaveState(
  ctx: ContributionContext,
  options: QiankunSlavePluginOptions,
): Promise<EntryWrapperState> {
  const entry = resolveSingleAppEntry(ctx.config, ctx.cwd, "slave");
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
    "",
    "void startQiankunMaster(masterResolver);",
  ].join("\n");
}

function emitOriginalEntryModule(
  ctx: ContributionContext,
  state: EntryWrapperState,
): GeneratedModuleRef | undefined {
  if (state.entry.kind === "file") return undefined;
  const entry = ctx.framework.getPagesAppEntry();
  if (!entry) {
    throw new Error(
      "[evjs:plugin-qiankun] Failed to find generated SPA routing entry metadata.",
    );
  }
  return ctx.emit.entryFacade({
    id: "original-entry",
    entry,
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

function getFileEntryImport(
  state: EntryWrapperState,
  importFile: GeneratedSourceHelpers["importFile"],
): string {
  if (state.entry.kind !== "file") {
    throw new Error(
      "[evjs:plugin-qiankun] Expected file app entry for qiankun slave wrapper.",
    );
  }
  return importFile(state.entry.absolutePath);
}

function toModuleImport(
  moduleRef: ResolvedModuleRef,
  helpers: GeneratedSourceHelpers,
): string {
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

function applySlaveBundlerConfig(
  config: unknown,
  bundlerName: string,
  state: EntryWrapperState | undefined,
): void {
  if (!state) {
    throw new Error(
      "[evjs:plugin-qiankun] qiankun entry wrapper was not initialized. The contributions hook must run before bundlerConfig.",
    );
  }
  if (bundlerName === "webpack") {
    applyWebpackSlaveLibraryToConfig(config, state);
  }
}

function applyWebpackSlaveLibraryToConfig(
  config: unknown,
  state: EntryWrapperState,
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
  state: EntryWrapperState,
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
  if (state.entry.kind === "file") addWatchFile(state.entry.absolutePath);
  if (state.moduleRef?.absolutePath) addWatchFile(state.moduleRef.absolutePath);
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

  if (state.entry.kind === "file") {
    await assertFileExists(state.role, "app entry", state.entry.absolutePath);
  }
  await assertFileExists(state.role, "qiankun runtime", state.qiankunRuntime);
  if (state.moduleRef?.absolutePath) {
    await assertFileExists(
      state.role,
      `module "${state.moduleRef.raw}"`,
      state.moduleRef.absolutePath,
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

function transformQiankunSlaveHtml(
  doc: HtmlDocument,
  state: EntryWrapperState | undefined,
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
  proxyScript.textContent = createQiankunLifecycleProxyScript(
    state?.appName ?? "evjs-qiankun-slave",
  );
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
