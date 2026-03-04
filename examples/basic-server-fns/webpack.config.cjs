const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

/** @type {import("webpack").Configuration} */
const clientConfig = {
  name: "client",
  mode: "development",
  target: "web",
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
        test: /\.server\.tsx?$/,
        use: [
          {
            loader: "ts-loader",
            options: { transpileOnly: true },
          },
          {
            loader: "@evai/webpack-plugin/server-fn-loader",
            options: { isServer: false },
          },
        ],
      },
      {
        test: /\.tsx?$/,
        exclude: [/node_modules/, /\.server\.tsx?$/],
        use: {
          loader: "ts-loader",
          options: { transpileOnly: true },
        },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./index.html",
    }),
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
        test: /\.server\.tsx?$/,
        use: [
          {
            loader: "ts-loader",
            options: { transpileOnly: true },
          },
          {
            loader: "@evai/webpack-plugin/server-fn-loader",
            options: { isServer: true },
          },
        ],
      },
      {
        test: /\.tsx?$/,
        exclude: [/node_modules/, /\.server\.tsx?$/],
        use: {
          loader: "ts-loader",
          options: { transpileOnly: true },
        },
      },
    ],
  },
};

module.exports = [clientConfig, serverConfig];
