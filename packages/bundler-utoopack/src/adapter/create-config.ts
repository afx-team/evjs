/**
 * Map ResolvedConfig to a utoopack configuration object.
 *
 * Utoopack uses a JSON-based config with `build()` / `dev()` programmatic API.
 * It handles "use server" directives natively via the
 * server-function runtime module config fields.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const componentPageLoader = fileURLToPath(
  new URL("./component-page-loader.cjs", import.meta.url),
);
const pagesEntryLoader = fileURLToPath(
  new URL("./pages-entry-loader.cjs", import.meta.url),
);

import type {
  BuildPlan,
  BundlerCtx,
  PagesAppEntryMetadata,
  PluginHooks,
  ReactComponentPageEntryMetadata,
  ResolvedConfig,
} from "@evjs/ev";
import { getLogger } from "@logtape/logtape";
import type {
  ConfigComplete,
  DevServerProxy,
  ProxyRule,
  TurbopackLoaderOptions,
  TurbopackRuleConfigItem,
} from "@utoo/pack";
import { getOutputPaths } from "./output-paths.js";

const logger = getLogger(["evjs", "bundler-utoopack", "config"]);

function createSpaHistoryFallbackRule(
  config: ResolvedConfig<ConfigComplete>,
): ProxyRule {
  const target = new URL(
    config.dev.https ? "https://localhost" : "http://localhost",
  );
  target.port = String(config.dev.port);

  return {
    context: ["^/(?!api(?:/|$))(?!turbopack-hmr$)(?!.*\\.[^/]+$).+"],
    target: target.origin,
    changeOrigin: true,
    secure: false,
    pathRewrite: {
      "^/.*$": "/",
    },
  };
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

  const isProduction = process.env.NODE_ENV === "production";
  const mode = isProduction ? "production" : "development";
  const serverEnabled = config.serverEnabled;
  const frameworkRules = createFrameworkModuleRules(plan);
  const devProxy: DevServerProxy = [
    ...config.dev.proxy,
    ...(hasAppClientEntry(plan) ? [createSpaHistoryFallbackRule(config)] : []),
  ];

  let finalServerEntry: string | undefined;

  if (serverEnabled) {
    finalServerEntry = resolveServerEntry(plan.server.entry);
  }

  if (serverEnabled && !finalServerEntry) {
    throw new Error("Failed to resolve a server entry for the server bundle.");
  }

  const outputPaths = getOutputPaths(cwd, serverEnabled);

  const utoopackConfig: ConfigComplete = {
    mode,
    entry: plan.entries
      .filter((entry) => entry.environment === "client")
      .map((entry) => ({
        import: resolveClientEntry(cwd, entry),
        name: entry.name,
      })),
    output: {
      path: outputPaths.clientDir,
      filename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
      chunkFilename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
      publicPath: toUtoopackPublicPath(plan.runtime.publicPath),
      clean: true,
    },
    resolve: {
      extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"],
    },
    ...(frameworkRules.length > 0
      ? {
          module: {
            rules: {
              "**/*": frameworkRules,
            },
          },
        }
      : {}),
    sourceMaps: !isProduction,
    stats: true,
    react: {
      runtime: "automatic",
    },
    define: {
      "process.env.EVJS_FUNCTION_ENDPOINT": JSON.stringify(
        config.server.functionRuntime.endpoint,
      ),
      "process.env.NODE_ENV": JSON.stringify(mode),
      __EVJS_FUNCTION_ENDPOINT__: JSON.stringify(
        config.server.functionRuntime.endpoint,
      ),
    },
    // Server functions config — utoopack handles "use server" natively
    ...(serverEnabled
      ? {
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
              clientProxy: config.server.functionRuntime.clientProxy,
              serverRegister: config.server.functionRuntime.serverRegister,
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
    plan,
    bundlerName: "utoopack",
    environment: "mixed",
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

function createPagesEntryRule(
  metadata: PagesAppEntryMetadata,
): TurbopackRuleConfigItem {
  return {
    condition: createPagesEntryCondition(metadata),
    loaders: [
      {
        loader: pagesEntryLoader,
        options: createPagesLoaderOptions(metadata),
      },
    ],
    type: "ecmascript",
  };
}

function createPagesEntryCondition(metadata: PagesAppEntryMetadata): {
  path: RegExp;
  query: string;
} {
  return {
    path: new RegExp(
      `${escapeRegExp(normalizeRulePath(metadata.routes[0]?.module ?? ""))}$`,
    ),
    query: "",
  };
}

function createComponentPageRule(
  metadata: ReactComponentPageEntryMetadata,
): TurbopackRuleConfigItem {
  return {
    condition: {
      path: new RegExp(
        `${escapeRegExp(normalizeRulePath(metadata.component))}$`,
      ),
      query: "",
    },
    loaders: [
      {
        loader: componentPageLoader,
        options: createComponentPageLoaderOptions(metadata),
      },
    ],
    type: "ecmascript",
  };
}

function normalizeRulePath(value: string): string {
  return value.replace(/^\.\//, "").replaceAll("\\", "/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveClientEntry(
  cwd: string,
  entry: BuildPlan["entries"][number],
): string {
  if (entry.metadata?.type !== "pages-app") return entry.import;
  if (entry.import.startsWith(".") || path.isAbsolute(entry.import)) {
    return entry.import;
  }

  try {
    return createRequire(path.join(cwd, "package.json")).resolve(entry.import);
  } catch {
    return require.resolve(entry.import);
  }
}

function getPagesAppMetadata(
  plan: BuildPlan,
): PagesAppEntryMetadata | undefined {
  const metadata = plan.entries.find(
    (entry) => entry.metadata?.type === "pages-app",
  )?.metadata;
  return metadata?.type === "pages-app" ? metadata : undefined;
}

function getComponentPageMetadata(
  plan: BuildPlan,
): ReactComponentPageEntryMetadata[] {
  return plan.entries
    .map((entry) => entry.metadata)
    .filter(
      (metadata): metadata is ReactComponentPageEntryMetadata =>
        metadata?.type === "react-component-page",
    );
}

function createFrameworkModuleRules(
  plan: BuildPlan,
): TurbopackRuleConfigItem[] {
  const pagesApp = getPagesAppMetadata(plan);
  return [
    ...(pagesApp ? [createPagesEntryRule(pagesApp)] : []),
    ...getComponentPageMetadata(plan).map(createComponentPageRule),
  ];
}

function createPagesLoaderOptions(
  metadata: PagesAppEntryMetadata,
): TurbopackLoaderOptions {
  return {
    type: "pages-app",
    mount: metadata.mount,
    routes: metadata.routes.map((route) => ({
      id: route.id,
      path: route.path,
      module: route.module,
    })),
    ...(metadata.rootModule ? { rootModule: metadata.rootModule } : {}),
  };
}

function createComponentPageLoaderOptions(
  metadata: ReactComponentPageEntryMetadata,
): TurbopackLoaderOptions {
  return {
    type: "react-component-page",
    mount: metadata.mount,
    hydrate: metadata.hydrate,
    render: metadata.render,
    ...(metadata.route ? { route: metadata.route } : {}),
  };
}

function hasAppClientEntry(plan: BuildPlan): boolean {
  return plan.entries.some((entry) => entry.kind === "app-client");
}

function validateUtoopackPlanSupport(plan: BuildPlan): void {
  const remoteClientEntries = plan.entries.filter(
    (entry) => entry.metadata?.type === "remote-client",
  );
  if (remoteClientEntries.length > 0) {
    const names = remoteClientEntries.map((entry) => entry.name).join(", ");
    throw new Error(
      `[evjs] The current Utoopack adapter cannot build framework remote client entries yet: ${names}. Utoopack needs lifecycle entry wrapping support or use another bundler adapter for manifest-driven remote validation.`,
    );
  }

  const unsupportedServerEntries = plan.entries.filter(
    (entry) =>
      entry.kind === "page-server" ||
      entry.kind === "rsc-page" ||
      entry.kind === "ppr-shell" ||
      entry.kind === "ppr-region",
  );
  if (unsupportedServerEntries.length === 0) return;

  const names = unsupportedServerEntries.map((entry) => entry.name).join(", ");
  throw new Error(
    `[evjs] The current Utoopack adapter cannot build framework server page entries yet: ${names}. Utoopack needs multi server entry support or use another bundler adapter for SSR/PPR validation.`,
  );
}

function resolveServerEntry(entry: string | undefined): string | undefined {
  if (!entry) return undefined;
  if (entry.startsWith(".") || path.isAbsolute(entry)) return entry;
  return require.resolve(entry);
}

function toUtoopackPublicPath(
  publicPath: BuildPlan["runtime"]["publicPath"],
): string {
  return typeof publicPath === "string" ? publicPath : "auto";
}
