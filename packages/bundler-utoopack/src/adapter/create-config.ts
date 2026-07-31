/**
 * Map ResolvedConfig to a utoopack configuration object.
 *
 * Utoopack uses a JSON-based config with `build()` / `dev()` programmatic API.
 * It handles "use server" directives natively via the
 * server-function runtime module config fields.
 */

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

import {
  assertPortableRelativeArtifactPath,
  assertSafeBuildOutputPaths,
  canonicalPortableArtifactPathKey,
  resolveBuildOutputPaths,
  SERVER_FUNCTION_TRANSFORM_RUNTIME,
} from "@evjs/ev/_internal/build";
import type { ResolvedConfig } from "@evjs/ev/config";
import type { BundlerCtx, PluginHooks } from "@evjs/ev/plugin";
import { pageRoutePathToRegExp } from "@evjs/shared";
import type { BuildPlan } from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import type {
  ConfigComplete,
  DevServerProxy,
  ExternalConfig,
  ProxyRule,
} from "@utoo/pack";
import {
  assertSafeUtoopackCleanOutput,
  assertUtoopackOutputPathsMatchPlan,
} from "./output-paths.js";

const logger = getLogger(["evjs", "bundler-utoopack", "config"]);
const lessImplementation = require.resolve("less");
const lessLoader = require.resolve("less-loader");
const spaHistoryFallbackRuleIndexes = new WeakMap<ConfigComplete, number>();

export function getSpaHistoryFallbackRuleIndex(
  config: ConfigComplete,
): number | undefined {
  return spaHistoryFallbackRuleIndexes.get(config);
}

function createSpaHistoryFallbackRule(
  config: ResolvedConfig<ConfigComplete>,
  plan: BuildPlan,
): ProxyRule {
  const target = new URL(
    config.dev.https ? "https://localhost" : "http://localhost",
  );
  target.port = String(config.dev.port);

  return {
    context: [createSpaHistoryFallbackContext(plan)],
    target: target.origin,
    changeOrigin: true,
    secure: false,
    pathRewrite: {
      "^/.*$": "/",
    },
  };
}

function createSpaHistoryFallbackContext(plan: BuildPlan): string {
  const exclusions = createFrameworkProxyContexts(plan)
    .map((context) => (context.startsWith("^") ? context.slice(1) : context))
    .map((context) => `(?!${context})`)
    .join("");

  return `^${exclusions}/(?!turbopack-hmr$)(?!.*\\.[^/]+$).+`;
}

/**
 * Create a utoopack configuration object from Config.
 *
 * @param config - Resolved evjs config
 * @param cwd - Project root directory
 * @param hooks - Plugin lifecycle hooks
 * @returns A config object suitable for `@utoo/pack`'s `build()` / `dev()` API
 */
export async function createUtoopackConfig(
  config: ResolvedConfig<ConfigComplete>,
  plan: BuildPlan,
  cwd: string,
  hooks: PluginHooks<ConfigComplete>[],
  addWatchFile?: (file: string) => void,
): Promise<ConfigComplete> {
  validateUtoopackPlanSupport(plan);

  const mode = plan.mode;
  const isProduction = mode === "production";
  if (!isProduction && typeof config.dev.https === "object") {
    throw new Error(
      "[evjs] The Utoopack dev server accepts dev.https only as a boolean and cannot consume custom key/cert values. Use dev.https: true for its generated certificate, or select the Webpack adapter for an explicit certificate.",
    );
  }
  const spaHistoryFallbackRule = hasAppClientEntry(plan)
    ? createSpaHistoryFallbackRule(config, plan)
    : undefined;
  const devProxy: DevServerProxy = [
    ...config.dev.proxy,
    ...createFrameworkProxyRules(config, plan),
    ...(spaHistoryFallbackRule ? [spaHistoryFallbackRule] : []),
  ];

  const finalServerEntry = resolveServerEntry(plan);

  const outputPaths = resolveBuildOutputPaths(cwd, plan);
  await assertSafeBuildOutputPaths(cwd, outputPaths);

  const utoopackConfig: ConfigComplete = {
    mode,
    entry: plan.entries
      .filter((entry) => entry.environment === "client")
      .map((entry) => ({
        import: entry.import,
        name: entry.name,
      })),
    output: {
      path: outputPaths.clientDir,
      filename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
      chunkFilename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
      cssFilename: isProduction ? "[name].[contenthash:8].css" : "[name].css",
      cssChunkFilename: isProduction
        ? "[name].[contenthash:8].css"
        : "[name].css",
      publicPath: plan.runtime.publicPath,
      crossOriginLoading: config.output.crossOriginLoading,
      clean: true,
    },
    resolve: {
      alias: createResolveAlias(cwd, plan),
      extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"],
    },
    externals: createResolveExternals(plan),
    sourceMaps: !isProduction,
    stats: true,
    ...(isProduction
      ? {
          optimization: {
            // Utoopack applies this option to both client and server outputs.
            // Scope hoisting can drop the server entry export in mixed builds.
            concatenateModules: finalServerEntry === undefined,
            removeUnusedExports: true,
            removeUnusedImports: true,
          },
        }
      : {}),
    react: {
      runtime: "automatic",
    },
    // lock less and less-loader for evjs framework
    styles: {
      less: {
        loader: lessLoader,
        implementation: lessImplementation,
      },
    },
    define: {
      "process.env.EVJS_FUNCTION_ENDPOINT": JSON.stringify(
        plan.runtime.server.fn,
      ),
      "process.env.NODE_ENV": JSON.stringify(mode),
      __EVJS_FUNCTION_ENDPOINT__: JSON.stringify(plan.runtime.server.fn),
    },
    ...(finalServerEntry
      ? {
          // Server functions config — utoopack handles "use server" natively.
          server: {
            entry: finalServerEntry,
            output: {
              path: outputPaths.serverDir,
              filename: isProduction
                ? "[name].[contenthash:8].js"
                : "[name].js",
              chunkFilename: isProduction
                ? "[name].[contenthash:8].js"
                : "[name].js",
            },
            function: {
              clientProxy: SERVER_FUNCTION_TRANSFORM_RUNTIME.clientModule,
              serverRegister: SERVER_FUNCTION_TRANSFORM_RUNTIME.serverModule,
            },
          },
        }
      : {}),

    // Dev server configuration
    devServer: {
      hot: true,
      port: config.dev.port,
      https: config.dev.https !== false,
      proxy: devProxy,
    },
  };
  const outputTemplateExpectation =
    snapshotUtoopackOutputTemplates(utoopackConfig);
  const frameworkEntryNames = utoopackConfig.entry.flatMap((entry) =>
    entry.name ? [entry.name] : [],
  );

  // Run plugin bundler hooks
  const ctx: BundlerCtx<ConfigComplete> = {
    mode: isProduction ? "production" : "development",
    command: isProduction ? "build" : "dev",
    cwd,
    config,
    bundlerName: "utoopack",
    environment: finalServerEntry ? "mixed" : "client",
    logger,
    addWatchFile: addWatchFile ?? missingFrameworkWatchCollector,
  };

  for (const h of hooks) {
    if (h.bundlerConfig) {
      await h.bundlerConfig(utoopackConfig, ctx);
      assertUtoopackOutputPathsMatchPlan(cwd, utoopackConfig, outputPaths, {
        requireServerOutput: finalServerEntry !== undefined,
      });
      assertUtoopackOutputTemplatesMatchFramework(
        utoopackConfig,
        outputTemplateExpectation,
      );
      assertUtoopackArtifactNames(utoopackConfig, frameworkEntryNames);
      await assertSafeUtoopackCleanOutput(cwd, utoopackConfig, outputPaths);
    }
  }

  assertUtoopackOutputPathsMatchPlan(cwd, utoopackConfig, outputPaths, {
    requireServerOutput: finalServerEntry !== undefined,
  });
  assertUtoopackOutputTemplatesMatchFramework(
    utoopackConfig,
    outputTemplateExpectation,
  );
  assertUtoopackArtifactNames(utoopackConfig, frameworkEntryNames);
  await assertSafeUtoopackCleanOutput(cwd, utoopackConfig, outputPaths);

  if (
    spaHistoryFallbackRule &&
    utoopackConfig.devServer?.proxy?.includes(spaHistoryFallbackRule)
  ) {
    spaHistoryFallbackRuleIndexes.set(
      utoopackConfig,
      utoopackConfig.devServer.proxy.indexOf(spaHistoryFallbackRule),
    );
  }

  return utoopackConfig;
}

const UTOOPACK_CLIENT_OUTPUT_TEMPLATE_FIELDS = [
  "filename",
  "chunkFilename",
  "cssFilename",
  "cssChunkFilename",
  "assetModuleFilename",
] as const;
const UTOOPACK_SERVER_OUTPUT_TEMPLATE_FIELDS = [
  "filename",
  "chunkFilename",
] as const;

type UtoopackClientOutputTemplateField =
  (typeof UTOOPACK_CLIENT_OUTPUT_TEMPLATE_FIELDS)[number];
type UtoopackServerOutputTemplateField =
  (typeof UTOOPACK_SERVER_OUTPUT_TEMPLATE_FIELDS)[number];

interface UtoopackOutputTemplateExpectation {
  client: Record<UtoopackClientOutputTemplateField, unknown>;
  server?: Record<UtoopackServerOutputTemplateField, unknown>;
}

function snapshotUtoopackOutputTemplates(
  config: ConfigComplete,
): UtoopackOutputTemplateExpectation {
  return {
    client: Object.fromEntries(
      UTOOPACK_CLIENT_OUTPUT_TEMPLATE_FIELDS.map((field) => [
        field,
        config.output?.[field],
      ]),
    ) as Record<UtoopackClientOutputTemplateField, unknown>,
    ...(config.server
      ? {
          server: Object.fromEntries(
            UTOOPACK_SERVER_OUTPUT_TEMPLATE_FIELDS.map((field) => [
              field,
              config.server?.output?.[field],
            ]),
          ) as Record<UtoopackServerOutputTemplateField, unknown>,
        }
      : {}),
  };
}

function assertUtoopackOutputTemplatesMatchFramework(
  config: ConfigComplete,
  expectation: UtoopackOutputTemplateExpectation,
): void {
  for (const field of UTOOPACK_CLIENT_OUTPUT_TEMPLATE_FIELDS) {
    assertUtoopackOutputTemplate(
      `Utoopack output.${field}`,
      config.output?.[field],
      expectation.client[field],
    );
  }

  if (!expectation.server) {
    if (config.server) {
      throw new Error(
        "[evjs] Utoopack bundlerConfig hooks cannot add a server build that is not owned by the active BuildPlan.",
      );
    }
    return;
  }
  for (const field of UTOOPACK_SERVER_OUTPUT_TEMPLATE_FIELDS) {
    assertUtoopackOutputTemplate(
      `Utoopack server.output.${field}`,
      config.server?.output?.[field],
      expectation.server[field],
    );
  }
}

function assertUtoopackOutputTemplate(
  field: string,
  actual: unknown,
  expected: unknown,
): void {
  if (Object.is(actual, expected)) return;
  throw new Error(
    `[evjs] ${field} ${formatUtoopackOutputTemplate(actual)} must remain the framework-owned template ${formatUtoopackOutputTemplate(expected)}. bundlerConfig hooks cannot override framework output file templates.`,
  );
}

function formatUtoopackOutputTemplate(value: unknown): string {
  return value === undefined ? "<unset>" : JSON.stringify(value);
}

function assertUtoopackArtifactNames(
  config: ConfigComplete,
  frameworkEntryNames: string[],
): void {
  if (!Array.isArray(config.entry)) {
    throw new Error(
      "[evjs] Utoopack bundlerConfig hooks must preserve the static entry list so framework entry names can be validated.",
    );
  }

  const namedEntries = config.entry.flatMap((entry) =>
    typeof entry.name === "string" ? [entry.name] : [],
  );
  assertPortableUtoopackNames(namedEntries, "Utoopack entry");
  for (const expectedName of frameworkEntryNames) {
    const matches = namedEntries.filter((name) => name === expectedName);
    if (matches.length === 1) continue;
    throw new Error(
      `[evjs] Utoopack bundlerConfig hooks must preserve framework entry name "${expectedName}" exactly once; found ${matches.length}.`,
    );
  }

  const splitChunkNames = Object.keys(config.optimization?.splitChunks ?? {});
  assertPortableUtoopackNames(splitChunkNames, "Utoopack split chunk");
}

function assertPortableUtoopackNames(names: string[], field: string): void {
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

function missingFrameworkWatchCollector(file: string): never {
  throw new Error(
    `[evjs] Cannot watch plugin dependency "${file}" because the Utoopack config was created without a framework watch collector.`,
  );
}

function createResolveAlias(
  cwd: string,
  plan: BuildPlan,
): NonNullable<ConfigComplete["resolve"]>["alias"] {
  return Object.fromEntries(
    Object.entries(plan.resolve?.alias ?? {}).map(([name, target]) => [
      name,
      resolveAliasTarget(cwd, target),
    ]),
  );
}

function resolveAliasTarget(cwd: string, target: string): string {
  if (path.isAbsolute(target)) return target;
  return target.startsWith(".") ? path.resolve(cwd, target) : target;
}

function createResolveExternals(
  plan: BuildPlan,
): Record<string, ExternalConfig> | undefined {
  assertSupportedResolveExternals(plan);
  const external = Object.fromEntries(
    Object.entries(plan.resolve?.external ?? {})
      .filter(([, value]) => value.runtime !== "server")
      .map(([specifier, value]) => [specifier, value.source ?? specifier]),
  );
  return Object.keys(external).length > 0 ? external : undefined;
}

function assertSupportedResolveExternals(plan: BuildPlan): void {
  if (!hasClientEntries(plan)) return;

  const serverOnly = Object.entries(plan.resolve?.external ?? {})
    .filter(([, value]) => value.runtime === "server")
    .map(([specifier]) => specifier);
  if (serverOnly.length === 0) return;

  throw new Error(
    `[evjs] The Utoopack adapter cannot map server-only resolve.external contributions while client entries are present: ${serverOnly.join(", ")}. Use runtime "client" or "all", switch to a bundler with server-scoped externals, or configure the lower-level bundler directly.`,
  );
}

function hasAppClientEntry(plan: BuildPlan): boolean {
  return plan.entries.some((entry) => entry.kind === "app-client");
}

function hasClientEntries(plan: BuildPlan): boolean {
  return plan.entries.some((entry) => entry.environment === "client");
}

function validateUtoopackPlanSupport(plan: BuildPlan): void {
  const unsupportedServerEntries = plan.entries.filter(
    (entry) =>
      entry.kind === "page-server" ||
      entry.kind === "rsc-page" ||
      entry.kind === "ppr-shell" ||
      entry.kind === "ppr-region",
  );
  if (unsupportedServerEntries.length === 0) return;

  const details = unsupportedServerEntries
    .map(formatUnsupportedServerEntry)
    .join("; ");
  const kinds = [
    ...new Set(unsupportedServerEntries.map((entry) => entry.kind)),
  ].join(", ");
  throw new Error(
    `[evjs] The Utoopack adapter cannot build framework server page entries (${details}). Unsupported entry kinds: ${kinds}. Use a bundler adapter that supports multiple server entries for SSR/PPR/RSC validation.`,
  );
}

function formatUnsupportedServerEntry(
  entry: BuildPlan["entries"][number],
): string {
  const owner = formatBuildEntryOwner(entry.owner);
  return `${entry.name} (${entry.kind}${owner ? `, ${owner}` : ""})`;
}

function formatBuildEntryOwner(
  owner: BuildPlan["entries"][number]["owner"],
): string | undefined {
  if (!owner) return undefined;

  const parts: string[] = [];
  if (owner.pageId) parts.push(`page "${owner.pageId}"`);
  if (owner.routeId) parts.push(`route "${owner.routeId}"`);
  if (owner.regionId) parts.push(`region "${owner.regionId}"`);
  if (owner.appId) parts.push(`app "${owner.appId}"`);

  return parts.join(", ") || undefined;
}

function resolveServerEntry(plan: BuildPlan): string | undefined {
  const entry = plan.server.entry;
  if (!entry) return undefined;
  if (entry.startsWith(".") || path.isAbsolute(entry)) return entry;
  return require.resolve(entry);
}

function createFrameworkProxyRules(
  config: ResolvedConfig<ConfigComplete>,
  plan: BuildPlan,
): ProxyRule[] {
  const contexts = createFrameworkProxyContexts(plan);
  if (contexts.length === 0) return [];

  const target = new URL(
    config.server.dev.https ? "https://localhost" : "http://localhost",
  );
  target.port = String(config.server.dev.port);

  return [
    {
      context: contexts,
      target: target.origin,
      changeOrigin: true,
      secure: false,
    },
  ];
}

function createFrameworkProxyContexts(plan: BuildPlan): string[] {
  return [
    ...new Set([
      ...createFrameworkRuntimeProxyContexts(plan),
      ...createRouteProxyContexts([
        ...plan.dev.serverRequestRoutePaths,
        ...plan.dev.serverRenderedPagePaths,
      ]),
    ]),
  ];
}

function createFrameworkRuntimeProxyContexts(plan: BuildPlan): string[] {
  const runtime = plan.runtime.server;
  return [
    createExactProxyContext(runtime.fn),
    ...(runtime.ppr ? [createSubtreeProxyContext(runtime.ppr)] : []),
    ...(runtime.rsc ? [createExactProxyContext(runtime.rsc)] : []),
  ];
}

function createRouteProxyContexts(routePaths: string[]): string[] {
  return [
    ...new Set(
      routePaths.map(
        (routePath) =>
          pageRoutePathToRegExp(normalizeRoutePath(routePath)).source,
      ),
    ),
  ];
}

function createExactProxyContext(routePath: string): string {
  return pageRoutePathToRegExp(normalizeRoutePath(routePath)).source;
}

function createSubtreeProxyContext(routePath: string): string {
  const root = normalizeRoutePath(routePath);
  return pageRoutePathToRegExp(root === "/" ? "/$" : `${root}/$`).source;
}

function normalizeRoutePath(routePath: string): string {
  if (!routePath.startsWith("/")) return `/${routePath}`;
  return routePath.replace(/\/+$/, "") || "/";
}
