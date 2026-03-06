# @evjs/webpack-plugin

Webpack adapter for the **ev** framework. Thin wrapper over [`@evjs/build-tools`](../build-tools) that connects bundler-agnostic build logic to Webpack's plugin and loader APIs.

## Features

- **`EvWebpackPlugin`**: Configurable plugin that:
  - Spawns a Node-targeted **Child Compiler** for server-side code.
  - **Auto-discovers** `"use server"` files dynamically.
  - Supports configurable **app factory**, **runner**, and **setup imports**.
  - Emits a versioned `manifest.json` mapping function IDs.
- **`server-fn-loader`**: Transforms files marked with `"use server"`.
  - Automatically detects if it is running in a client or server compiler context.

## Usage

```js
const { EvWebpackPlugin } = require("@evjs/webpack-plugin");

module.exports = {
  plugins: [
    new EvWebpackPlugin({
      server: {
        // App factory (default: "@evjs/runtime/server#createApp")
        appFactory: "@evjs/runtime/server#createApp",
        // Runner — bake into bundle for self-starting (dev only)
        runner: process.env.NODE_ENV === 'development'
          ? "@evjs/runtime/server#runNodeServer"
          : undefined,
        // Extra imports (middleware, config, etc.)
        setup: [],
      },
    }),
  ],
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [
          { loader: "swc-loader" },
          { loader: "@evjs/webpack-plugin/server-fn-loader" },
        ],
      },
    ],
  },
};
```
