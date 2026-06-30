import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type Options as SwcOptions,
  transform,
  transformSync,
} from "@swc/core";
import type { Config } from "../../config/index.js";

const requireFromLoader = createRequire(import.meta.url);
const nodeModule = requireFromLoader("node:module") as NodeModuleApi;

const TYPESCRIPT_CONFIG_EXTENSIONS = new Set([".ts", ".cts", ".mts"]);
const TYPESCRIPT_TRANSPILE_EXTENSIONS = new Set([
  ...TYPESCRIPT_CONFIG_EXTENSIONS,
  ".tsx",
]);
const REQUIRE_HOOK_EXTENSIONS = [".ts", ".tsx", ".cts", ".mts", ".cjs", ".mjs"];
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

export interface TranspileTypeScriptConfigOptions {
  filename: string;
}

export async function loadConfigFile<TBundlerCfg = unknown>(
  configPath: string,
  options: LoadConfigFileOptions = {},
): Promise<Config<TBundlerCfg>> {
  const absoluteConfigPath = path.resolve(configPath);

  try {
    if (options.cache !== true) {
      clearConfigRequireCache(absoluteConfigPath);
    }

    const mod = TYPESCRIPT_CONFIG_EXTENSIONS.has(
      path.extname(absoluteConfigPath),
    )
      ? await loadTypeScriptConfig(absoluteConfigPath)
      : await importConfigModule(absoluteConfigPath, options);
    return resolveConfigExport<TBundlerCfg>(mod);
  } catch (error) {
    throw new Error(`Failed to load evjs config from ${absoluteConfigPath}`, {
      cause: error,
    });
  }
}

export async function transpileTypeScriptConfig(
  source: string,
  options: TranspileTypeScriptConfigOptions,
): Promise<string> {
  const result = await transform(source, {
    filename: options.filename,
    sourceMaps: false,
    jsc: {
      parser: {
        syntax: "typescript",
        tsx: true,
      },
      target: "esnext",
    },
    module: {
      type: "es6",
    },
  });

  return result.code;
}

async function loadTypeScriptConfig(configPath: string): Promise<unknown> {
  const source = await fsp.readFile(configPath, "utf-8");
  const { code } = await transform(source, createConfigSwcOptions(configPath));
  const unregisterRequireHook = registerConfigRequireHook();

  try {
    return requireFromString(code, configPath);
  } finally {
    unregisterRequireHook();
  }
}

async function importConfigModule(
  absoluteConfigPath: string,
  options: LoadConfigFileOptions,
): Promise<unknown> {
  const configUrl = pathToFileURL(absoluteConfigPath);
  if (options.cache !== true) {
    configUrl.searchParams.set("t", createCacheBust());
  }

  return import(configUrl.href);
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

function registerConfigRequireHook(): () => void {
  const extensions = requireFromLoader.extensions;
  const previousHooks = new Map<string, RequireExtension | undefined>();
  const previousResolveFilename = nodeModule._resolveFilename;

  nodeModule._resolveFilename = function resolveConfigFilename(
    this: unknown,
    request,
    parent,
    isMain,
    options,
  ) {
    try {
      return previousResolveFilename.call(
        this,
        request,
        parent,
        isMain,
        options,
      );
    } catch (error) {
      if (isModuleNotFoundError(error)) {
        const sourceModulePath = resolveTypeScriptSourceSpecifier(
          request,
          parent,
        );
        if (sourceModulePath) return sourceModulePath;

        if (request === "@evjs/ev") {
          return resolveCurrentEvPackageEntry();
        }
      }

      throw error;
    }
  };

  const previousJsHook = extensions[".js"];
  extensions[".js"] = (mod, filename) => {
    try {
      return previousJsHook?.(mod, filename);
    } catch (error) {
      if (!isRequireEsmError(error)) throw error;
      return compileConfigDependency(mod, filename);
    }
  };

  for (const extension of REQUIRE_HOOK_EXTENSIONS) {
    previousHooks.set(extension, extensions[extension]);
    extensions[extension] = compileConfigDependency;
  }

  return () => {
    nodeModule._resolveFilename = previousResolveFilename;
    extensions[".js"] = previousJsHook;

    for (const extension of REQUIRE_HOOK_EXTENSIONS) {
      const previousHook = previousHooks.get(extension);
      if (previousHook) {
        extensions[extension] = previousHook;
      } else {
        delete extensions[extension];
      }
    }
  };
}

function compileConfigDependency(
  mod: NodeJS.Module,
  filename: string,
): unknown {
  const source = fs.readFileSync(filename, "utf-8");
  const { code } = transformSync(source, createConfigSwcOptions(filename));
  return (mod as CompilableModule)._compile(code, filename);
}

function requireFromString(code: string, filename: string): unknown {
  const mod = new nodeModule.Module(filename) as CompilableModule;
  mod.filename = filename;
  mod.paths = nodeModule._nodeModulePaths(path.dirname(filename));
  mod._compile(code, filename);
  return mod.exports;
}

function createConfigSwcOptions(filename: string): SwcOptions {
  const extension = path.extname(filename);
  const isTypeScript = TYPESCRIPT_TRANSPILE_EXTENSIONS.has(extension);

  return {
    filename,
    sourceMaps: false,
    jsc: {
      parser: isTypeScript
        ? {
            syntax: "typescript",
            tsx: extension === ".tsx",
          }
        : {
            syntax: "ecmascript",
            jsx: extension === ".jsx",
          },
      target: "esnext",
    },
    module: {
      type: "commonjs",
    },
  };
}

function clearConfigRequireCache(configPath: string): void {
  const configDir = path.dirname(configPath);
  const realConfigDir = safeRealpath(configDir);

  for (const cachedFile of Object.keys(requireFromLoader.cache)) {
    const realCachedFile = safeRealpath(cachedFile);
    if (
      !isNodeModulesPath(realCachedFile) &&
      (cachedFile === configPath ||
        realCachedFile === configPath ||
        isPathInside(realCachedFile, realConfigDir))
    ) {
      delete requireFromLoader.cache[cachedFile];
    }
  }
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

function resolveTypeScriptSourceSpecifier(
  request: string,
  parent?: NodeJS.Module,
): string | undefined {
  if (!parent?.filename || !isRelativeOrAbsoluteSpecifier(request)) {
    return undefined;
  }

  const requestedPath = path.resolve(path.dirname(parent.filename), request);
  const extension = path.extname(requestedPath);
  const candidates = typescriptSourceCandidates(requestedPath, extension);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function isRelativeOrAbsoluteSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    path.isAbsolute(specifier)
  );
}

function typescriptSourceCandidates(
  requestedPath: string,
  extension: string,
): string[] {
  if (extension === ".js") {
    return [
      replaceExtension(requestedPath, ".ts"),
      replaceExtension(requestedPath, ".tsx"),
    ];
  }

  if (extension === ".mjs") {
    return [replaceExtension(requestedPath, ".mts")];
  }

  if (extension === ".cjs") {
    return [replaceExtension(requestedPath, ".cts")];
  }

  return [];
}

function replaceExtension(file: string, extension: string): string {
  return file.slice(0, -path.extname(file).length) + extension;
}

function isModuleNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "MODULE_NOT_FOUND";
}

function isRequireEsmError(error: unknown): boolean {
  return isRecord(error) && error.code === "ERR_REQUIRE_ESM";
}

function isFileNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function createCacheBust(): string {
  return `${Date.now()}-${randomBytes(4).toString("hex")}`;
}

type RequireExtension = NonNullable<
  NodeJS.Require["extensions"][keyof NodeJS.Require["extensions"]]
>;

interface CompilableModule extends NodeJS.Module {
  filename: string;
  paths: string[];
  _compile(code: string, filename: string): unknown;
}

interface NodeModuleApi {
  Module: new (id: string) => NodeJS.Module;
  _nodeModulePaths(from: string): string[];
  _resolveFilename(
    request: string,
    parent?: NodeJS.Module,
    isMain?: boolean,
    options?: unknown,
  ): string;
}
