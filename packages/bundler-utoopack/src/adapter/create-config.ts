/**
 * Map ResolvedEvConfig to a utoopack configuration object.
 *
 * Utoopack uses a JSON-based config with `build()` / `dev()` programmatic API.
 * It handles "use server" directives natively via the
 * `server.functions.callServerModule` config field.
 */

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

import type { EvBundlerCtx, EvPluginHooks, ResolvedEvConfig } from "@evjs/ev";
import { isMpa } from "@evjs/ev";
import type { ConfigComplete, DevServerProxy, ProxyRule } from "@utoo/pack";
import { prepareRouteMarkers } from "../route-markers.js";

function createSpaHistoryFallbackRule(
  config: ResolvedEvConfig<ConfigComplete>,
): ProxyRule {
  const protocol = config.dev.https ? "https" : "http";

  return {
    context: ["^/(?!api(?:/|$))(?!turbopack-hmr$)(?!.*\\.[^/]+$).+"],
    target: `${protocol}://localhost:${config.dev.port}`,
    changeOrigin: true,
    secure: false,
    pathRewrite: {
      "^/.*$": "/",
    },
  };
}

/**
 * Create a utoopack configuration object from EvConfig.
 *
 * @param config - Resolved evjs config
 * @param cwd - Project root directory
 * @param hooks - Plugin lifecycle hooks
 * @returns A config object suitable for `@utoo/pack`'s `build()` / `dev()` API
 */
export async function createUtoopackConfig(
  config: ResolvedEvConfig<ConfigComplete>,
  cwd: string,
  hooks: EvPluginHooks<ConfigComplete>[],
): Promise<ConfigComplete> {
  const isProduction = process.env.NODE_ENV === "production";
  const serverEnabled = config.serverEnabled;
  const devProxy: DevServerProxy = [
    ...config.dev.proxy,
    ...(!isMpa(config) ? [createSpaHistoryFallbackRule(config)] : []),
  ];

  let finalServerEntry: string | undefined;

  if (serverEnabled) {
    finalServerEntry =
      config.server.entry || require.resolve("@evjs/server/fetch");
  }

  if (serverEnabled && !finalServerEntry) {
    throw new Error("Failed to resolve a server entry for the server bundle.");
  }

  const routeMarkers = await prepareRouteMarkers(config, cwd, finalServerEntry);

  const utoopackConfig: ConfigComplete = {
    mode: isProduction ? "production" : "development",
    // MPA mode: one entry per page; SPA mode: single entry
    entry: routeMarkers.entries,
    output: {
      path: path.resolve(cwd, serverEnabled ? "dist/client" : "dist"),
      filename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
      chunkFilename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
      publicPath: "/",
      clean: true,
    },
    resolve: {
      extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"],
    },
    sourceMaps: !isProduction,
    stats: true,
    react: {
      runtime: "automatic",
    },
    // Server functions config — utoopack handles "use server" natively
    ...(serverEnabled
      ? {
          server: {
            entry: routeMarkers.serverEntry,
            output: {
              path: path.resolve(cwd, "dist/server"),
              filename: isProduction
                ? "[name].[contenthash:8].js"
                : "[name].js",
              chunkFilename: isProduction
                ? "[name].[contenthash:8].js"
                : "[name].js",
            },
            function: {
              clientProxy: config.server.functions.clientProxy,
              serverRegister: config.server.functions.serverRegister,
            },
          },
        }
      : {}),

    // Dev server configuration
    devServer: {
      hot: true,
      proxy: devProxy,
    },
  };

  // Run plugin bundler hooks
  const ctx: EvBundlerCtx<ConfigComplete> = {
    mode: isProduction ? "production" : "development",
    cwd,
    config,
  };

  for (const h of hooks) {
    if (h.bundlerConfig) {
      h.bundlerConfig(utoopackConfig, ctx);
    }
  }

  return utoopackConfig;
}
