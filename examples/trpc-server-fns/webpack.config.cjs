const path = require("node:path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const { EvWebpackPlugin } = require("@evjs/webpack-plugin");

/** @type {import("webpack").Configuration} */
const clientConfig = {
  name: "client",
  mode: "development",
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
          },
        ],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./index.html",
    }),
    new EvWebpackPlugin({
      server: {
        runner:
          process.env.NODE_ENV === "development"
            ? "@evjs/runtime/server#runNodeServer"
            : undefined,
      },
    }),
  ],
  devServer: {
    port: 3000,
    hot: true,
    devMiddleware: {
      writeToDisk: (filePath) => /server/.test(filePath),
    },
    proxy: [
      {
        context: ["/api"],
        target: "http://localhost:3001",
      },
    ],
  },
};

module.exports = clientConfig;
