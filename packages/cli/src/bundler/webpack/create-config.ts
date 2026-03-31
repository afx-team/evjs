import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import type { EvBundlerCtx, ResolvedEvConfig } from "../../config.js";

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
): Record<string, unknown> {
  const { entry, html } = config;
  const clientPort = config.dev.port;
  const serverPort = config.server.dev.port;
  const endpoint = config.server.endpoint;
  const isProduction = process.env.NODE_ENV === "production";

  const HtmlWebpackPlugin = esmRequire("html-webpack-plugin");
  const { EvWebpackPlugin } = esmRequire("@evjs/webpack-plugin");

  const pluginOptions = { server: { entry: config.server.entry } };

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

  // Destructure port out of dev overrides to avoid passing it twice.
  const { port: _p, ...devServerOverrides } = config.dev;

  const webpackConfig: Record<string, unknown> = {
    name: "client",
    mode: isProduction ? "production" : "development",
    devtool: isProduction ? "hidden-source-map" : "source-map",
    entry,
    output: {
      path: path.resolve(cwd, "dist/client"),
      filename: isProduction ? "[name].[contenthash:8].js" : "index.js",
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
              loader: resolveLoader("@evjs/webpack-plugin/server-fn-loader"),
            },
          ],
        },
        // Auto-detected CSS support.
        // If postcss.config.js exists, include postcss-loader automatically.
        (() => {
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
          const cssLoaders = [
            { loader: resolveLoader("style-loader") },
            { loader: resolveLoader("css-loader") },
            ...(hasPostCSS
              ? [{ loader: resolveLoader("postcss-loader") }]
              : []),
          ];
          return { test: /\.css$/, use: cssLoaders };
        })(),
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({ template: html }),
      new EvWebpackPlugin(pluginOptions),
      ...(!isProduction
        ? [new (esmRequire("webpack").HotModuleReplacementPlugin)()]
        : []),
    ],
    optimization: isProduction
      ? { splitChunks: { chunks: "all" as const } }
      : undefined,
    devServer: {
      port: clientPort,
      hot: true,
      devMiddleware: { writeToDisk: true },
      proxy: [
        {
          context: [proxyBase],
          target: `http://localhost:${serverPort}`,
        },
      ],
      ...devServerOverrides,
    },
  };

  const ctx: EvBundlerCtx = { 
    mode: isProduction ? "production" : "development",
    config
  };

  // 1. Run plugins' bundler escape hatches
  for (const plugin of config.plugins) {
    if (plugin.bundler) {
      plugin.bundler(webpackConfig, ctx);
    }
  }

  // 2. Run user override bundler escape hatch
  config.bundler.config(webpackConfig, ctx);

  return webpackConfig;
}
