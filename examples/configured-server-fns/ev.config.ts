import { defineConfig } from "@evjs/cli";

/**
 * Advanced ev.config.ts example.
 *
 * This file demonstrates all available configuration options.
 * All fields are optional — evjs works out of the box.
 */
export default defineConfig({
  client: {
    // Client entry point (default: "./src/main.tsx")
    entry: "./src/main.tsx",

    // HTML template (default: "./index.html")
    html: "./index.html",

    // Build plugins
    plugins: [
      {
        name: "example-txt-plugin",
        module: {
          rules: [
            {
              test: /\.txt$/,
              use: "raw-loader",
            },
          ],
        },
      },
    ],

    // Dev server options (merged with built-in defaults)
    dev: {
      // Dev server port (default: 3000)
      port: 4000,

      // Any dev server options can be added here:
      // https: true,
    },
  },

  server: {
    // Server function configuration
    functions: {
      // Server function endpoint path (default: "/api/fn")
      endpoint: "/api/fn",
    },

    // Server backend command (default: "node")
    // Supports: "node", "bun", "deno run --allow-net", etc.
    backend: "node",

    // Dev server options
    dev: {
      // API server port in dev mode (default: 3001)
      port: 4001,
    },
  },
});
