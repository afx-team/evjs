import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DEFAULTS, type ResolvedConfig } from "@evjs/ev/config";
import type { HtmlDocument, Plugin } from "@evjs/ev/plugin";

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
      entry: "evjs:pages-app";
      mount: string;
    };

interface EntryWrapperState {
  role: "master" | "slave";
  entry: ResolvedAppEntry;
  qiankunRuntime: string;
  moduleRef?: ResolvedModuleRef;
  loaderOptions: Record<string, string>;
  libraryName?: string;
}

const entryLoader = fileURLToPath(
  new URL("./entry-loader.cjs", import.meta.url),
);
const qiankunRuntime = resolveQiankunRuntimeModulePath();
const qiankunOriginalQuery = "evjs-qiankun-original";

export function evPluginQiankunMaster(
  options: QiankunMasterPluginOptions,
): Plugin {
  let state: EntryWrapperState | undefined;

  return {
    name: "@evjs/plugin-qiankun:master",
    enforce: "pre",
    setup(ctx) {
      const entry = resolveSingleAppEntry(ctx.config, ctx.cwd, "master");
      const resolver = resolveModuleRef(ctx.cwd, options.resolver);
      state = {
        role: "master",
        entry,
        qiankunRuntime,
        moduleRef: resolver,
        loaderOptions: compactLoaderOptions({
          role: "master",
          qiankunRuntime,
          resolver: toLoaderModuleRequest(resolver),
          resolverExport: resolver.exportName,
        }),
      };
      addEntryWrapperWatchFiles(ctx.addWatchFile, state);

      return {
        async buildStart() {
          await validateEntryWrapperState(state);
        },
        bundlerConfig(config, bundlerCtx) {
          if (options.externalQiankun) {
            applyQiankunExternal(config);
          }
          applyEntryWrapperRule(config, bundlerCtx.bundlerName, state);
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
    name: "@evjs/plugin-qiankun:slave",
    enforce: "pre",
    async setup(ctx) {
      const entry = resolveSingleAppEntry(ctx.config, ctx.cwd, "slave");
      const runtime = options.runtime
        ? resolveModuleRef(ctx.cwd, options.runtime)
        : undefined;
      const appName = options.name ?? (await readPackageName(ctx.cwd));
      state = {
        role: "slave",
        entry,
        qiankunRuntime,
        moduleRef: runtime,
        libraryName: appName,
        loaderOptions: compactLoaderOptions({
          role: "slave",
          qiankunRuntime,
          runtime: runtime ? toLoaderModuleRequest(runtime) : undefined,
          runtimeExport: runtime?.exportName,
          name: appName,
          mount: entry.mount,
        }),
      };
      addEntryWrapperWatchFiles(ctx.addWatchFile, state);

      return {
        async buildStart() {
          await validateEntryWrapperState(state);
        },
        bundlerConfig(config, bundlerCtx) {
          if (options.externalQiankun) {
            applyQiankunExternal(config);
          }
          applyEntryWrapperRule(config, bundlerCtx.bundlerName, state);
        },
        transformHtml(doc) {
          transformQiankunSlaveHtml(doc);
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
      entry: "evjs:pages-app",
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
): Pick<ResolvedModuleRef, "absolutePath" | "importSpecifier"> {
  if (isPathSpecifier(specifier)) {
    const absolutePath = resolveModulePath(cwd, specifier);
    return { absolutePath, importSpecifier: toImportPath(absolutePath) };
  }

  const projectRequire = createRequire(path.join(cwd, "package.json"));
  try {
    const absolutePath = projectRequire.resolve(specifier);
    return { absolutePath, importSpecifier: specifier };
  } catch (error) {
    throw new Error(
      `[evjs:plugin-qiankun] Failed to resolve module "${specifier}" from ${cwd}.${formatErrorDetail(error)}`,
    );
  }
}

function resolveModulePath(cwd: string, specifier: string): string {
  return path.isAbsolute(specifier) ? specifier : path.resolve(cwd, specifier);
}

function applyEntryWrapperRule(
  config: unknown,
  bundlerName: string,
  state: EntryWrapperState | undefined,
): void {
  if (!state) {
    throw new Error(
      "[evjs:plugin-qiankun] qiankun entry wrapper was not initialized. The plugin setup hook must run before bundlerConfig.",
    );
  }

  if (bundlerName === "webpack") {
    applyWebpackEntryWrapperRule(config, state);
    return;
  }

  if (bundlerName === "utoopack") {
    applyUtoopackEntryWrapperRule(config, state);
    return;
  }

  throw new Error(
    `[evjs:plugin-qiankun] Unsupported bundler "${bundlerName}". qiankun entry wrapping currently supports webpack and utoopack.`,
  );
}

function applyWebpackEntryWrapperRule(
  config: unknown,
  state: EntryWrapperState,
): void {
  const configs = Array.isArray(config) ? config : [config];
  for (const webpackConfig of configs) {
    if (!isRecord(webpackConfig)) continue;
    if (webpackConfig.target === "node") continue;

    const moduleOptions = ensureRecordProperty(webpackConfig, "module");
    const rules = ensureArrayProperty(moduleOptions, "rules");
    ensureWebpackPagesOriginalRule(rules, state.entry);
    rules.unshift({
      test: createWebpackEntryPathRegExp(state.entry),
      resourceQuery: { not: [createWebpackOriginalQueryRegExp()] },
      use: [
        {
          loader: entryLoader,
          options: state.loaderOptions,
        },
      ],
    });

    if (state.role === "slave") {
      applyWebpackSlaveLibrary(webpackConfig, state);
    }
  }
}

function applyUtoopackEntryWrapperRule(
  config: unknown,
  state: EntryWrapperState,
): void {
  if (!isRecord(config)) return;
  const moduleOptions = ensureRecordProperty(config, "module");
  const rules = ensureRecordProperty(moduleOptions, "rules");
  ensureUtoopackPagesOriginalRule(rules, state.entry);
  prependUtoopackRule(rules, {
    condition: {
      path: createUtoopackEntryPathRegExp(state.entry),
      query: "",
    },
    loaders: [
      {
        loader: entryLoader,
        options: state.loaderOptions,
      },
    ],
    type: "ecmascript",
  });

  if (state.role === "slave") {
    applyUtoopackSlaveLibrary(config, state);
  }
}

function prependUtoopackRule(
  rules: Record<string, unknown>,
  rule: Record<string, unknown>,
): void {
  const current = rules["**/*"];
  if (current === undefined) {
    rules["**/*"] = [rule];
    return;
  }
  if (Array.isArray(current)) {
    current.unshift(rule);
    return;
  }
  rules["**/*"] = [rule, current];
}

function applyWebpackSlaveLibrary(
  config: Record<string, unknown>,
  state: EntryWrapperState,
): void {
  const libraryName = state.libraryName ?? "evjs-qiankun-slave";
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

function applyUtoopackSlaveLibrary(
  config: Record<string, unknown>,
  state: EntryWrapperState,
): void {
  const entries = config.entry;
  if (!Array.isArray(entries)) return;

  for (const entry of entries) {
    if (isRecord(entry)) {
      entry.library = { name: state.libraryName ?? "evjs-qiankun-slave" };
    }
  }
}

function toLoaderModuleRequest(moduleRef: ResolvedModuleRef): string {
  if (!isPathSpecifier(moduleRef.importSpecifier)) {
    return moduleRef.importSpecifier;
  }
  return moduleRef.absolutePath ?? moduleRef.importSpecifier;
}

function compactLoaderOptions(
  options: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(options).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
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

function applyQiankunExternal(config: unknown): void {
  const configs = Array.isArray(config) ? config : [config];
  for (const item of configs) {
    if (!isRecord(item)) continue;
    applySingleQiankunExternal(item);
  }
}

function applySingleQiankunExternal(config: Record<string, unknown>): void {
  const external = { qiankun: "qiankun" };
  const externals = config.externals;
  if (externals === undefined) {
    config.externals = external;
    return;
  }
  if (Array.isArray(externals)) {
    externals.push(external);
    return;
  }
  if (isRecord(externals)) {
    externals.qiankun = "qiankun";
    return;
  }
  config.externals = [externals, external];
}

function transformQiankunSlaveHtml(doc: HtmlDocument): void {
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

  if (!scripts.some((script) => script.hasAttribute("entry"))) {
    scripts.at(-1)?.setAttribute("entry", "");
  }
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

function createExactPathRegExp(file: string): RegExp {
  return new RegExp(`${toPathRegExpSource(toImportPath(file))}$`);
}

function createWebpackEntryPathRegExp(entry: ResolvedAppEntry): RegExp {
  return entry.kind === "pages-app"
    ? createPagesEntryAnchorPathRegExp("webpack")
    : createExactPathRegExp(entry.absolutePath);
}

function createWebpackOriginalQueryRegExp(): RegExp {
  return new RegExp(`^\\?${escapeRegExp(qiankunOriginalQuery)}$`);
}

function resolveQiankunRuntimeModulePath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const builtRuntime = path.join(currentDir, "runtime.js");
  if (existsSync(builtRuntime)) return builtRuntime;
  return path.join(currentDir, "runtime.ts");
}

function createUtoopackEntryPathRegExp(entry: ResolvedAppEntry): RegExp {
  if (entry.kind === "pages-app") {
    return createPagesEntryAnchorPathRegExp("utoopack");
  }

  const absolutePattern = toPathRegExpSource(toImportPath(entry.absolutePath));
  const relativePattern = toPathRegExpSource(
    toImportPath(entry.entry).replace(/^\.\//, ""),
  );
  return new RegExp(`(?:${absolutePattern}|(?:^|[/\\\\])${relativePattern})$`);
}

function createPagesEntryAnchorPathRegExp(
  bundlerName: "webpack" | "utoopack",
): RegExp {
  const packageName = `bundler-${bundlerName}`;
  return new RegExp(
    `(?:^|[/\\\\])(?:packages[/\\\\]${packageName}|node_modules[/\\\\]@evjs[/\\\\]${packageName})[/\\\\](?:src|esm)[/\\\\]adapter[/\\\\]pages-entry-anchor\\.js$`,
  );
}

function ensureWebpackPagesOriginalRule(
  rules: unknown[],
  entry: ResolvedAppEntry,
): void {
  if (entry.kind !== "pages-app") return;
  if (rules.some(isWebpackPagesOriginalRule)) return;

  const pagesRule = rules.find(isWebpackPagesEntryRule);
  if (!isRecord(pagesRule)) return;

  const index = rules.indexOf(pagesRule);
  rules.splice(index + 1, 0, {
    ...pagesRule,
    resourceQuery: createWebpackOriginalQueryRegExp(),
  });
}

function isWebpackPagesOriginalRule(rule: unknown): boolean {
  return (
    isRecord(rule) &&
    rule.resourceQuery instanceof RegExp &&
    rule.resourceQuery.test(`?${qiankunOriginalQuery}`) &&
    isWebpackPagesEntryRule(rule)
  );
}

function isWebpackPagesEntryRule(
  rule: unknown,
): rule is Record<string, unknown> {
  if (!isRecord(rule) || !Array.isArray(rule.use)) return false;
  return rule.use.some((item) => {
    if (!isRecord(item)) return false;
    return (
      typeof item.loader === "string" &&
      item.loader.includes("pages-entry-loader.cjs")
    );
  });
}

function ensureUtoopackPagesOriginalRule(
  rules: Record<string, unknown>,
  entry: ResolvedAppEntry,
): void {
  if (entry.kind !== "pages-app") return;
  const current = rules["**/*"];
  const ruleItems = Array.isArray(current) ? current : current ? [current] : [];
  const pagesRule = ruleItems.find(isUtoopackPagesEntryRule);
  if (!isRecord(pagesRule)) return;

  const originalRules = [qiankunOriginalQuery, `?${qiankunOriginalQuery}`]
    .filter(
      (query) =>
        !ruleItems.some((rule) => isUtoopackPagesOriginalRule(rule, query)),
    )
    .map((query) => ({
      ...pagesRule,
      condition: {
        ...asRecord(pagesRule.condition),
        query,
      },
    }));
  if (originalRules.length === 0) return;

  if (Array.isArray(current)) {
    current.splice(current.indexOf(pagesRule) + 1, 0, ...originalRules);
    return;
  }
  rules["**/*"] = current ? [current, ...originalRules] : originalRules;
}

function isUtoopackPagesOriginalRule(rule: unknown, query: string): boolean {
  return (
    isUtoopackPagesEntryRule(rule) &&
    isRecord(rule.condition) &&
    rule.condition.query === query
  );
}

function isUtoopackPagesEntryRule(
  rule: unknown,
): rule is Record<string, unknown> {
  if (!isRecord(rule) || !Array.isArray(rule.loaders)) return false;
  return rule.loaders.some((item) => {
    if (!isRecord(item)) return false;
    return (
      typeof item.loader === "string" &&
      item.loader.includes("pages-entry-loader.cjs")
    );
  });
}

function toPathRegExpSource(file: string): string {
  return file
    .split("/")
    .map((segment) => escapeRegExp(segment))
    .join("[/\\\\]");
}

function ensureRecordProperty(
  target: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const current = target[key];
  if (isRecord(current)) return current;
  const next: Record<string, unknown> = {};
  target[key] = next;
  return next;
}

function ensureArrayProperty(
  target: Record<string, unknown>,
  key: string,
): unknown[] {
  const current = target[key];
  if (Array.isArray(current)) return current;
  const next: unknown[] = [];
  target[key] = next;
  return next;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
