/**
 * Server configuration.
 *
 * Controls server function endpoint, backend, middleware, codec, and dev options.
 */
export interface ServerConfig {
  /** Server backend command. Default: "node". */
  backend?: string;
  /** Server function endpoint path. Default: "/api/fn". */
  endpoint?: string;
  /** Middleware module paths to auto-register in server entry. */
  middleware?: string[];
  /** Dev server options. */
  dev?: {
    /** API server port (dev mode). Default: 3001. */
    port?: number;
  };
}

/**
 * Client configuration.
 *
 * Controls entry point, HTML template, dev server, and transport.
 */
export interface ClientConfig {
  /** Client entry point. Default: "./src/main.tsx". */
  entry?: string;
  /** HTML template path. Default: "./index.html". */
  html?: string;
  // TODO: MPA support — add `pages` field as Record<string, { entry, html? }>
  // When `pages` is set it takes precedence over `entry`/`html` and generates
  // multiple webpack entries + HtmlWebpackPlugin instances.
  /** Dev server options. */
  dev?: {
    /** Dev server port. Default: 3000. */
    port?: number;
    /** Enable HTTPS. */
    https?: boolean;
    /** Open browser on start. */
    open?: boolean;
    /** Enable history API fallback for SPA routing. */
    historyApiFallback?: boolean;
  };
  /** Transport options for server function calls. */
  transport?: {
    /** Base URL for the server function endpoint. */
    baseUrl?: string;
    /** Path prefix for the server function endpoint. */
    endpoint?: string;
  };
}

/**
 * evjs framework configuration.
 */
export interface EvConfig {
  server?: ServerConfig;
  client?: ClientConfig;
}

/**
 * Default configuration values.
 *
 * Single source of truth for all defaults across the framework.
 */
export const CONFIG_DEFAULTS = {
  entry: "./src/main.tsx",
  html: "./index.html",
  clientPort: 3000,
  serverPort: 3001,
  endpoint: "/api/fn",
} as const;

/**
 * Define configuration for the evjs framework.
 *
 * @example
 * ```ts
 * // ev.config.ts
 * import { defineConfig } from "@evjs/cli";
 *
 * export default defineConfig({
 *   client: {
 *     entry: "./src/main.tsx",
 *     dev: { port: 3000 },
 *   },
 *   server: {
 *     endpoint: "/api/fn",
 *     dev: { port: 3001 },
 *   },
 * });
 * ```
 */
export function defineConfig(config: EvConfig): EvConfig {
  return config;
}
