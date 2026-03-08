import { defineConfig } from "@evjs/cli";

/**
 * Advanced ev.config.ts example.
 *
 * This file demonstrates all available configuration options.
 * All fields are optional — evjs works zero-config out of the box.
 */
export default defineConfig({
  client: {
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
      // open: true,
      // historyApiFallback: true,
    },

    // Transport configuration for server function calls
    transport: {
      // Base URL for server function endpoint (default: same origin)
      // baseUrl: "https://api.example.com",

      // Server function endpoint path (default: "/api/fn")
      endpoint: "/api/fn",
    },
  },

  server: {
    // Server function endpoint path (default: "/api/fn")
    endpoint: "/api/fn",

    // Server runner module (default: "@evjs/runtime/server/node")
    // For Deno/Bun/Workers, use: "@evjs/runtime/server/ecma"
    runner: "@evjs/runtime/server/node",

    // Middleware module paths to auto-register in server entry
    // These are imported and applied in order
    // middleware: ["./src/middleware/auth.ts", "./src/middleware/cors.ts"],

    // Dev server options
    dev: {
      // API server port in dev mode (default: 3001)
      port: 4001,
    },
  },
});
