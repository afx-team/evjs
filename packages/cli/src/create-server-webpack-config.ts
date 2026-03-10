import { createRequire } from "node:module";
import path from "node:path";
import type { EvConfig } from "./config.js";

const esmRequire = createRequire(import.meta.url);

/**
 * Create a webpack configuration object for server-only (FaaS) builds.
 *
 * Unlike the fullstack config, this:
 * - Targets Node.js (no browser polyfills)
 * - Has no HtmlWebpackPlugin or dev server
 * - Externalises all node_modules
 * - Uses only the server transform (no JSX/React)
 */
export function createServerWebpackConfig(
  config: EvConfig | undefined,
  cwd: string,
  entryPath: string,
): Record<string, unknown> {
  const server = config?.server;
  const isProduction = process.env.NODE_ENV === "production";

  const { EvWebpackPlugin } = esmRequire("@evjs/webpack-plugin");

  const pluginOptions = server?.middleware?.length
    ? { server: { middleware: server.middleware } }
    : undefined;

  const resolveLoader = (id: string): string => {
    try {
      return esmRequire.resolve(id);
    } catch {
      return id;
    }
  };

  return {
    name: "server",
    target: "node",
    mode: isProduction ? "production" : "development",
    devtool: isProduction ? "hidden-source-map" : "source-map",
    entry: entryPath,
    output: {
      path: path.resolve(cwd, "dist/server"),
      filename: isProduction ? "main.[contenthash:8].js" : "main.js",
      library: { type: "commonjs2" },
      clean: true,
    },
    resolve: {
      extensions: [".tsx", ".ts", ".js"],
    },
    externalsPresets: { node: true },
    externals: [
      // Externalise all node_modules except framework internals that must be bundled
      (
        { request }: { request?: string },
        cb: (err?: Error | null, result?: string) => void,
      ) => {
        if (
          request &&
          typeof request === "string" &&
          !request.startsWith(".") &&
          !request.startsWith("/") &&
          !request.startsWith("data:") &&
          // Bundle framework internals (ESM packages that won't resolve in CJS output)
          !request.startsWith("@evjs/") &&
          !request.startsWith("hono")
        ) {
          return cb(null, request);
        }
        cb();
      },
    ],
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
                  parser: { syntax: "typescript", tsx: false },
                },
              },
            },
            {
              loader: resolveLoader("@evjs/webpack-plugin/server-fn-loader"),
              options: { readableIds: true },
            },
          ],
        },
      ],
    },
    plugins: [new EvWebpackPlugin(pluginOptions)],
  };
}
