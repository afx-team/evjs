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

import { SERVER_FUNCTION_TRANSFORM_RUNTIME } from "@evjs/ev/_internal/build";
import type {
  BuildPlan,
  ServerAppEntryMetadata,
} from "@evjs/ev/_internal/manifest";
import type { ResolvedConfig } from "@evjs/ev/config";
import type { BundlerCtx, PluginHooks } from "@evjs/ev/plugin";
import { getLogger } from "@logtape/logtape";
import type {
  ConfigComplete,
  DevServerProxy,
  ExternalConfig,
  ProxyRule,
} from "@utoo/pack";
import { getOutputPaths } from "./output-paths.js";

const logger = getLogger(["evjs", "bundler-utoopack", "config"]);
const lessImplementation = require.resolve("less");
const lessLoader = require.resolve("less-loader");

function createSpaHistoryFallbackRule(
  config: ResolvedConfig<ConfigComplete>,
  plan: BuildPlan,
): ProxyRule {
  const target = new URL(
    config.dev.https ? "https://localhost" : "http://localhost",
  );
  target.port = String(config.dev.port);

  return {
    context: [createSpaHistoryFallbackContext(config, plan)],
    target: target.origin,
    changeOrigin: true,
    secure: false,
    pathRewrite: {
      "^/.*$": "/",
    },
  };
}

function createSpaHistoryFallbackContext(
  config: ResolvedConfig<ConfigComplete>,
  plan: BuildPlan,
): string {
  const exclusions = createSpaHistoryFallbackExclusions(config, plan)
    .map(normalizeRoutePrefix)
    .filter((prefix) => prefix !== "/")
    .map((prefix) => `(?!${escapeRegExp(prefix.slice(1))}(?:/|$))`)
    .join("");

  return `^/${exclusions}(?!turbopack-hmr$)(?!.*\\.[^/]+$).+`;
}

function createSpaHistoryFallbackExclusions(
  config: ResolvedConfig<ConfigComplete>,
  plan: BuildPlan,
): string[] {
  const exclusions = new Set(["/api"]);

  exclusions.add(config.server.runtime.basePath);
  exclusions.add(config.server.runtime.fn);
  exclusions.add(config.server.runtime.ppr);
  if (config.server.runtime.rsc) {
    exclusions.add(config.server.runtime.rsc);
  }
  for (const context of toUniqueDevProxyContexts(getServerRoutePaths(plan))) {
    exclusions.add(context);
  }

  return [...exclusions];
}

function normalizeRoutePrefix(prefix: string): string {
  const withLeadingSlash = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/, "")
    : withLeadingSlash;
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
): Promise<ConfigComplete> {
  validateUtoopackPlanSupport(plan);

  const mode = plan.mode;
  const isProduction = mode === "production";
  const devProxy: DevServerProxy = [
    ...config.dev.proxy,
    ...createServerRouteProxyRules(config, plan, config.dev.proxy),
    ...(hasAppClientEntry(plan)
      ? [createSpaHistoryFallbackRule(config, plan)]
      : []),
  ];

  const finalServerEntry = resolveServerEntry(plan);

  const outputPaths = getOutputPaths(cwd, config.output, plan.distDir);

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
        config.server.runtime.fn,
      ),
      "process.env.NODE_ENV": JSON.stringify(mode),
      __EVJS_FUNCTION_ENDPOINT__: JSON.stringify(config.server.runtime.fn),
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

  // Run plugin bundler hooks
  const ctx: BundlerCtx<ConfigComplete> = {
    mode: isProduction ? "production" : "development",
    command: isProduction ? "build" : "dev",
    cwd,
    config,
    bundlerName: "utoopack",
    environment: finalServerEntry ? "mixed" : "client",
    logger,
    addWatchFile() {},
  };

  for (const h of hooks) {
    if (h.bundlerConfig) {
      await h.bundlerConfig(utoopackConfig, ctx);
    }
  }

  return utoopackConfig;
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
    `[evjs] The current Utoopack adapter cannot map server-only resolve.external contributions while client entries are present: ${serverOnly.join(", ")}. Use runtime "client" or "all", switch bundlers, or configure the lower-level bundler directly until Utoopack exposes server-scoped externals.`,
  );
}

function getServerRoutesEntry(
  plan: BuildPlan,
):
  | (BuildPlan["entries"][number] & { metadata: ServerAppEntryMetadata })
  | undefined {
  return plan.entries.find(
    (
      entry,
    ): entry is BuildPlan["entries"][number] & {
      metadata: ServerAppEntryMetadata;
    } => entry.metadata?.type === "server-app",
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
    `[evjs] The current Utoopack adapter cannot build framework server page entries yet (${details}). Unsupported entry kinds: ${kinds}. Utoopack needs multi server entry support; use another bundler adapter for SSR/PPR/RSC validation until that lower-layer API is available.`,
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

function createServerRouteProxyRules(
  config: ResolvedConfig<ConfigComplete>,
  plan: BuildPlan,
  existingRules: DevServerProxy,
): ProxyRule[] {
  const configuredContexts = new Set(
    existingRules.flatMap((rule) => getProxyRuleContexts(rule)),
  );
  const contexts = toUniqueDevProxyContexts(getServerRoutePaths(plan)).filter(
    (context) => !configuredContexts.has(context),
  );
  if (
    getServerRoutePaths(plan).some(
      (routePath) => normalizeRoutePath(routePath) === "/",
    ) &&
    !configuredContexts.has("^/$")
  ) {
    contexts.push("^/$");
  }
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

function getProxyRuleContexts(rule: { context: string | string[] }): string[] {
  return Array.isArray(rule.context) ? rule.context : [rule.context];
}

function getServerRoutePaths(plan: BuildPlan): string[] {
  return (
    getServerRoutesEntry(plan)?.metadata.routes.map((route) => route.path) ?? []
  );
}

function toDevProxyContext(routePath: string): string | undefined {
  const segments = routePath.split("/").filter(Boolean);
  const staticSegments: string[] = [];

  for (const segment of segments) {
    if (
      segment === "*" ||
      segment.startsWith(":") ||
      segment.startsWith("$") ||
      segment.includes("*")
    ) {
      break;
    }
    staticSegments.push(segment);
  }

  if (staticSegments.length === 0) return undefined;
  return `/${staticSegments.join("/")}`;
}

function toUniqueDevProxyContexts(routePaths: string[]): string[] {
  const contexts = new Set<string>();
  for (const routePath of routePaths) {
    const context = toDevProxyContext(routePath);
    if (context) contexts.add(context);
  }
  return [...contexts];
}

function normalizeRoutePath(routePath: string): string {
  if (!routePath.startsWith("/")) return `/${routePath}`;
  return routePath.replace(/\/+$/, "") || "/";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
