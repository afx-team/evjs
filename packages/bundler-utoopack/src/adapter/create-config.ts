/**
 * Map ResolvedEvConfig to a utoopack configuration object.
 *
 * Utoopack uses a JSON-based config with `build()` / `dev()` programmatic API.
 * Unlike webpack, it handles "use server" directives natively via the
 * `server.functions.callServerModule` config field.
 */

import path from "node:path";
import type { EvBundlerCtx, EvPluginHooks, ResolvedEvConfig } from "@evjs/ev";
import type { ConfigComplete } from "@utoo/pack";

/**
 * Create a utoopack configuration object from EvConfig.
 *
 * @param config - Resolved evjs config
 * @param cwd - Project root directory
 * @param hooks - Plugin lifecycle hooks
 * @returns A config object suitable for `@utoo/pack`'s `build()` / `dev()` API
 */
export function createUtoopackConfig(
  config: ResolvedEvConfig,
  cwd: string,
  hooks: EvPluginHooks[],
): ConfigComplete {
  const isProduction = process.env.NODE_ENV === "production";
  const serverEnabled = config.serverEnabled;

  const utoopackConfig: ConfigComplete = {
    mode: isProduction ? "production" : "development",
    entry: [
      {
        import: config.entry,
        html: {
          template: path.resolve(cwd, config.html),
        },
      },
    ],
    output: {
      path: path.resolve(cwd, serverEnabled ? "dist/client" : "dist"),
      filename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
      chunkFilename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
      publicPath: isProduction ? config.assetPrefix : "/",
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
            output: {
              path: path.resolve(cwd, "dist/server"),
              filename: isProduction
                ? "[name].[contenthash:8].js"
                : "[name].js",
              chunkFilename: isProduction
                ? "[name].[contenthash:8].js"
                : "[name].js",
            },
            functions: {
              clientProxy: "@evjs/client/transport",
              serverRegister: "@evjs/server/register",
            } as any, // 1.4.0-alpha.3 types might be lagging behind the runtime implementation
          },
        }
      : {}),

    // Dev server configuration
    devServer: {
      hot: true,
    },
  };

  // Run plugin bundler hooks
  const ctx: EvBundlerCtx = {
    mode: isProduction ? "production" : "development",
    config,
  };

  for (const h of hooks) {
    if (h.bundler) {
      h.bundler(utoopackConfig, ctx);
    }
  }

  return utoopackConfig;
}
