/**
 * Server configuration.
 *
 * Controls server backend, entry, plugins, and dev options.
 */
export interface ServerConfig {
  /** Explicit server entry file. If provided, overrides auto-generated entry. */
  entry?: string;
  /** Server backend command. Default: "node". */
  backend?: string;
  /** Server function configuration. */
  functions?: {
    /** Server function endpoint path. Default: "/api/fn". */
    endpoint?: string;
  };
  /** Build plugins for the server bundle. */
  plugins?: EvPlugin[];
  /** Dev server options. */
  dev?: {
    /** API server port (dev mode). Default: 3001. */
    port?: number;
    /** Enable HTTPS. */
    https?: boolean;
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
  /** Build plugins for the client bundle. */
  plugins?: EvPlugin[];
  /** Dev server options. */
  dev?: {
    /** Dev server port. Default: 3000. */
    port?: number;
    /** Enable HTTPS. */
    https?: boolean;
  };
}

/**
 * A single loader entry.
 *
 * Can be a plain package name or an object with per-loader options.
 *
 * @example
 * ```ts
 * "css-loader"
 * { loader: "css-loader", options: { modules: true } }
 * ```
 */
export type EvLoaderEntry =
  | string
  | { loader: string; options?: Record<string, unknown> };

/** A module rule declared by a plugin. */
export interface EvModuleRule {
  /** File matching pattern (e.g. /\.css$/, /\.svg$/). */
  test: RegExp;
  /** Pattern to exclude (e.g. /node_modules/). */
  exclude?: RegExp;
  /** Loader(s) to apply. */
  use: EvLoaderEntry | EvLoaderEntry[];
}

/** An evjs build plugin. */
export interface EvPlugin {
  /** Plugin name for debugging and logging. */
  name: string;
  /** Plugin's module configuration. */
  module?: {
    /** Module rules to add to the build pipeline. */
    rules?: EvModuleRule[];
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
 *     functions: { endpoint: "/api/fn" },
 *     dev: { port: 3001 },
 *   },
 * });
 * ```
 */
export function defineConfig(config: EvConfig): EvConfig {
  return config;
}
