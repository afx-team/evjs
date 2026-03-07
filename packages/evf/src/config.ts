/**
 * Server configuration.
 *
 * Controls server function endpoint, runner, middleware, and codec.
 */
export interface ServerConfig {
  /** Server runner module. Default: "@evjs/runtime/server/node". */
  runner?: string;
  /** Server function endpoint path. Default: "/api/fn". */
  endpoint?: string;
  /** Middleware module paths to auto-register in server entry. */
  middleware?: string[];
  /** Extra side-effect imports for the server entry. */
  setup?: string[];
}

/**
 * Client configuration.
 *
 * Controls transport settings for server function calls.
 */
export interface ClientConfig {
  /** Transport options for server function calls. */
  transport?: {
    /** Base URL for the server function endpoint. */
    baseUrl?: string;
    /** Path prefix for the server function endpoint. */
    endpoint?: string;
  };
}

/**
 * Build configuration.
 *
 * Controls webpack config generation.
 */
export interface BuildConfig {
  /** Client entry point. Default: "./src/main.tsx". */
  entry?: string;
  /** HTML template path. Default: "./index.html". */
  html?: string;
  /** Dev server port. Default: 3000. */
  port?: number;
  /** API server port. Default: 3001. */
  serverPort?: number;
}

/**
 * evf framework configuration.
 */
export interface EvfConfig {
  server?: ServerConfig;
  client?: ClientConfig;
  build?: BuildConfig;
}

/**
 * Define configuration for the evf framework.
 *
 * @example
 * ```ts
 * // evf.config.ts
 * import { defineConfig } from "evf";
 *
 * export default defineConfig({
 *   server: {
 *     endpoint: "/api/fn",
 *   },
 *   build: {
 *     port: 3000,
 *   },
 * });
 * ```
 */
export function defineConfig(config: EvfConfig): EvfConfig {
  return config;
}
