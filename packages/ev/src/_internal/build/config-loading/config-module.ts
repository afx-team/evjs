import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti, type ModuleCache } from "jiti";
import type { Config } from "../../../config/index.js";
import { extractRuntimeModuleReferences } from "../analysis/static-imports.js";

const requireFromLoader = createRequire(import.meta.url);
const evPackageManifest = requireFromLoader("../../../../package.json") as {
  exports: Record<string, { import: string }>;
};
const currentEvPackageAliases = resolveCurrentEvPackageAliases();

const NODE_MODULES_SEGMENT = `${path.sep}node_modules${path.sep}`;
const STATIC_CONFIG_MODULE_EXTENSIONS = [
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".mtsx",
  ".ctsx",
  ".json",
] as const;
const JITI_TYPESCRIPT_SIBLING_EXTENSIONS = new Map([
  [".js", ".ts"],
  [".mjs", ".mts"],
  [".cjs", ".cts"],
  [".jsx", ".tsx"],
  [".mjsx", ".mtsx"],
  [".cjsx", ".ctsx"],
]);
const STATIC_CONFIG_CONDITION_SETS = [
  new Set(["node", "require"]),
  new Set(["node", "import"]),
] as const;

interface ObservedStaticConfigDependencies {
  aliases: Map<string, string>;
  dependencies: string[];
  nativeModules: string[];
}

type ConfigLoader = ReturnType<typeof createJiti>;

interface StaticConfigModuleSessionState {
  evaluationLoaders: Map<string, ConfigLoader>;
  resolutionLoader?: ConfigLoader;
}

interface FreshPackageSpecifierResolution {
  candidates: string[];
  matched: boolean;
  target?: string;
}

interface PackageMapEntry {
  value: unknown;
  wildcard?: string;
}

interface FreshPackageTarget {
  found: boolean;
  value: string;
}

const INVALID_PACKAGE_TARGET = Symbol("invalid-package-target");

export interface LoadConfigFileOptions {
  /**
   * Cache transformed and evaluated config modules.
   *
   * Disabled by default so dev-mode config reloads can observe edits to the
   * config file and its imported helper modules.
   */
  cache?: boolean;
  /** Observe project-local dependency candidates before evaluation reads them. */
  onDependency?: (file: string) => void;
}

export interface LoadedStaticConfigModule {
  value: unknown;
  hasDefaultExport: boolean;
  /** Absolute project-local files in the evaluated module closure. */
  dependencies: string[];
}

export interface LoadStaticConfigModuleOptions {
  /** Reuse the current process cache after a caller performed batch clearing. */
  cache?: boolean;
  /** Observe project-local dependency candidates before evaluation reads them. */
  onDependency?: (file: string) => void;
}

export interface StaticConfigModuleSession {
  /** Load one config through the resolution and module state for this revision. */
  load(
    configPath: string,
    options?: Pick<LoadStaticConfigModuleOptions, "onDependency">,
  ): Promise<LoadedStaticConfigModule>;
}

export interface ClearStaticConfigModuleCacheOptions {
  /**
   * Also clear dependency closures recorded for previous config roots in this
   * project. This covers config files that were removed or renamed between
   * discovery passes.
   */
  projectRoot?: string;
}

const staticConfigDependencies = new Map<string, string[]>();

export function createStaticConfigModuleSession(
  projectRoot: string,
): StaticConfigModuleSession {
  const absoluteProjectRoot = path.resolve(projectRoot);
  const state: StaticConfigModuleSessionState = {
    evaluationLoaders: new Map(),
  };
  return Object.freeze({
    load(
      configPath: string,
      options: Pick<LoadStaticConfigModuleOptions, "onDependency"> = {},
    ) {
      return loadStaticConfigModuleWithState(
        configPath,
        absoluteProjectRoot,
        { ...options, cache: true },
        state,
      );
    },
  });
}

export async function loadConfigFile<TBundlerCfg = unknown>(
  configPath: string,
  options: LoadConfigFileOptions = {},
): Promise<Config<TBundlerCfg>> {
  const absoluteConfigPath = path.resolve(configPath);

  try {
    const projectRoot = path.dirname(absoluteConfigPath);
    const resolvedConfigPath = resolveProjectLocalConfigRoot(
      absoluteConfigPath,
      projectRoot,
    );
    if (resolvedConfigPath !== absoluteConfigPath) {
      options.onDependency?.(absoluteConfigPath);
    }
    const resolutionLoader = createConfigLoader(
      resolvedConfigPath,
      options.cache === true,
    );
    const observed = await observeStaticConfigDependencyCandidates(
      resolvedConfigPath,
      projectRoot,
      options.onDependency,
      (fromFile, specifier) =>
        resolveStaticConfigImport(resolutionLoader, fromFile, specifier),
    );
    const loader = createConfigLoader(
      resolvedConfigPath,
      options.cache === true,
      observed.aliases,
      observed.nativeModules,
    );
    const source = await fs.promises.readFile(resolvedConfigPath, "utf-8");
    const mod = loader.evalModule(source, {
      cache: Object.create(null) as ModuleCache,
      ext: path.extname(resolvedConfigPath),
      filename: resolvedConfigPath,
      forceTranspile: true,
    });
    return resolveConfigExport<TBundlerCfg>(mod);
  } catch (error) {
    throw new Error(`Failed to load evjs config from ${absoluteConfigPath}`, {
      cause: error,
    });
  }
}

/**
 * Evaluate a build-only data module through the same TypeScript-capable loader
 * as ev.config.ts while retaining its complete project-local dependency
 * closure for dev invalidation.
 */
export async function loadStaticConfigModule(
  configPath: string,
  projectRoot: string,
  options: LoadStaticConfigModuleOptions = {},
): Promise<LoadedStaticConfigModule> {
  return loadStaticConfigModuleWithState(configPath, projectRoot, options);
}

async function loadStaticConfigModuleWithState(
  configPath: string,
  projectRoot: string,
  options: LoadStaticConfigModuleOptions,
  sessionState?: StaticConfigModuleSessionState,
): Promise<LoadedStaticConfigModule> {
  const absoluteConfigPath = path.resolve(configPath);
  const absoluteProjectRoot = path.resolve(projectRoot);

  try {
    const resolvedConfigPath = resolveProjectLocalConfigRoot(
      absoluteConfigPath,
      absoluteProjectRoot,
    );
    if (options.cache !== true) {
      clearStaticConfigModuleCache([absoluteConfigPath, resolvedConfigPath]);
    }
    if (resolvedConfigPath !== absoluteConfigPath) {
      options.onDependency?.(absoluteConfigPath);
    }
    let resolutionLoader: ConfigLoader;
    if (sessionState) {
      sessionState.resolutionLoader ??= createConfigLoader(
        resolvedConfigPath,
        true,
      );
      resolutionLoader = sessionState.resolutionLoader;
    } else {
      resolutionLoader = createConfigLoader(resolvedConfigPath, true);
    }
    const observed = await observeStaticConfigDependencyCandidates(
      resolvedConfigPath,
      absoluteProjectRoot,
      options.onDependency,
      (fromFile, specifier) =>
        resolveStaticConfigImport(resolutionLoader, fromFile, specifier),
    );
    const loader = sessionState
      ? getStaticConfigModuleSessionLoader(
          sessionState,
          resolvedConfigPath,
          observed,
        )
      : createConfigLoader(
          resolvedConfigPath,
          true,
          observed.aliases,
          observed.nativeModules,
        );
    let loaded: unknown;
    try {
      loaded = loader(resolvedConfigPath);
    } catch (error) {
      const dependencies = mergeStaticConfigDependencies(
        [absoluteConfigPath],
        observed.dependencies,
        collectCachedProjectModules(
          loader.cache,
          resolvedConfigPath,
          absoluteProjectRoot,
        ),
      );
      staticConfigDependencies.set(absoluteConfigPath, dependencies);
      try {
        publishStaticConfigDependencies(options, dependencies);
      } catch (observerError) {
        throw new AggregateError(
          [error, observerError],
          `Static config evaluation and dependency observation both failed for ${absoluteConfigPath}`,
          { cause: error },
        );
      }
      throw error;
    }

    const rootModule = findCachedModule(loader.cache, resolvedConfigPath);
    const dependencies = mergeStaticConfigDependencies(
      [absoluteConfigPath],
      observed.dependencies,
      rootModule
        ? collectProjectModuleDependencies(
            rootModule,
            resolvedConfigPath,
            absoluteProjectRoot,
          )
        : collectCachedProjectModules(
            loader.cache,
            resolvedConfigPath,
            absoluteProjectRoot,
          ),
    );
    staticConfigDependencies.set(absoluteConfigPath, dependencies);
    publishStaticConfigDependencies(options, dependencies);
    const resolved = readOwnDefaultExport(loaded);
    return {
      value: resolved.value,
      hasDefaultExport: resolved.hasDefaultExport,
      dependencies,
    };
  } catch (error) {
    throw new Error(
      `Failed to load static config module from ${absoluteConfigPath}`,
      { cause: error },
    );
  }
}

function publishStaticConfigDependencies(
  options: LoadStaticConfigModuleOptions,
  dependencies: readonly string[],
): void {
  for (const dependency of dependencies) {
    options.onDependency?.(dependency);
  }
}

function resolveProjectLocalConfigRoot(
  configPath: string,
  projectRoot: string,
): string {
  const absoluteConfigPath = path.resolve(configPath);
  const resolvedConfigPath = safeRealpath(configPath);
  const resolvedProjectRoot = safeRealpath(projectRoot);
  if (
    isNodeModulesPath(resolvedConfigPath) ||
    !isPathInside(resolvedConfigPath, resolvedProjectRoot)
  ) {
    throw new Error(
      `[evjs] Static config root "${configPath}" resolves outside project root "${projectRoot}".`,
    );
  }
  try {
    return fs.lstatSync(absoluteConfigPath).isSymbolicLink()
      ? resolvedConfigPath
      : absoluteConfigPath;
  } catch (error) {
    if (isMissingPathError(error)) return absoluteConfigPath;
    throw error;
  }
}

async function observeStaticConfigDependencyCandidates(
  root: string,
  projectRoot: string,
  onDependency: ((file: string) => void) | undefined,
  resolveImport: (fromFile: string, specifier: string) => string | undefined,
): Promise<ObservedStaticConfigDependencies> {
  const aliases = new Map<string, string>();
  const aliasScopes = new Map<string, string>();
  const dependencies = new Set<string>();
  const nativeModules = new Set<string>();
  const visited = new Set<string>();
  const pending = [root];
  const packageManifests = new Map<
    string,
    Record<string, unknown> | undefined
  >();

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    if (!isProjectLocalModuleCandidate(file, projectRoot)) continue;
    dependencies.add(file);
    onDependency?.(file);

    let source: string;
    try {
      source = await fs.promises.readFile(file, "utf-8");
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw error;
    }
    if (path.extname(file).toLowerCase() === ".json") continue;

    const packageManifest = await readNearestProjectPackageManifest(
      file,
      projectRoot,
      dependencies,
      packageManifests,
      onDependency,
    );
    for (const reference of extractRuntimeModuleReferences(source, {
      includeRequire: true,
    })) {
      const { specifier } = reference;
      const packageName = packageNameFromSpecifier(specifier);
      if (packageName) nativeModules.add(packageName);
      const authoredPath = assertProjectLocalStaticConfigSpecifier(
        file,
        specifier,
        projectRoot,
      );
      const packageResolution = packageManifest
        ? resolveFreshPackageSpecifier(
            packageManifest.file,
            packageManifest.value,
            specifier,
          )
        : undefined;
      if (packageManifest && packageResolution?.matched) {
        for (const candidate of packageResolution.candidates) {
          if (!isProjectLocalModuleCandidate(candidate, projectRoot)) continue;
          onDependency?.(candidate);
        }
        if (!packageResolution.target) {
          throw new Error(
            `[evjs] Package specifier "${specifier}" has no matching static config target in "${packageManifest.file}".`,
          );
        }
        const aliasTarget = packageResolution.target;
        registerFreshPackageAlias(
          aliases,
          aliasScopes,
          specifier,
          aliasTarget,
          packageManifest.file,
        );
        if (path.isAbsolute(aliasTarget)) {
          assertProjectLocalStaticConfigPath(
            aliasTarget,
            projectRoot,
            `Package target for "${specifier}"`,
          );
          onDependency?.(aliasTarget);
          if (reference.kind === "load") pending.push(aliasTarget);
        }
        continue;
      }

      const resolved = resolveImport(file, specifier);
      if (resolved && authoredPath !== undefined) {
        assertProjectLocalStaticConfigPath(
          resolved,
          projectRoot,
          `Import "${specifier}" from "${file}"`,
        );
      }
      if (resolved && isProjectLocalModuleCandidate(resolved, projectRoot)) {
        let observedResolvedCandidate = false;
        for (const candidate of resolveStaticConfigImportCandidates(
          file,
          specifier,
        )) {
          if (!isProjectLocalModuleCandidate(candidate, projectRoot)) continue;
          onDependency?.(candidate);
          if (haveSameModuleIdentity(candidate, resolved)) {
            observedResolvedCandidate = true;
            break;
          }
        }
        if (!observedResolvedCandidate) onDependency?.(resolved);
        if (reference.kind === "load") pending.push(resolved);
        continue;
      }

      const packageImportCandidates = packageManifest
        ? resolvePackageImportCandidates(
            packageManifest.file,
            packageManifest.value,
            specifier,
          )
        : [];
      const resolutionCandidates =
        packageImportCandidates.length > 0
          ? packageImportCandidates
          : resolveStaticConfigImportCandidates(file, specifier);
      const candidates =
        resolutionCandidates.length === 0 && authoredPath !== undefined
          ? [authoredPath]
          : resolutionCandidates;
      const observeEveryExistingCandidate = packageImportCandidates.length > 0;
      for (const candidate of candidates) {
        if (!isProjectLocalModuleCandidate(candidate, projectRoot)) continue;
        onDependency?.(candidate);

        try {
          const stat = await fs.promises.stat(candidate);
          if (!stat.isFile()) continue;
          if (reference.kind === "load") pending.push(candidate);
          if (!observeEveryExistingCandidate) break;
        } catch (error) {
          if (!isMissingPathError(error)) throw error;
          // Missing resolution candidates remain observed so creating the
          // imported module can retry a failed config evaluation.
        }
      }
    }
  }

  return {
    aliases,
    dependencies: [...dependencies].sort(),
    nativeModules: [...nativeModules].sort(),
  };
}

function packageNameFromSpecifier(specifier: string): string | undefined {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("node:") ||
    URL.canParse(specifier)
  ) {
    return undefined;
  }
  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
}

function assertProjectLocalStaticConfigSpecifier(
  fromFile: string,
  specifier: string,
  projectRoot: string,
): string | undefined {
  if (specifier.startsWith("node:")) return undefined;
  let candidate: string;
  if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
    candidate = path.resolve(path.dirname(fromFile), specifier);
  } else {
    let url: URL;
    try {
      url = new URL(specifier);
    } catch {
      return undefined;
    }
    if (url.protocol !== "file:") {
      throw new Error(
        `[evjs] Static config import "${specifier}" uses unsupported URL protocol "${url.protocol}". Only project-local file URLs, installed packages, and node: built-ins are allowed.`,
      );
    }
    candidate = fileURLToPath(url);
  }
  assertProjectLocalStaticConfigPath(
    candidate,
    projectRoot,
    `Import "${specifier}" from "${fromFile}"`,
  );
  return candidate;
}

function assertProjectLocalStaticConfigPath(
  candidate: string,
  projectRoot: string,
  subject: string,
): void {
  if (isProjectLocalModuleCandidate(candidate, projectRoot)) return;
  throw new Error(
    `[evjs] ${subject} resolves outside project root "${projectRoot}". Static config may only load project-local modules or installed packages.`,
  );
}

async function readNearestProjectPackageManifest(
  fromFile: string,
  projectRoot: string,
  dependencies: Set<string>,
  cache: Map<string, Record<string, unknown> | undefined>,
  onDependency: ((file: string) => void) | undefined,
): Promise<
  { file: string; value: Record<string, unknown> | undefined } | undefined
> {
  for (const candidate of listProjectPackageManifestCandidates(
    fromFile,
    projectRoot,
  )) {
    if (!isProjectLocalModuleCandidate(candidate, projectRoot)) {
      throw new Error(
        `[evjs] Project package manifest "${candidate}" resolves outside project root "${projectRoot}".`,
      );
    }
    onDependency?.(candidate);

    try {
      if (!(await fs.promises.stat(candidate)).isFile()) continue;
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      // A missing nearer package.json remains observed while resolution falls
      // back to the next manifest toward the project root.
      continue;
    }

    dependencies.add(candidate);
    if (!cache.has(candidate)) {
      const parsed = JSON.parse(
        await fs.promises.readFile(candidate, "utf-8"),
      ) as unknown;
      if (!isRecord(parsed) || Array.isArray(parsed)) {
        throw new TypeError(
          `[evjs] Package manifest "${candidate}" must contain a JSON object.`,
        );
      }
      cache.set(candidate, parsed);
    }
    return { file: candidate, value: cache.get(candidate) };
  }

  return undefined;
}

function listProjectPackageManifestCandidates(
  fromFile: string,
  projectRoot: string,
): string[] {
  const realProjectRoot = safeRealpath(projectRoot);
  const nearestRealPath = resolveNearestRealPath(path.dirname(fromFile));
  if (!nearestRealPath || !isPathInside(nearestRealPath, realProjectRoot)) {
    return [];
  }

  const candidates: string[] = [];
  let current = nearestRealPath;
  while (isPathInside(current, realProjectRoot)) {
    candidates.push(path.join(current, "package.json"));
    if (current === realProjectRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return candidates;
}

function resolveFreshPackageSpecifier(
  packageManifest: string,
  manifest: Record<string, unknown> | undefined,
  specifier: string,
): FreshPackageSpecifierResolution | undefined {
  if (!manifest) return undefined;

  let entry: PackageMapEntry | undefined;
  let allowExternalTarget = false;
  if (specifier.startsWith("#")) {
    if (
      specifier === "#" ||
      specifier.startsWith("#/") ||
      specifier.endsWith("/") ||
      !isRecord(manifest.imports)
    ) {
      return { candidates: [], matched: true };
    }
    entry = findPackageMapEntry(manifest.imports, specifier);
    allowExternalTarget = true;
  } else if (
    typeof manifest.name === "string" &&
    Object.hasOwn(manifest, "exports")
  ) {
    const packageSubpath =
      specifier === manifest.name
        ? "."
        : specifier.startsWith(`${manifest.name}/`)
          ? `.${specifier.slice(manifest.name.length)}`
          : undefined;
    if (!packageSubpath) return undefined;

    assertValidPackageExportsMap(manifest.exports, packageManifest);

    if (
      packageSubpath === "." &&
      (!isRecord(manifest.exports) ||
        Object.keys(manifest.exports).every((key) => !key.startsWith(".")))
    ) {
      entry = { value: manifest.exports };
    } else if (isRecord(manifest.exports)) {
      entry = findPackageMapEntry(manifest.exports, packageSubpath);
    }
  } else {
    return undefined;
  }

  const candidates = resolvePackageImportCandidates(
    packageManifest,
    manifest,
    specifier,
  );
  if (!entry) return { candidates, matched: true };

  let target: string | undefined;
  for (const conditions of STATIC_CONFIG_CONDITION_SETS) {
    const resolved = resolveFreshPackageTarget(
      entry.value,
      entry.wildcard,
      conditions,
      packageManifest,
      allowExternalTarget,
    );
    if (resolved === undefined) continue;
    if (resolved === null || resolved === INVALID_PACKAGE_TARGET) {
      return { candidates, matched: true };
    }
    if (resolved.found) {
      target = resolved.value;
      break;
    }
  }
  return {
    candidates,
    matched: true,
    target,
  };
}

function assertValidPackageExportsMap(
  exports: unknown,
  packageManifest: string,
): void {
  if (!isRecord(exports)) return;
  const keys = Object.keys(exports);
  if (
    keys.some((key) => key.startsWith(".")) &&
    keys.some((key) => !key.startsWith("."))
  ) {
    throw new Error(
      `[evjs] Package manifest "${packageManifest}" cannot mix subpath and condition keys in "exports".`,
    );
  }
}

function findPackageMapEntry(
  map: Record<string, unknown>,
  specifier: string,
): PackageMapEntry | undefined {
  if (Object.hasOwn(map, specifier)) {
    return { value: map[specifier] };
  }

  const matches = Object.entries(map)
    .flatMap(([key, value]) => {
      const wildcard = key.indexOf("*");
      if (wildcard === -1 || key.lastIndexOf("*") !== wildcard) return [];
      const prefix = key.slice(0, wildcard);
      const suffix = key.slice(wildcard + 1);
      if (
        specifier.length < key.length ||
        !specifier.startsWith(prefix) ||
        !specifier.endsWith(suffix)
      ) {
        return [];
      }
      return [
        {
          key,
          prefixLength: prefix.length,
          value,
          wildcard: specifier.slice(
            prefix.length,
            specifier.length - suffix.length,
          ),
        },
      ];
    })
    .sort(
      (left, right) =>
        right.prefixLength - left.prefixLength ||
        right.key.length - left.key.length,
    );
  const best = matches[0];
  return best ? { value: best.value, wildcard: best.wildcard } : undefined;
}

function resolveFreshPackageTarget(
  value: unknown,
  wildcard: string | undefined,
  conditions: ReadonlySet<string>,
  packageManifest: string,
  allowExternalTarget: boolean,
): FreshPackageTarget | null | undefined | typeof INVALID_PACKAGE_TARGET {
  if (typeof value === "string") {
    const target =
      wildcard === undefined ? value : value.replaceAll("*", wildcard);
    return resolveFreshPackageAliasTarget(
      packageManifest,
      target,
      allowExternalTarget,
    );
  }
  if (value === null) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    let lastResult: null | undefined | typeof INVALID_PACKAGE_TARGET;
    for (const item of value) {
      const selected = resolveFreshPackageTarget(
        item,
        wildcard,
        conditions,
        packageManifest,
        allowExternalTarget,
      );
      if (selected === undefined) continue;
      if (selected === null) {
        lastResult = null;
        continue;
      }
      if (selected === INVALID_PACKAGE_TARGET) {
        lastResult = INVALID_PACKAGE_TARGET;
        continue;
      }
      return selected;
    }
    return lastResult;
  }
  if (!isRecord(value)) return INVALID_PACKAGE_TARGET;
  if (Object.keys(value).some(isArrayIndex)) {
    return INVALID_PACKAGE_TARGET;
  }
  for (const [condition, target] of Object.entries(value)) {
    if (condition !== "default" && !conditions.has(condition)) continue;
    const selected = resolveFreshPackageTarget(
      target,
      wildcard,
      conditions,
      packageManifest,
      allowExternalTarget,
    );
    if (selected !== undefined) return selected;
  }
  return undefined;
}

function resolveFreshPackageAliasTarget(
  packageManifest: string,
  target: string,
  allowExternalTarget: boolean,
): FreshPackageTarget | typeof INVALID_PACKAGE_TARGET {
  if (!target.startsWith("./")) {
    return allowExternalTarget && isValidExternalPackageTarget(target)
      ? { found: true, value: target }
      : INVALID_PACKAGE_TARGET;
  }

  if (hasInvalidPackageTargetSegment(target.slice(2))) {
    return INVALID_PACKAGE_TARGET;
  }

  const packageRoot = path.dirname(packageManifest);
  const absoluteTarget = path.resolve(packageRoot, target);
  if (
    !isPathInside(absoluteTarget, packageRoot) ||
    isNodeModulesPath(absoluteTarget)
  ) {
    return INVALID_PACKAGE_TARGET;
  }
  try {
    if (fs.statSync(absoluteTarget).isFile()) {
      return { found: true, value: absoluteTarget };
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
  return { found: false, value: absoluteTarget };
}

function hasInvalidPackageTargetSegment(target: string): boolean {
  return target
    .split(/[\\/]+/)
    .some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.toLowerCase() === "node_modules" ||
        /%2e|%2f|%5c/i.test(segment),
    );
}

function isValidExternalPackageTarget(target: string): boolean {
  if (
    target.length === 0 ||
    target.startsWith(".") ||
    target.startsWith("/") ||
    target.startsWith("#") ||
    target.includes("\\") ||
    target.includes("%")
  ) {
    return false;
  }
  try {
    new URL(target);
    return false;
  } catch {
    // Bare package specifiers are not valid absolute URLs.
  }
  const segments = target.split("/");
  if (segments[0]?.startsWith("@") && !segments[1]) return false;
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      segment.toLowerCase() !== "node_modules",
  );
}

function isArrayIndex(value: string): boolean {
  const number = Number(value);
  return `${number}` === value && number >= 0 && number < 0xffff_ffff;
}

function registerFreshPackageAlias(
  aliases: Map<string, string>,
  scopes: Map<string, string>,
  specifier: string,
  target: string,
  packageManifest: string,
): void {
  const previous = aliases.get(specifier);
  const previousScope = scopes.get(specifier);
  if (
    previous !== undefined &&
    (previous !== target || previousScope !== packageManifest)
  ) {
    throw new Error(
      `[evjs] Package specifier "${specifier}" is mapped by both "${previousScope}" and "${packageManifest}" while loading static config dependencies. Nested package scopes must not map the same specifier in one config dependency closure.`,
    );
  }
  aliases.set(specifier, target);
  scopes.set(specifier, packageManifest);
}

function resolvePackageImportCandidates(
  packageManifest: string,
  manifest: Record<string, unknown> | undefined,
  specifier: string,
): string[] {
  const targets: string[] = [];
  if (specifier.startsWith("#") && isRecord(manifest?.imports)) {
    collectPackageMapTargets(manifest.imports, specifier, targets);
  } else if (typeof manifest?.name === "string") {
    const packageSubpath =
      specifier === manifest.name
        ? "."
        : specifier.startsWith(`${manifest.name}/`)
          ? `.${specifier.slice(manifest.name.length)}`
          : undefined;
    if (packageSubpath) {
      if (
        packageSubpath === "." &&
        (!isRecord(manifest.exports) ||
          Object.keys(manifest.exports).every((key) => !key.startsWith(".")))
      ) {
        collectPackageTargetStrings(manifest.exports, undefined, targets);
      } else if (isRecord(manifest.exports)) {
        collectPackageMapTargets(manifest.exports, packageSubpath, targets);
      }
    }
  }

  return [
    ...new Set(
      targets
        .filter((target) => target.startsWith("./"))
        .map((target) => path.resolve(path.dirname(packageManifest), target)),
    ),
  ];
}

function collectPackageMapTargets(
  map: Record<string, unknown>,
  specifier: string,
  targets: string[],
): void {
  const exactTarget = map[specifier];
  if (exactTarget !== undefined) {
    collectPackageTargetStrings(exactTarget, undefined, targets);
    return;
  }

  for (const [key, value] of Object.entries(map)) {
    const wildcard = key.indexOf("*");
    if (wildcard === -1) continue;
    const prefix = key.slice(0, wildcard);
    const suffix = key.slice(wildcard + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    const match = specifier.slice(
      prefix.length,
      specifier.length - suffix.length,
    );
    collectPackageTargetStrings(value, match, targets);
  }
}

function collectPackageTargetStrings(
  value: unknown,
  wildcard: string | undefined,
  targets: string[],
): void {
  if (typeof value === "string") {
    targets.push(
      wildcard === undefined ? value : value.replaceAll("*", wildcard),
    );
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPackageTargetStrings(item, wildcard, targets);
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const target of Object.values(value)) {
    collectPackageTargetStrings(target, wildcard, targets);
  }
}

function resolveStaticConfigImport(
  loader: ReturnType<typeof createConfigLoader>,
  fromFile: string,
  specifier: string,
): string | undefined {
  let esmError: unknown;
  try {
    const esmResolved = loader.esmResolve(specifier, {
      parentURL: pathToFileURL(fromFile),
      try: true,
    });
    if (esmResolved) return normalizeResolvedConfigImport(esmResolved);
  } catch (error) {
    esmError = error;
    // Fall through to Jiti's CommonJS-compatible resolver. It supports
    // package.json#imports through the loader root on Node versions where the
    // ESM-compatible resolver cannot resolve a TypeScript target.
  }

  try {
    return normalizeResolvedConfigImport(
      loader.resolve(specifier, { paths: [path.dirname(fromFile)] }),
    );
  } catch (error) {
    if (!isModuleResolutionMiss(error)) throw error;
    if (esmError !== undefined && !isModuleResolutionMiss(esmError)) {
      throw esmError;
    }
    return undefined;
  }
}

function isModuleResolutionMiss(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return (
    code === "MODULE_NOT_FOUND" ||
    code === "ERR_MODULE_NOT_FOUND" ||
    code === "ERR_UNSUPPORTED_DIR_IMPORT"
  );
}

function normalizeResolvedConfigImport(resolved: string): string | undefined {
  if (resolved.startsWith("node:")) return undefined;
  if (resolved.startsWith("file:")) {
    return path.resolve(fileURLToPath(resolved));
  }
  return path.isAbsolute(resolved) ? path.resolve(resolved) : undefined;
}

function resolveStaticConfigImportCandidates(
  fromFile: string,
  specifier: string,
): string[] {
  if (!specifier.startsWith(".") && !path.isAbsolute(specifier)) return [];

  const base = path.resolve(path.dirname(fromFile), specifier);
  const authoredExtension = path.extname(base);
  if (authoredExtension) {
    const typescriptExtension =
      JITI_TYPESCRIPT_SIBLING_EXTENSIONS.get(authoredExtension);
    return typescriptExtension
      ? [
          base,
          `${base.slice(0, -authoredExtension.length)}${typescriptExtension}`,
        ]
      : [base];
  }

  return [
    base,
    ...STATIC_CONFIG_MODULE_EXTENSIONS.map(
      (extension) => `${base}${extension}`,
    ),
    ...STATIC_CONFIG_MODULE_EXTENSIONS.map((extension) =>
      path.join(base, `index${extension}`),
    ),
  ];
}

function isProjectLocalModuleCandidate(
  candidate: string,
  projectRoot: string,
): boolean {
  const absoluteCandidate = path.resolve(candidate);
  const absoluteProjectRoot = path.resolve(projectRoot);
  const nearestRealPath = resolveNearestRealPath(absoluteCandidate);
  return (
    nearestRealPath !== undefined &&
    !isNodeModulesPath(absoluteCandidate) &&
    !isNodeModulesPath(nearestRealPath) &&
    isPathInside(nearestRealPath, safeRealpath(absoluteProjectRoot))
  );
}

function haveSameModuleIdentity(left: string, right: string): boolean {
  return safeRealpath(left) === safeRealpath(right);
}

function resolveNearestRealPath(
  candidate: string,
  visited = new Set<string>(),
): string | undefined {
  let current = path.resolve(candidate);

  while (!visited.has(current)) {
    visited.add(current);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        const target = path.resolve(
          path.dirname(current),
          fs.readlinkSync(current),
        );
        return resolveNearestRealPath(target, visited);
      }
      return safeRealpath(current);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }

  return undefined;
}

function mergeStaticConfigDependencies(
  ...collections: readonly string[][]
): string[] {
  return [...new Set(collections.flat())].sort();
}

export function clearStaticConfigModuleCache(
  configPaths: string[],
  options: ClearStaticConfigModuleCacheOptions = {},
): void {
  const configRoots = new Set(
    configPaths.map((configPath) => path.resolve(configPath)),
  );
  if (options.projectRoot) {
    const projectRoot = path.resolve(options.projectRoot);
    for (const configPath of staticConfigDependencies.keys()) {
      if (isPathInside(configPath, projectRoot)) {
        configRoots.add(configPath);
      }
    }
  }

  const files = new Set<string>();
  for (const configPath of configRoots) {
    files.add(configPath);
    for (const dependency of staticConfigDependencies.get(configPath) ?? []) {
      files.add(dependency);
    }
    staticConfigDependencies.delete(configPath);
  }
  const realFiles = new Set([...files].map(safeRealpath));

  for (const cachedFile of Object.keys(requireFromLoader.cache)) {
    if (files.has(cachedFile) || realFiles.has(safeRealpath(cachedFile))) {
      delete requireFromLoader.cache[cachedFile];
    }
  }
}

function resolveConfigExport<TBundlerCfg>(mod: unknown): Config<TBundlerCfg> {
  const resolved = readOwnDefaultExport(mod);
  if (resolved.hasDefaultExport && resolved.value !== undefined) {
    return resolved.value as Config<TBundlerCfg>;
  }

  return mod as Config<TBundlerCfg>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createConfigLoader(
  configPath: string,
  moduleCache: boolean,
  freshPackageAliases: ReadonlyMap<string, string> = new Map(),
  nativeModules: string[] = [],
) {
  return createJiti(configPath, {
    alias: {
      ...Object.fromEntries(freshPackageAliases),
      ...currentEvPackageAliases,
    },
    fsCache: false,
    interopDefault: true,
    moduleCache,
    nativeModules,
    transformOptions: {},
    tryNative: true,
  });
}

function getStaticConfigModuleSessionLoader(
  state: StaticConfigModuleSessionState,
  configPath: string,
  observed: ObservedStaticConfigDependencies,
): ConfigLoader {
  const key = JSON.stringify([
    [...observed.aliases].sort(([left], [right]) => left.localeCompare(right)),
    observed.nativeModules,
  ]);
  const cached = state.evaluationLoaders.get(key);
  if (cached) return cached;

  const loader = createConfigLoader(
    configPath,
    true,
    observed.aliases,
    observed.nativeModules,
  );
  state.evaluationLoaders.set(key, loader);
  return loader;
}

function collectProjectModuleDependencies(
  root: NodeJS.Module,
  configPath: string,
  projectRoot: string,
): string[] {
  const dependencies = new Set<string>();
  const visited = new Set<NodeJS.Module>();
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const filename = current.filename && path.resolve(current.filename);
    if (
      filename &&
      !isNodeModulesPath(filename) &&
      isPathInside(safeRealpath(filename), safeRealpath(projectRoot))
    ) {
      dependencies.add(filename);
    }
    queue.push(...current.children);
  }

  dependencies.add(configPath);
  return [...dependencies].sort();
}

function findCachedModule(
  cache: NodeJS.Require["cache"],
  filename: string,
): NodeJS.Module | undefined {
  const absoluteFilename = path.resolve(filename);
  const direct = cache[absoluteFilename];
  if (direct) return direct;

  const realFilename = safeRealpath(absoluteFilename);
  const realDirect = cache[realFilename];
  if (realDirect) return realDirect;

  return Object.values(cache).find(
    (candidate) =>
      candidate?.filename && safeRealpath(candidate.filename) === realFilename,
  );
}

function collectCachedProjectModules(
  cache: NodeJS.Require["cache"],
  configPath: string,
  projectRoot: string,
): string[] {
  const realProjectRoot = safeRealpath(projectRoot);
  const dependencies = new Set<string>([configPath]);
  for (const candidate of Object.values(cache)) {
    const filename = candidate?.filename && path.resolve(candidate.filename);
    if (
      filename &&
      !isNodeModulesPath(filename) &&
      isPathInside(safeRealpath(filename), realProjectRoot)
    ) {
      dependencies.add(filename);
    }
  }
  return [...dependencies].sort();
}

/** Read the real export slot without triggering Jiti's default-interop fallback. */
function readOwnDefaultExport(mod: unknown): {
  value: unknown;
  hasDefaultExport: boolean;
} {
  if (!isRecord(mod)) {
    return { value: mod, hasDefaultExport: false };
  }
  const descriptor = Object.getOwnPropertyDescriptor(mod, "default");
  if (!descriptor) {
    return { value: mod, hasDefaultExport: false };
  }
  return {
    value: "value" in descriptor ? descriptor.value : mod.default,
    hasDefaultExport: true,
  };
}

function isPathInside(file: string, dir: string): boolean {
  const relative = path.relative(dir, file);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function isNodeModulesPath(file: string): boolean {
  return file.includes(NODE_MODULES_SEGMENT);
}

function safeRealpath(file: string): string {
  try {
    return fs.realpathSync.native(file);
  } catch (error) {
    if (isFileNotFoundError(error)) return path.resolve(file);
    throw error;
  }
}

function resolveCurrentEvPackageEntry(): string {
  const sourceEntry = fileURLToPath(
    new URL("../../../index.ts", import.meta.url),
  );
  if (fs.existsSync(sourceEntry)) return sourceEntry;

  const builtEntry = fileURLToPath(
    new URL("../../../index.js", import.meta.url),
  );
  if (fs.existsSync(builtEntry)) return builtEntry;

  return requireFromLoader.resolve("@evjs/ev");
}

function resolveCurrentEvPackageAliases(): Record<string, string> {
  const packageEntry = resolveCurrentEvPackageEntry();
  const packageVariantDir = path.dirname(packageEntry);
  const useSource = path.extname(packageEntry) === ".ts";
  const aliases: Record<string, string> = {};

  for (const [subpath, target] of Object.entries(evPackageManifest.exports)) {
    if (!target.import.startsWith("./esm/")) {
      throw new Error(
        `[evjs] Package export "${subpath}" must provide an import target under "./esm".`,
      );
    }
    const builtRelativePath = target.import.slice("./esm/".length);
    const relativePath = useSource
      ? builtRelativePath.replace(/\.js$/, ".ts")
      : builtRelativePath;
    const specifier =
      subpath === "." ? "@evjs/ev" : `@evjs/ev${subpath.slice(1)}`;
    const resolved = path.resolve(packageVariantDir, relativePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `[evjs] Package export "${specifier}" targets missing ${useSource ? "source" : "build"} module "${resolved}".`,
      );
    }
    aliases[specifier] = resolved;
  }

  return aliases;
}

function isFileNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isMissingPathError(error: unknown): boolean {
  return (
    isRecord(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
