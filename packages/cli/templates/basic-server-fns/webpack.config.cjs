const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const { EvWebpackPlugin } = require("@evjs/webpack-plugin");

/** @type {import("webpack").Configuration} */
const clientConfig = {
  name: "client",
  mode: "development",
  target: "web",
  devtool: "source-map",
  entry: "./src/main.tsx",
  output: {
    path: path.resolve(__dirname, "dist/client"),
    filename: "index.js",
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
            options: { isServer: false },
          },
        ],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./index.html",
    }),
    new EvWebpackPlugin(),
  ],
  devServer: {
    port: 3000,
    hot: true,
  },
};

/** @type {import("webpack").Configuration} */
const serverConfig = {
  name: "server",
  mode: "development",
  target: "node",
  devtool: "source-map",
  entry: "./src/server.ts",
  output: {
    path: path.resolve(__dirname, "dist/server"),
    filename: "index.js",
    clean: true,
    library: { type: "commonjs" },
  },

  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  externalsPresets: { node: true },
  externals: [], // Inline all node_modules except built-ins
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
              },
            },
          },
          {
            loader: "@evjs/webpack-plugin/server-fn-loader",
            options: { isServer: true },
          },
        ],
      },
    ],
  },
  plugins: [
    new EvWebpackPlugin(),
  ],
};

module.exports = [clientConfig, serverConfig];
