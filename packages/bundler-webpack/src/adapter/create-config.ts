import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { EvBundlerCtx, EvPluginHooks, ResolvedEvConfig } from "@evjs/ev";

const esmRequire = createRequire(import.meta.url);

/**
 * Create a webpack configuration object from EvConfig.
 *
 * Returns a plain object that can be passed directly to the webpack Node API.
 * No temp files are generated.
 */
export function createWebpackConfig(
  config: ResolvedEvConfig,
  cwd: string,
  hooks: EvPluginHooks[],
): Record<string, unknown> {
  const { entry, html } = config;
  const clientPort = config.dev.port;
  const serverPort = config.server.dev.port;
  const endpoint = config.server.endpoint;
  const isProduction = process.env.NODE_ENV === "production";
  const serverEnabled = config.serverEnabled;

  const { EvWebpackPlugin } = esmRequire("@evjs/bundler-webpack");
  const MiniCssExtractPlugin = esmRequire("mini-css-extract-plugin");

  const pluginOptions = {
    server: { entry: config.server.entry },
    serverEnabled,
    html: path.resolve(cwd, html),
    hooks,
    assetPrefix: isProduction ? config.assetPrefix : "/",
  };

  // Resolve loader paths from evjs's dependency tree so they work
  // even when the user's project doesn't list them as direct deps.
  const resolveLoader = (id: string): string => {
    try {
      return esmRequire.resolve(id);
    } catch {
      return id;
    }
  };

  // Derive the proxy base path from the configured endpoint.
  // e.g. "/api/fn" → "/api", "/rpc/v1" → "/rpc"
  const proxyBase = `/${endpoint.split("/").filter(Boolean)[0] || "api"}`;

  // Map evjs config.dev properties to their webpack-dev-server equivalents.
  // Never spread config.dev directly — webpack-dev-server rejects unknown properties.
  const isHttps = config.dev.https;

  const webpack = esmRequire("webpack");

  // In production, override webpack's PublicPathRuntimeModule so the
  // public path is resolved at page-load time from `window.assetPrefix`.
  // This enables deploy-time CDN prefix rewriting without rebuilding.
  class AssetPrefixRuntimePlugin {
    apply(compiler: { hooks: Record<string, any> }): void {
      compiler.hooks.compilation.tap(
        "AssetPrefixRuntimePlugin",
        (compilation: any) => {
          compilation.hooks.runtimeModule.tap(
            "AssetPrefixRuntimePlugin",
            (mod: any) => {
              if (mod.constructor.name === "PublicPathRuntimeModule") {
                mod.getGeneratedCode = () =>
                  `__webpack_require__.p = (typeof window !== "undefined" && window.assetPrefix) || "/";`;
              }
            },
          );
        },
      );
    }
  }

  const webpackConfig: Record<string, unknown> = {
    mode: isProduction ? "production" : "development",
    devtool: isProduction ? "hidden-source-map" : "source-map",
    entry,
    output: {
      path: path.resolve(cwd, serverEnabled ? "dist/client" : "dist"),
      filename: isProduction ? "[name].[contenthash:8].js" : "index.js",
      publicPath: isProduction ? config.assetPrefix : "/",
      clean: true,
    },
    resolve: {
      extensions: [".tsx", ".ts", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.m?js/,
          resolve: { fullySpecified: false },
        },
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: [
            {
              loader: resolveLoader("swc-loader"),
              options: {
                jsc: {
                  parser: { syntax: "typescript", tsx: true },
                  transform: { react: { runtime: "automatic" } },
                },
              },
            },
            {
              loader: resolveLoader("@evjs/bundler-webpack/server-fn-loader"),
            },
          ],
        },
        // Auto-detected CSS support.
        // If postcss.config.js exists, include postcss-loader automatically.
        ...(() => {
          const postcssConfigs = [
            "postcss.config.js",
            "postcss.config.cjs",
            "postcss.config.mjs",
            ".postcssrc",
            ".postcssrc.js",
          ];
          const hasPostCSS = postcssConfigs.some((f) =>
            fs.existsSync(path.resolve(cwd, f)),
          );
          const baseCssLoader = { loader: MiniCssExtractPlugin.loader };
          const postcssLoader = hasPostCSS
            ? [{ loader: resolveLoader("postcss-loader") }]
            : [];

          return [
            // CSS Modules (*.module.css)
            {
              test: /\.module\.css$/,
              use: [
                baseCssLoader,
                {
                  loader: resolveLoader("css-loader"),
                  options: { modules: true },
                },
                ...postcssLoader,
              ],
            },
            // Global CSS
            {
              test: /\.css$/,
              exclude: /\.module\.css$/,
              use: [
                baseCssLoader,
                { loader: resolveLoader("css-loader") },
                ...postcssLoader,
              ],
            },
          ];
        })(),
        // Static assets (images, fonts, SVGs, etc.)
        {
          test: /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i,
          type: "asset",
        },
        {
          test: /\.(woff2?|eot|ttf|otf)$/i,
          type: "asset/resource",
        },
      ],
    },
    plugins: [
      new EvWebpackPlugin(pluginOptions),
      new MiniCssExtractPlugin({
        filename: isProduction ? "[name].[contenthash:8].css" : "[name].css",
      }),
      // HMR plugin must be in the config so it's present when the
      // compiler is created — WDS hot:true adds it too late when
      // it receives a pre-created compiler instance.
      ...(!isProduction
        ? [new webpack.HotModuleReplacementPlugin()]
        : [new AssetPrefixRuntimePlugin()]),
    ],
    optimization: isProduction
      ? { splitChunks: { chunks: "all" as const } }
      : undefined,
    devServer: {
      port: clientPort,
      server: isHttps ? "https" : "http",
      hot: true,
      historyApiFallback: true,
      devMiddleware: { writeToDisk: true },
      ...(serverEnabled
        ? {
            proxy: [
              {
                context: [proxyBase],
                target: `${config.server.dev.https ? "https" : "http"}://localhost:${serverPort}`,
                secure: false,
              },
            ],
          }
        : {}),
    },
  };

  const ctx: EvBundlerCtx = {
    mode: isProduction ? "production" : "development",
    config,
  };

  // Run plugin bundler hooks
  for (const h of hooks) {
    if (h.bundler) {
      h.bundler(webpackConfig, ctx);
    }
  }

  return webpackConfig;
}
