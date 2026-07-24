import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import type { Config } from "../../config/index.js";

const requireFromLoader = createRequire(import.meta.url);

const NODE_MODULES_SEGMENT = `${path.sep}node_modules${path.sep}`;

export interface LoadConfigFileOptions {
  /**
   * Cache transformed and evaluated config modules.
   *
   * Disabled by default so dev-mode config reloads can observe edits to the
   * config file and its imported helper modules.
   */
  cache?: boolean;
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

export async function loadConfigFile<TBundlerCfg = unknown>(
  configPath: string,
  options: LoadConfigFileOptions = {},
): Promise<Config<TBundlerCfg>> {
  const absoluteConfigPath = path.resolve(configPath);

  try {
    const loader = createConfigLoader(
      absoluteConfigPath,
      options.cache === true,
    );
    const mod = loader(absoluteConfigPath);
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
  const absoluteConfigPath = path.resolve(configPath);
  const absoluteProjectRoot = path.resolve(projectRoot);

  try {
    if (options.cache !== true) {
      clearStaticConfigModuleCache([absoluteConfigPath]);
    }
    const loader = createConfigLoader(absoluteConfigPath, true);
    let loaded: unknown;
    try {
      loaded = loader(absoluteConfigPath);
    } catch (error) {
      staticConfigDependencies.set(
        absoluteConfigPath,
        collectCachedProjectModules(
          loader.cache,
          absoluteConfigPath,
          absoluteProjectRoot,
        ),
      );
      throw error;
    }

    const rootModule = findCachedModule(loader.cache, absoluteConfigPath);
    const dependencies = rootModule
      ? collectProjectModuleDependencies(
          rootModule,
          absoluteConfigPath,
          absoluteProjectRoot,
        )
      : collectCachedProjectModules(
          loader.cache,
          absoluteConfigPath,
          absoluteProjectRoot,
        );
    staticConfigDependencies.set(absoluteConfigPath, dependencies);
    const resolved = resolveDefaultExport(loaded);
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
  if (isRecord(mod) && "default" in mod && mod.default !== undefined) {
    return mod.default as Config<TBundlerCfg>;
  }

  return mod as Config<TBundlerCfg>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createConfigLoader(configPath: string, moduleCache: boolean) {
  return createJiti(configPath, {
    alias: {
      "@evjs/ev": resolveCurrentEvPackageEntry(),
    },
    fsCache: false,
    interopDefault: false,
    moduleCache,
    tryNative: false,
  });
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
  const realFilename = safeRealpath(filename);
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

function resolveDefaultExport(mod: unknown): {
  value: unknown;
  hasDefaultExport: boolean;
} {
  if (isRecord(mod) && Object.hasOwn(mod, "default")) {
    return { value: mod.default, hasDefaultExport: true };
  }
  return { value: mod, hasDefaultExport: false };
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
  const sourceEntry = fileURLToPath(new URL("../../index.ts", import.meta.url));
  if (fs.existsSync(sourceEntry)) return sourceEntry;

  const builtEntry = fileURLToPath(new URL("../../index.js", import.meta.url));
  if (fs.existsSync(builtEntry)) return builtEntry;

  return requireFromLoader.resolve("@evjs/ev");
}

function isFileNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
