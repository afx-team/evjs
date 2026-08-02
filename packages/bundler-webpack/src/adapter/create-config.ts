import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPortableRelativeArtifactPath,
  assertSafeBuildOutputPaths,
  assertSafeBuildOwnedOutputPath,
  assertSafeBundlerCleanOutputPath,
  canonicalPortableArtifactPathKey,
  createPluginConfigView,
  type ResolvedBuildOutputPaths,
  resolveBuildOutputPaths,
} from "@evjs/ev/_internal/build";
import type { ResolvedConfig } from "@evjs/ev/config";
import type { ConfigureBundlerContext, PluginHooks } from "@evjs/ev/plugin";
import type {
  BuildEntry,
  BuildPlan,
  PublicPathOutput,
} from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import type { Configuration, EntryObject } from "webpack";
import webpack from "webpack";

const logger = getLogger(["evjs", "bundler-webpack", "config"]);

const require = createRequire(import.meta.url);
const swcLoader = require.resolve("swc-loader");
const cssLoader = require.resolve("css-loader");
const miniCssExtractLoader = require.resolve(
  "mini-css-extract-plugin/dist/loader.js",
);
const serverFunctionLoader = fileURLToPath(
  new URL("./server-function-loader.cjs", import.meta.url),
);
const rscClientReferenceLoader = fileURLToPath(
  new URL("./rsc-client-reference-loader.cjs", import.meta.url),
);
const ReactFlightWebpackPlugin = require("react-server-dom-webpack/plugin");
const clientRscEntry = "@evjs/ev/_internal/client/rsc-runtime";
const clientRscPageContextEntry = "@evjs/ev/_internal/client/rsc-page-context";
const evRouteRscEntry = "@evjs/ev/_internal/client/rsc-page-context";

type RscClientReferenceConfig =
  | string
  | {
      directory: string;
      recursive?: boolean;
      include?: RegExp;
    };

/** The complete set of webpack compiler configurations for one evjs build. */
export type WebpackConfigs = Configuration[];

export async function createWebpackConfigs(
  config: ResolvedConfig<WebpackConfigs>,
  plan: BuildPlan,
  cwd: string,
  hooks: PluginHooks<WebpackConfigs>[],
  options: {
    clean?: boolean;
    addWatchFile?: (file: string) => void;
  } = {},
): Promise<WebpackConfigs> {
  const outputPaths = resolveBuildOutputPaths(cwd, plan);
  await assertSafeBuildOutputPaths(cwd, outputPaths);
  const configs: WebpackConfigs = [];
  const clientEntries = plan.entries.filter(
    (entry) => entry.environment === "client",
  );
  const serverEntries = plan.entries.filter(
    (entry) => entry.environment === "server",
  );
  const buildOnlyServerEntries = serverEntries.filter(
    (entry) => entry.phase === "build",
  );
  const runtimeServerEntries = serverEntries.filter(
    (entry) => entry.phase !== "build",
  );
  const rscServerEntries = runtimeServerEntries.filter(
    (entry) => entry.kind === "rsc-page",
  );
  const regularServerEntries = runtimeServerEntries.filter(
    (entry) => entry.kind !== "rsc-page",
  );

  if (clientEntries.length > 0) {
    configs.push(
      createWebpackConfig({
        cwd,
        entries: clientEntries,
        mode: plan.mode,
        name: "client",
        outputPath: outputPaths.clientDir,
        publicPath: plan.runtime.publicPath,
        resolveAlias: plan.resolve?.alias,
        resolveExternal: plan.resolve?.external,
        functionEndpoint: plan.runtime.server.fn,
        crossOriginLoading: config.output.crossOriginLoading,
        rscClientReferences: getRscClientReferenceModules(
          cwd,
          plan.rsc?.clientReferenceModules ?? [],
        ),
        enableRscClientRuntime: plan.entries.some(
          (entry) =>
            entry.environment === "client" &&
            entry.kind === "runtime" &&
            entry.name === "evjs-rsc-client",
        ),
        reactServerConditions: false,
        clean: options.clean ?? true,
        target: "web",
      }),
    );
  }

  if (regularServerEntries.length > 0) {
    configs.push(
      createWebpackConfig({
        cwd,
        entries: regularServerEntries,
        mode: plan.mode,
        name: "server",
        outputPath: outputPaths.serverDir,
        publicPath: plan.runtime.publicPath,
        resolveAlias: plan.resolve?.alias,
        resolveExternal: plan.resolve?.external,
        functionEndpoint: plan.runtime.server.fn,
        crossOriginLoading: undefined,
        rscClientReferences: getRscClientReferenceModules(
          cwd,
          plan.rsc?.clientReferenceModules ?? [],
        ),
        enableRscClientRuntime: false,
        clean: (options.clean ?? true) && rscServerEntries.length === 0,
        reactServerConditions: false,
        target: "node",
      }),
    );
  }

  if (buildOnlyServerEntries.length > 0) {
    configs.push(
      createWebpackConfig({
        cwd,
        entries: buildOnlyServerEntries,
        mode: plan.mode,
        name: "server-build",
        outputPath: path.join(outputPaths.rootDir, "__evjs_build_server"),
        publicPath: plan.runtime.publicPath,
        resolveAlias: plan.resolve?.alias,
        resolveExternal: plan.resolve?.external,
        functionEndpoint: plan.runtime.server.fn,
        crossOriginLoading: undefined,
        rscClientReferences: getRscClientReferenceModules(
          cwd,
          plan.rsc?.clientReferenceModules ?? [],
        ),
        enableRscClientRuntime: false,
        clean: false,
        reactServerConditions: false,
        target: "node",
      }),
    );
  }

  if (rscServerEntries.length > 0) {
    configs.push(
      createWebpackConfig({
        cwd,
        entries: rscServerEntries,
        mode: plan.mode,
        name: "server-rsc",
        outputPath: outputPaths.serverDir,
        publicPath: plan.runtime.publicPath,
        resolveAlias: plan.resolve?.alias,
        resolveExternal: plan.resolve?.external,
        functionEndpoint: plan.runtime.server.fn,
        crossOriginLoading: undefined,
        rscClientReferences: getRscClientReferenceModules(
          cwd,
          plan.rsc?.clientReferenceModules ?? [],
        ),
        enableRscClientRuntime: false,
        clean: false,
        reactServerConditions: true,
        target: "node",
      }),
    );
  }

  const frameworkOutputExpectations = configs.flatMap((bundlerConfig) => {
    const expectation = getFrameworkWebpackOutputExpectation(
      bundlerConfig,
      outputPaths,
    );
    return expectation ? [expectation] : [];
  });

  const ctx: ConfigureBundlerContext<WebpackConfigs> = Object.freeze({
    mode: plan.mode,
    cwd,
    config: createPluginConfigView(config),
    bundlerName: "webpack",
    environment:
      clientEntries.length > 0 && serverEntries.length > 0
        ? "mixed"
        : clientEntries.length > 0
          ? "client"
          : "server",
    logger,
    addWatchFile: options.addWatchFile ?? missingFrameworkWatchCollector,
  });

  for (const h of hooks) {
    if (h.configureBundler) {
      await h.configureBundler(configs, ctx);
      await assertFrameworkWebpackOutputs(
        cwd,
        configs,
        frameworkOutputExpectations,
        outputPaths,
      );
    }
  }

  await assertFrameworkWebpackOutputs(
    cwd,
    configs,
    frameworkOutputExpectations,
    outputPaths,
  );

  const cleanOutputs: Array<{
    configName: string;
    field: string;
    path: string;
  }> = [];
  for (const bundlerConfig of configs) {
    if (!bundlerConfig.output?.clean) continue;
    const outputPath = bundlerConfig.output.path;
    const configName = bundlerConfig.name ?? "unnamed";
    if (!outputPath) {
      throw new Error(
        `[evjs] Webpack config "${configName}" enables recursive output cleaning without an explicit output.path.`,
      );
    }
    const field = getWebpackOutputField(bundlerConfig);
    await assertSafeBundlerCleanOutputPath(
      cwd,
      field,
      outputPaths.rootDir,
      outputPath,
    );
    assertOwnedWebpackCleanOutput(
      cwd,
      { configName, field, path: outputPath },
      outputPaths,
      cleanOutputs,
    );
    cleanOutputs.push({ configName, field, path: outputPath });
  }

  return configs;
}

async function assertFrameworkWebpackOutputs(
  cwd: string,
  configs: WebpackConfigs,
  expectations: FrameworkWebpackOutputExpectation[],
  outputPaths: ResolvedBuildOutputPaths,
): Promise<void> {
  for (const expectation of expectations) {
    const matches = configs.filter(
      (config) => config.name === expectation.configName,
    );
    if (matches.length !== 1) {
      throw new Error(
        `[evjs] Webpack configureBundler hooks must preserve exactly one framework config named "${expectation.configName}"; found ${matches.length}.`,
      );
    }
    await assertFrameworkWebpackOutput(
      cwd,
      matches[0] as Configuration,
      expectation,
      outputPaths,
    );
  }
  await assertIndependentWebpackOutputs(cwd, configs, expectations);
  assertPortableWebpackArtifactNames(configs);
}

async function assertIndependentWebpackOutputs(
  cwd: string,
  configs: WebpackConfigs,
  expectations: FrameworkWebpackOutputExpectation[],
): Promise<void> {
  const frameworkConfigNames = new Set(
    expectations.map((expectation) => expectation.configName),
  );
  const frameworkOutputs = await Promise.all(
    expectations.map(async (expectation) => ({
      expectation,
      path: await resolveEffectiveOutputPath(cwd, expectation.path),
    })),
  );

  for (const config of configs) {
    if (config.name && frameworkConfigNames.has(config.name)) continue;

    const configName = config.name ?? "unnamed";
    const configuredPath = config.output?.path;
    if (!configuredPath) {
      throw new Error(
        `[evjs] Independent Webpack config "${configName}" must define an explicit output.path outside framework-owned outputs.`,
      );
    }

    const candidatePath = await resolveEffectiveOutputPath(cwd, configuredPath);
    for (const { expectation, path: frameworkPath } of frameworkOutputs) {
      if (!outputPathsOverlap(candidatePath, frameworkPath)) continue;
      throw new Error(
        `[evjs] Independent Webpack config "${configName}" output "${formatProjectRelativeOutputPath(cwd, configuredPath)}" must not overlap framework-owned ${expectation.field} directory "${formatProjectRelativeOutputPath(cwd, expectation.path)}".`,
      );
    }
  }
}

async function resolveEffectiveOutputPath(
  cwd: string,
  configuredPath: string,
): Promise<string> {
  let existingAncestor = path.resolve(cwd, configuredPath);
  const missingSegments: string[] = [];

  while (true) {
    try {
      const realAncestor = await fs.promises.realpath(existingAncestor);
      return path.resolve(realAncestor, ...missingSegments);
    } catch (error) {
      const parent = path.dirname(existingAncestor);
      if (!isMissingOutputPathError(error) || parent === existingAncestor) {
        throw new Error(
          `[evjs] Cannot safely inspect Webpack output path "${formatProjectRelativeOutputPath(cwd, configuredPath)}".`,
          { cause: error },
        );
      }
      missingSegments.unshift(path.basename(existingAncestor));
      existingAncestor = parent;
    }
  }
}

function isMissingOutputPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

interface FrameworkWebpackOutputExpectation {
  configName: string;
  field: "output.client" | "output.server" | "build-only output";
  path: string;
  mode: unknown;
  target: unknown;
  clean: unknown;
  publicPath: unknown;
  crossOriginLoading: unknown;
  entryImports: ReadonlyMap<string, string>;
  templates: WebpackOutputTemplateSnapshot;
  cssPlugin?: MiniCssExtractPlugin;
  cssTemplates?: MiniCssOutputTemplateSnapshot;
}

const WEBPACK_OUTPUT_TEMPLATE_FIELDS = [
  "filename",
  "chunkFilename",
  "assetModuleFilename",
  "webassemblyModuleFilename",
  "sourceMapFilename",
  "hotUpdateChunkFilename",
  "hotUpdateMainFilename",
] as const;

type WebpackOutputTemplateField =
  (typeof WEBPACK_OUTPUT_TEMPLATE_FIELDS)[number];
type WebpackOutputTemplateSnapshot = Record<
  WebpackOutputTemplateField,
  unknown
>;

interface MiniCssOutputTemplateSnapshot {
  filename: unknown;
  chunkFilename: unknown;
}

function getFrameworkWebpackOutputExpectation(
  config: Configuration,
  outputPaths: ResolvedBuildOutputPaths,
): FrameworkWebpackOutputExpectation | undefined {
  const templates = snapshotWebpackOutputTemplates(config);
  const cssPlugin = config.plugins?.find(
    (plugin): plugin is MiniCssExtractPlugin =>
      plugin instanceof MiniCssExtractPlugin,
  );
  const outputExpectation = {
    mode: config.mode,
    target: config.target,
    clean: config.output?.clean,
    publicPath: config.output?.publicPath,
    crossOriginLoading: config.output?.crossOriginLoading,
    entryImports: snapshotFrameworkWebpackEntryImports(config),
    templates,
    ...(cssPlugin
      ? {
          cssPlugin,
          cssTemplates: snapshotMiniCssOutputTemplates(cssPlugin),
        }
      : {}),
  };
  switch (config.name) {
    case "client":
      return {
        ...outputExpectation,
        configName: "client",
        field: "output.client",
        path: outputPaths.clientDir,
      };
    case "server":
    case "server-rsc":
      return {
        ...outputExpectation,
        configName: config.name,
        field: "output.server",
        path: outputPaths.serverDir,
      };
    case "server-build":
      return {
        ...outputExpectation,
        configName: "server-build",
        field: "build-only output",
        path: path.join(outputPaths.rootDir, "__evjs_build_server"),
      };
    default:
      return undefined;
  }
}

async function assertFrameworkWebpackOutput(
  cwd: string,
  config: Configuration,
  expectation: FrameworkWebpackOutputExpectation,
  outputPaths: ResolvedBuildOutputPaths,
): Promise<void> {
  const actualPath = config.output?.path;
  const expectedPath = expectation.path;
  if (actualPath !== expectedPath) {
    throw new Error(
      `[evjs] Webpack config "${expectation.configName}" output.path "${actualPath ? formatProjectRelativeOutputPath(cwd, actualPath) : "<missing>"}" must remain the exact absolute BuildPlan ${expectation.field} directory "${formatProjectRelativeOutputPath(cwd, expectedPath)}". Framework-owned output paths cannot be overridden by configureBundler hooks.`,
    );
  }

  assertFrameworkWebpackIdentity(config, expectation);
  assertFrameworkWebpackEntries(config, expectation);
  assertWebpackOutputTemplates(config, expectation);
  assertSelfContainedServerEntrypoints(config, expectation);

  if (expectation.field === "build-only output") {
    await assertSafeBuildOwnedOutputPath(
      cwd,
      `Webpack config "${expectation.configName}"`,
      outputPaths.rootDir,
      actualPath,
    );
  }
}

function assertFrameworkWebpackIdentity(
  config: Configuration,
  expectation: FrameworkWebpackOutputExpectation,
): void {
  for (const [field, actual, expected] of [
    ["mode", config.mode, expectation.mode],
    ["target", config.target, expectation.target],
    ["output.clean", config.output?.clean, expectation.clean],
    ["output.publicPath", config.output?.publicPath, expectation.publicPath],
    [
      "output.crossOriginLoading",
      config.output?.crossOriginLoading,
      expectation.crossOriginLoading,
    ],
  ] as const) {
    if (Object.is(actual, expected)) continue;
    throw new Error(
      `[evjs] Webpack config "${expectation.configName}" ${field} ${formatOutputTemplate(actual)} must remain the framework-owned value ${formatOutputTemplate(expected)}. configureBundler hooks cannot override framework runtime identity.`,
    );
  }
}

function assertSelfContainedServerEntrypoints(
  config: Configuration,
  expectation: FrameworkWebpackOutputExpectation,
): void {
  if (expectation.configName === "client") return;
  if (config.output?.asyncChunks !== false) {
    throw new Error(
      `[evjs] Webpack config "${expectation.configName}" output.asyncChunks must remain false because evjs server loaders import one self-contained entry asset.`,
    );
  }
  const optimization = config.optimization;
  if (!optimization || optimization.runtimeChunk !== false) {
    throw new Error(
      `[evjs] Webpack config "${expectation.configName}" optimization.runtimeChunk must remain false because evjs server loaders import one self-contained entry asset.`,
    );
  }
  if (optimization.splitChunks !== false) {
    throw new Error(
      `[evjs] Webpack config "${expectation.configName}" optimization.splitChunks must remain disabled because evjs server loaders import one self-contained entry asset.`,
    );
  }
}

function assertFrameworkWebpackEntries(
  config: Configuration,
  expectation: FrameworkWebpackOutputExpectation,
): void {
  const actualEntries = readExplicitWebpackEntries(config);
  if (!actualEntries) {
    throw new Error(
      `[evjs] Webpack config "${expectation.configName}" must keep a static entry object so framework entry names can be validated after configureBundler hooks.`,
    );
  }

  const actualNames = Object.keys(actualEntries);
  const actualNameSet = new Set(actualNames);
  assertPortableWebpackNames(
    actualNames,
    `Webpack config "${expectation.configName}" entry`,
  );
  for (const expectedName of expectation.entryImports.keys()) {
    if (actualNameSet.has(expectedName)) continue;
    throw new Error(
      `[evjs] Webpack config "${expectation.configName}" must preserve framework entry name "${expectedName}" after configureBundler hooks.`,
    );
  }

  for (const actualName of actualNames) {
    if (expectation.entryImports.has(actualName)) continue;
    throw new Error(
      `[evjs] Webpack config "${expectation.configName}" cannot add entry "${actualName}" because framework entries must remain the exact BuildPlan-owned set after configureBundler hooks. Add an independent Webpack config for plugin-owned entries.`,
    );
  }

  for (const [entryName, expectedImport] of expectation.entryImports) {
    const actualEntry = Reflect.get(actualEntries, entryName);
    const actualImport = readSingleWebpackEntryImport(actualEntry);
    if (actualImport === expectedImport) continue;
    throw new Error(
      `[evjs] Webpack config "${expectation.configName}" entry "${entryName}" import ${formatWebpackEntryImport(actualEntry)} must remain the exact single framework-owned BuildPlan import ${JSON.stringify(expectedImport)}. configureBundler hooks cannot override framework entry imports.`,
    );
  }
}

function assertPortableWebpackArtifactNames(configs: WebpackConfigs): void {
  for (const config of configs) {
    const configName = config.name ?? "unnamed";
    if (typeof config.entry === "function") {
      throw new Error(
        `[evjs] Webpack config "${configName}" must use static entries so evjs can validate emitted entry names after configureBundler hooks.`,
      );
    }

    assertPortableWebpackNames(
      readExplicitWebpackEntryNames(config) ?? [],
      `Webpack config "${configName}" entry`,
    );

    const optimization = config.optimization;
    if (!optimization || typeof optimization !== "object") continue;

    const runtimeChunk = optimization.runtimeChunk;
    if (runtimeChunk && typeof runtimeChunk === "object") {
      assertStaticWebpackChunkName(
        (runtimeChunk as { name?: unknown }).name,
        `Webpack config "${configName}" runtime chunk name`,
      );
    }

    const splitChunks = optimization.splitChunks;
    if (!splitChunks || typeof splitChunks !== "object") continue;
    const splitChunksConfig = splitChunks as {
      name?: unknown;
      cacheGroups?: Record<string, unknown>;
    };
    assertStaticWebpackChunkName(
      splitChunksConfig.name,
      `Webpack config "${configName}" split chunk name`,
    );
    for (const [groupName, group] of Object.entries(
      splitChunksConfig.cacheGroups ?? {},
    )) {
      assertPortableRelativeArtifactPath(
        groupName,
        `Webpack config "${configName}" split chunk group name "${groupName}"`,
      );
      if (!group || typeof group !== "object") continue;
      assertStaticWebpackChunkName(
        (group as { name?: unknown }).name,
        `Webpack config "${configName}" split chunk group "${groupName}" name`,
      );
    }
  }
}

function assertPortableWebpackNames(names: string[], field: string): void {
  const seen = new Map<string, string>();
  for (const name of names) {
    assertPortableRelativeArtifactPath(name, `${field} name "${name}"`);
    const key = canonicalPortableArtifactPathKey(name);
    const existing = seen.get(key);
    if (existing !== undefined) {
      throw new Error(
        `[evjs] ${field} names "${existing}" and "${name}" resolve to the same portable artifact path.`,
      );
    }
    seen.set(key, name);
  }
}

function assertStaticWebpackChunkName(value: unknown, field: string): void {
  if (value === undefined || value === false) return;
  if (typeof value !== "string") {
    throw new Error(
      `[evjs] ${field} must be a static portable relative artifact path so evjs can validate it after configureBundler hooks.`,
    );
  }
  assertPortableRelativeArtifactPath(value, field);
}

function readExplicitWebpackEntryNames(
  config: Configuration,
): string[] | undefined {
  const entry = readExplicitWebpackEntries(config);
  return entry ? Object.keys(entry) : undefined;
}

function readExplicitWebpackEntries(
  config: Configuration,
): EntryObject | undefined {
  const entry = config.entry;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return undefined;
  }
  return entry;
}

function snapshotFrameworkWebpackEntryImports(
  config: Configuration,
): ReadonlyMap<string, string> {
  const entries = readExplicitWebpackEntries(config);
  if (!entries) {
    throw new Error(
      `[evjs] Webpack config "${config.name ?? "unnamed"}" must define framework entries as a static entry object.`,
    );
  }

  return new Map(
    Object.entries(entries).map(([entryName, entry]) => {
      const entryImport = readSingleWebpackEntryImport(entry);
      if (entryImport === undefined) {
        throw new Error(
          `[evjs] Webpack config "${config.name ?? "unnamed"}" framework entry "${entryName}" must have exactly one BuildPlan import.`,
        );
      }
      return [entryName, entryImport];
    }),
  );
}

function readSingleWebpackEntryImport(entry: unknown): string | undefined {
  const entryImport = readWebpackEntryImport(entry);
  if (typeof entryImport === "string") return entryImport;
  if (Array.isArray(entryImport)) {
    return entryImport.length === 1 && typeof entryImport[0] === "string"
      ? entryImport[0]
      : undefined;
  }
  return undefined;
}

function formatWebpackEntryImport(entry: unknown): string {
  const entryImport = readWebpackEntryImport(entry);
  if (typeof entryImport === "string" || Array.isArray(entryImport)) {
    return JSON.stringify(entryImport);
  }
  return "<missing>";
}

function readWebpackEntryImport(entry: unknown): unknown {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  return Reflect.get(entry as Record<PropertyKey, unknown>, "import");
}

function snapshotWebpackOutputTemplates(
  config: Configuration,
): WebpackOutputTemplateSnapshot {
  return Object.fromEntries(
    WEBPACK_OUTPUT_TEMPLATE_FIELDS.map((field) => [
      field,
      config.output?.[field],
    ]),
  ) as WebpackOutputTemplateSnapshot;
}

function assertWebpackOutputTemplates(
  config: Configuration,
  expectation: FrameworkWebpackOutputExpectation,
): void {
  for (const field of WEBPACK_OUTPUT_TEMPLATE_FIELDS) {
    const actual = config.output?.[field];
    const expected = expectation.templates[field];
    if (Object.is(actual, expected)) continue;
    throw new Error(
      `[evjs] Webpack config "${expectation.configName}" output.${field} ${formatOutputTemplate(actual)} must remain the framework-owned template ${formatOutputTemplate(expected)}. configureBundler hooks cannot override framework output file templates.`,
    );
  }

  if (!expectation.cssPlugin || !expectation.cssTemplates) return;
  if (!config.plugins?.includes(expectation.cssPlugin)) {
    throw new Error(
      `[evjs] Webpack config "${expectation.configName}" must preserve the framework-owned MiniCssExtractPlugin instance.`,
    );
  }
  const actualCssTemplates = snapshotMiniCssOutputTemplates(
    expectation.cssPlugin,
  );
  for (const field of ["filename", "chunkFilename"] as const) {
    if (Object.is(actualCssTemplates[field], expectation.cssTemplates[field])) {
      continue;
    }
    throw new Error(
      `[evjs] Webpack config "${expectation.configName}" MiniCssExtractPlugin ${field} ${formatOutputTemplate(actualCssTemplates[field])} must remain the framework-owned template ${formatOutputTemplate(expectation.cssTemplates[field])}. configureBundler hooks cannot override framework CSS output file templates.`,
    );
  }
}

function snapshotMiniCssOutputTemplates(
  plugin: MiniCssExtractPlugin,
): MiniCssOutputTemplateSnapshot {
  const options = (
    plugin as unknown as {
      options?: { filename?: unknown; chunkFilename?: unknown };
    }
  ).options;
  return {
    filename: options?.filename,
    chunkFilename: options?.chunkFilename,
  };
}

function formatOutputTemplate(value: unknown): string {
  if (value === undefined) return "<unset>";
  if (typeof value === "function") return "<function>";
  return JSON.stringify(value);
}

function assertOwnedWebpackCleanOutput(
  cwd: string,
  candidate: { configName: string; field: string; path: string },
  outputPaths: ResolvedBuildOutputPaths,
  previous: Array<{ configName: string; field: string; path: string }>,
): void {
  const candidatePath = path.resolve(cwd, candidate.path);
  const candidateDisplayPath = formatProjectRelativeOutputPath(
    cwd,
    candidatePath,
  );
  const expectedPath =
    candidate.field === "output.client"
      ? path.resolve(cwd, outputPaths.clientDir)
      : candidate.field === "output.server"
        ? path.resolve(cwd, outputPaths.serverDir)
        : undefined;
  if (!expectedPath || candidatePath !== expectedPath) {
    for (const [ownedField, ownedPath] of [
      ["output.client", path.resolve(cwd, outputPaths.clientDir)],
      ["output.server", path.resolve(cwd, outputPaths.serverDir)],
    ] as const) {
      if (!outputPathsOverlap(candidatePath, ownedPath)) continue;
      throw new Error(
        `[evjs] Webpack config "${candidate.configName}" clean output "${candidateDisplayPath}" must not overlap framework-owned ${ownedField} directory "${formatProjectRelativeOutputPath(cwd, ownedPath)}".`,
      );
    }
  }

  for (const existing of previous) {
    const existingPath = path.resolve(cwd, existing.path);
    if (!outputPathsOverlap(candidatePath, existingPath)) continue;
    throw new Error(
      `[evjs] Webpack config "${candidate.configName}" clean output "${candidateDisplayPath}" must not overlap Webpack config "${existing.configName}" clean output "${formatProjectRelativeOutputPath(cwd, existingPath)}".`,
    );
  }
}

function isStrictDescendantOutputPath(
  root: string,
  candidate: string,
): boolean {
  const rootKey = canonicalOutputPathKey(root);
  const candidateKey = canonicalOutputPathKey(candidate);
  const descendantPrefix = rootKey.endsWith("/") ? rootKey : `${rootKey}/`;
  return candidateKey !== rootKey && candidateKey.startsWith(descendantPrefix);
}

function canonicalOutputPathKey(outputPath: string): string {
  return canonicalPortableArtifactPathKey(
    path.resolve(outputPath).split(path.sep).join("/"),
  );
}

function outputPathsOverlap(left: string, right: string): boolean {
  return (
    canonicalOutputPathKey(left) === canonicalOutputPathKey(right) ||
    isStrictDescendantOutputPath(left, right) ||
    isStrictDescendantOutputPath(right, left)
  );
}

function formatProjectRelativeOutputPath(
  cwd: string,
  outputPath: string,
): string {
  const relative = path.relative(path.resolve(cwd), path.resolve(outputPath));
  if (path.isAbsolute(relative)) return "<outside-project>";
  return (relative || ".").split(path.sep).join("/");
}

function getWebpackOutputField(config: Configuration): string {
  if (config.name === "client") return "output.client";
  if (config.name === "server" || config.name === "server-rsc") {
    return "output.server";
  }
  return `Webpack config "${config.name ?? "unnamed"}" output.path`;
}

function missingFrameworkWatchCollector(file: string): never {
  throw new Error(
    `[evjs] Cannot watch plugin dependency "${file}" because the webpack config was created without a framework watch collector.`,
  );
}

function createWebpackConfig(options: {
  cwd: string;
  entries: BuildEntry[];
  mode: BuildPlan["mode"];
  name: string;
  outputPath: string;
  publicPath: PublicPathOutput;
  resolveAlias?: NonNullable<BuildPlan["resolve"]>["alias"];
  resolveExternal?: NonNullable<BuildPlan["resolve"]>["external"];
  functionEndpoint: string;
  crossOriginLoading:
    | ResolvedConfig["output"]["crossOriginLoading"]
    | undefined;
  rscClientReferences: RscClientReferenceConfig[];
  enableRscClientRuntime: boolean;
  reactServerConditions: boolean;
  clean: boolean;
  target: "web" | "node";
}): Configuration {
  const isProduction = options.mode === "production";
  const outputExtension = options.target === "node" ? ".cjs" : ".js";
  const chunkDirectory =
    options.target === "node" ? `chunks/${options.name}` : undefined;

  return {
    name: options.name,
    mode: options.mode,
    context: options.cwd,
    target: options.target,
    entry: createEntryObject(options.entries),
    output: {
      path: options.outputPath,
      filename: isProduction
        ? `[name].[contenthash:8]${outputExtension}`
        : `[name]${outputExtension}`,
      chunkFilename: isProduction
        ? `${chunkDirectory ? `${chunkDirectory}/` : ""}[name].[contenthash:8]${outputExtension}`
        : `${chunkDirectory ? `${chunkDirectory}/` : ""}[name]${outputExtension}`,
      publicPath: webpackPublicPath(options.publicPath, options.target),
      crossOriginLoading:
        options.target === "web" ? options.crossOriginLoading : undefined,
      clean: options.clean,
      library:
        options.target === "node"
          ? {
              type: "commonjs2",
            }
          : undefined,
      asyncChunks: options.target === "node" ? false : undefined,
    },
    externals: createWebpackExternals(options),
    devtool: isProduction ? false : "source-map",
    experiments: {
      futureDefaults: true,
      css: false,
    },
    resolve: {
      extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".json"],
      alias: createResolveAlias(options.cwd, {
        ...(options.resolveAlias ?? {}),
        ...(options.reactServerConditions
          ? {
              "@evjs/client$": clientRscPageContextEntry,
              "@evjs/ev/route$": evRouteRscEntry,
            }
          : {}),
      }),
      ...(options.reactServerConditions
        ? {
            conditionNames: [
              "react-server",
              "import",
              "module",
              "node",
              "default",
            ],
          }
        : {}),
    },
    module: {
      rules: [
        {
          test: /\.[cm]?[jt]sx?$/,
          exclude: /node_modules/,
          use: [
            {
              loader: swcLoader,
              options: {
                jsc: {
                  parser: {
                    syntax: "typescript",
                    tsx: true,
                  },
                  transform: {
                    react: {
                      runtime: "automatic",
                    },
                  },
                },
              },
            },
            {
              loader: serverFunctionLoader,
              options: {
                rootContext: options.cwd,
                isServer: options.target === "node",
              },
            },
            ...(options.target === "node" && options.reactServerConditions
              ? [
                  {
                    loader: rscClientReferenceLoader,
                  },
                ]
              : []),
          ],
        },
        {
          test: /\.css$/,
          use: [miniCssExtractLoader, cssLoader],
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        "process.env.EVJS_FUNCTION_ENDPOINT": JSON.stringify(
          options.functionEndpoint,
        ),
        __EVJS_FUNCTION_ENDPOINT__: JSON.stringify(options.functionEndpoint),
      }),
      new MiniCssExtractPlugin({
        ...(options.target === "web" && options.crossOriginLoading
          ? { attributes: { crossorigin: options.crossOriginLoading } }
          : {}),
        ...(chunkDirectory
          ? {
              filename: isProduction
                ? "[name].[contenthash:8].css"
                : "[name].css",
              chunkFilename: isProduction
                ? `${chunkDirectory}/[name].[contenthash:8].css`
                : `${chunkDirectory}/[name].css`,
            }
          : {}),
      }),
      ...createRscPlugins(options),
    ],
    stats: {
      assets: true,
      entrypoints: true,
    },
    infrastructureLogging: isProduction ? undefined : { level: "warn" },
    optimization: {
      moduleIds: "deterministic",
      runtimeChunk: false,
      splitChunks: options.target === "node" ? false : undefined,
    },
  };
}

function createResolveAlias(
  cwd: string,
  alias: Record<string, string>,
): NonNullable<Configuration["resolve"]>["alias"] {
  return Object.fromEntries(
    Object.entries(alias).map(([name, target]) => [
      name,
      resolveAliasTarget(cwd, target),
    ]),
  );
}

function resolveAliasTarget(cwd: string, target: string): string {
  if (path.isAbsolute(target)) return target;
  return target.startsWith(".") ? path.resolve(cwd, target) : target;
}

function createWebpackExternals(options: {
  target: "web" | "node";
  reactServerConditions: boolean;
  resolveExternal?: NonNullable<BuildPlan["resolve"]>["external"];
}): Configuration["externals"] {
  const contributed = Object.fromEntries(
    Object.entries(options.resolveExternal ?? {})
      .filter(([, external]) =>
        options.target === "web"
          ? external.runtime !== "server"
          : external.runtime !== "client",
      )
      .map(([specifier, external]) => [
        specifier,
        external.source ?? specifier,
      ]),
  );
  const hasContributed = Object.keys(contributed).length > 0;
  const defaultNodeExternals =
    options.target === "node" && !options.reactServerConditions
      ? {
          react: "commonjs react",
          "react-dom": "commonjs react-dom",
          "react-dom/client": "commonjs react-dom/client",
          "react-dom/server": "commonjs react-dom/server",
          "react-dom/server.node": "commonjs react-dom/server.node",
          "react/jsx-dev-runtime": "commonjs react/jsx-dev-runtime",
          "react/jsx-runtime": "commonjs react/jsx-runtime",
        }
      : undefined;

  if (defaultNodeExternals && hasContributed) {
    return [defaultNodeExternals, contributed];
  }
  return defaultNodeExternals ?? (hasContributed ? contributed : undefined);
}

function createRscPlugins(options: {
  target: "web" | "node";
  enableRscClientRuntime: boolean;
  rscClientReferences: RscClientReferenceConfig[];
}): NonNullable<Configuration["plugins"]> {
  if (options.target !== "web" || !options.enableRscClientRuntime) return [];

  return [
    new ReactFlightWebpackPlugin({
      isServer: false,
      clientReferences: options.rscClientReferences,
      clientManifestFilename: "react-client-manifest.json",
      serverConsumerManifestFilename: "react-ssr-manifest.json",
    }),
  ];
}

function createEntryObject(entries: BuildEntry[]): EntryObject {
  return Object.fromEntries(
    entries.map((entry) => [
      entry.name,
      {
        import: createEntryImport(entry),
      },
    ]),
  );
}

function createEntryImport(entry: BuildEntry): string {
  if (entry.name === "evjs-rsc-client" && entry.kind === "runtime") {
    return clientRscEntry;
  }
  return entry.import;
}

function webpackPublicPath(
  publicPath: PublicPathOutput,
  target: "web" | "node",
): string {
  if (target === "node" && publicPath === "auto") return "/";
  return publicPath;
}

function getRscClientReferenceModules(
  cwd: string,
  clientReferenceModules: string[],
): RscClientReferenceConfig[] {
  const modules = [
    ...new Set(
      clientReferenceModules.map((module) =>
        normalizeRealPath(
          path.isAbsolute(module) ? module : path.resolve(cwd, module),
        ),
      ),
    ),
  ];

  return modules.map((modulePath) => ({
    directory: path.dirname(modulePath),
    recursive: false,
    include: new RegExp(`${escapeRegExp(path.basename(modulePath))}$`),
  }));
}

function normalizeRealPath(file: string): string {
  try {
    return fs.realpathSync.native(file);
  } catch {
    return file;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
