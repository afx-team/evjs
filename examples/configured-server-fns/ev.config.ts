import { webpack } from "@evjs/bundler-webpack";
import { defineConfig } from "@evjs/cli";

/**
 * Advanced ev.config.ts example.
 *
 * This file demonstrates all available configuration options.
 * All fields are optional — evjs works out of the box.
 */
export default defineConfig({
  // Client entry point (default: "./src/main.tsx")
  entry: "./src/main.tsx",

  // HTML template (default: "./index.html")
  html: "./index.html",

  // Dev server options (merged with built-in defaults)
  dev: {
    // Dev server port (default: 3000)
    port: 4000,

    // Any dev server options can be added here:
    // https: true,
  },

  server: {
    // Server function endpoint path (default: "/api/fn")
    endpoint: "/api/fn",

    // Server runtime command (default: "node")
    // Supports: "node", "bun", "deno run --allow-net", etc.
    runtime: "node",

    // Dev server options
    dev: {
      // API server port in dev mode (default: 3001)
      port: 4001,
    },
  },

  // Build-time plugins
  plugins: [
    {
      name: "example-txt-plugin",
      setup() {
        return {
          // Type-safe webpack config via helper
          bundler: webpack((config) => {
            config.module?.rules?.push({
              test: /\.txt$/,
              use: "raw-loader",
            });
          }),
        };
      },
    },
  ],
});
