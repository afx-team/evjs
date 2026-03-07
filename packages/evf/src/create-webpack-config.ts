import { createRequire } from "node:module";
import path from "node:path";
import { CONFIG_DEFAULTS, type EvfConfig } from "./config.js";

const esmRequire = createRequire(import.meta.url);

/**
 * Create a webpack configuration object from EvfConfig.
 *
 * Returns a plain object that can be passed directly to the webpack Node API.
 * No temp files are generated.
 */
export function createWebpackConfig(
  config: EvfConfig | undefined,
  cwd: string,
): Record<string, unknown> {
  const client = config?.client;
  const server = config?.server;
  const entry = client?.entry ?? CONFIG_DEFAULTS.entry;
  const html = client?.html ?? CONFIG_DEFAULTS.html;
  const clientPort = client?.dev?.port ?? CONFIG_DEFAULTS.clientPort;
  const serverPort = server?.dev?.port ?? CONFIG_DEFAULTS.serverPort;
  const endpoint = server?.endpoint ?? CONFIG_DEFAULTS.endpoint;
  const isProduction = process.env.NODE_ENV === "production";

  const HtmlWebpackPlugin = esmRequire("html-webpack-plugin");
  const { EvWebpackPlugin } = esmRequire("@evjs/webpack-plugin");

  const pluginOptions =
    server?.middleware?.length
      ? { server: { middleware: server.middleware } }
      : undefined;

  // Resolve loader paths from evf's dependency tree so they work
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
  const { port: _p, ...devServerOverrides } = client?.dev ?? {};

  return {
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
              loader: resolveLoader(
                "@evjs/webpack-plugin/server-fn-loader",
              ),
            },
          ],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({ template: html }),
      new EvWebpackPlugin(pluginOptions),
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
}
