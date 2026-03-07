import path from "node:path";
import type { EvfConfig } from "./config.js";

/**
 * Default values for evf configuration.
 */
const DEFAULTS = {
  entry: "./src/main.tsx",
  html: "./index.html",
  port: 3000,
  serverPort: 3001,
} as const;

/**
 * Generate a webpack configuration object from EvfConfig.
 *
 * This replaces the 70+ line webpack.config.cjs boilerplate that
 * every project had to maintain manually.
 */
export function createWebpackConfig(
  config: EvfConfig | undefined,
  cwd: string,
) {
  const build = config?.build;
  const entry = build?.entry ?? DEFAULTS.entry;
  const html = build?.html ?? DEFAULTS.html;
  const port = build?.port ?? DEFAULTS.port;
  const serverPort = build?.serverPort ?? DEFAULTS.serverPort;
  const isProduction = process.env.NODE_ENV === "production";

  // Dynamic requires — webpack and plugins are peer dependencies
  // loaded at runtime so the evf package itself stays light.
  const tryRequire = (id: string) => {
    try {
      return require(id);
    } catch {
      console.error(`Missing dependency: ${id}. Run: npm install -D ${id}`);
      process.exit(1);
    }
  };

  const HtmlWebpackPlugin = tryRequire("html-webpack-plugin");
  const { EvWebpackPlugin } = tryRequire("@evjs/webpack-plugin");

  const serverConfig = config?.server;
  const pluginOptions: Record<string, unknown> = {};
  if (serverConfig?.setup || serverConfig?.middleware) {
    pluginOptions.server = {
      setup: [
        ...(serverConfig.setup ?? []),
        ...(serverConfig.middleware ?? []),
      ],
    };
  }

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
              loader: "swc-loader",
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
              loader: "@evjs/webpack-plugin/server-fn-loader",
            },
          ],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({ template: html }),
      new EvWebpackPlugin(
        Object.keys(pluginOptions).length > 0 ? pluginOptions : undefined,
      ),
    ],
    optimization: isProduction
      ? { splitChunks: { chunks: "all" as const } }
      : undefined,
    devServer: {
      port,
      hot: true,
      devMiddleware: {
        writeToDisk: true,
      },
      proxy: [
        {
          context: ["/api"],
          target: `http://localhost:${serverPort}`,
        },
      ],
    },
  };
}
