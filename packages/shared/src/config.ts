import type { ClientManifest, ServerManifest } from "@evjs/manifest";
import { DEFAULT_ENDPOINT } from "./constants.js";

/**
 * Context passed to plugin bundler hooks.
 */
export interface EvBundlerCtx {
  /** The current mode. */
  mode: "development" | "production";
  /** The fully resolved framework config. */
  config: ResolvedEvConfig;
}

/** Resolved dev server configuration (all defaults applied). */
export interface ResolvedDevConfig {
  /** Client dev server port. */
  port: number;
  /** HTTPS configuration. */
  https: boolean | { key: string; cert: string };
}

/** Resolved server dev configuration (all defaults applied). */
export interface ResolvedServerDevConfig {
  /** API server port (dev mode). */
  port: number;
  /** HTTPS for the API server. */
  https: { key: string; cert: string } | false;
}

/** Resolved server configuration (all defaults applied). */
export interface ResolvedServerConfig {
  /** Explicit server entry file. Omitted when auto-generated. */
  entry?: string;
  /** Server runtime command. */
  runtime: string;
  /** Server function endpoint path. */
  endpoint: string;
  /** Server dev options. */
  dev: ResolvedServerDevConfig;
}

/** Resolved bundler configuration (all defaults applied). */
export interface ResolvedBundlerConfig {
  /** The active bundler. */
  name: "webpack" | "utoopack";
}

/**
 * A version of EvConfig where all fields with defaults are guaranteed.
 */
export interface ResolvedEvConfig {
  /** Client entry point. */
  entry: string;
  /** HTML template path. */
  html: string;
  /** Client dev server options. */
  dev: ResolvedDevConfig;
  /** Whether the server is enabled (true unless `server: false`). */
  serverEnabled: boolean;
  /** Server configuration. */
  server: ResolvedServerConfig;
  /** Bundler adapter configuration. */
  bundler: ResolvedBundlerConfig;
  /** Active plugins. */
  plugins: EvPlugin[];
}

/**
 * An evjs plugin.
 */
export interface EvPlugin {
  /** Plugin name for debugging and logging. */
  name: string;

  /**
   * Initialize the plugin and return lifecycle hooks.
   *
   * Receives the fully resolved config and build context. All returned
   * hooks share state through closure.
   */
  setup?: (
    ctx: EvPluginContext,
  ) => EvPluginHooks | void | Promise<EvPluginHooks | void>;
}

/**
 * Context passed to plugin setup().
 */
export interface EvPluginContext {
  /** Current mode. */
  mode: "development" | "production";
  /** The fully resolved framework config. */
  config: ResolvedEvConfig;
}

/**
 * Lifecycle hooks returned from plugin setup().
 */
export interface EvPluginHooks {
  /** Called before compilation begins. */
  buildStart?: () => void | Promise<void>;

  /**
   * Modify the underlying bundler configuration directly.
   *
   * The config type is `unknown` by default. Use the typed helper exported
   * by each bundler adapter for type safety (e.g., `webpack()` from
   * `@evjs/bundler-webpack`).
   */
  bundler?: (config: unknown, ctx: EvBundlerCtx) => void;

  /** Called after compilation completes. Receives build result with manifests. */
  buildEnd?: (result: EvBuildResult) => void | Promise<void>;
}

/**
 * Build result passed to the buildEnd hook.
 */
export interface EvBuildResult {
  /** The client manifest (assets, routes). */
  clientManifest: ClientManifest;
  /** The server manifest (entry, fns). Undefined if server is disabled. */
  serverManifest?: ServerManifest;
  /** True if this is a rebuild triggered by file change (dev watch mode only). */
  isRebuild: boolean;
}

/**
 * evjs framework configuration.
 */
export interface EvConfig {
  /** Client entry point. Default: "./src/main.tsx". */
  entry?: string;
  /** HTML template path. Default: "./index.html". */
  html?: string;

  /** Client dev server options. */
  dev?: {
    /** Client dev server port. Default: 3000. */
    port?: number;
    /** Enable HTTPS. If an object is provided, it can be explicit key/cert PEM strings or file paths. */
    https?: boolean | { key: string; cert: string };
  };

  /**
   * Server configuration.
   *
   * Set to `false` to disable the server entirely (CSR-only mode).
   * When `false`, build output goes to flat `dist/` instead of `dist/client/` + `dist/server/`,
   * and any `"use server"` module will cause a build error.
   */
  server?:
    | false
    | {
        /** Explicit server entry file. If provided, overrides auto-generated entry. */
        entry?: string;
        /** Server runtime command. Default: "node". */
        runtime?: string;
        /** Server function endpoint path. Default: "/api/fn". */
        endpoint?: string;
        /** Server dev options. */
        dev?: {
          /** API server port (dev mode). Default: 3001. */
          port?: number;
          /** Enable HTTPS for the API server. Must provide explicit key/cert payloads or file paths. */
          https?: { key: string; cert: string } | false;
        };
      };

  /** Bundler adapter configuration. */
  bundler?: {
    /** The active bundler. Default: "webpack". */
    name?: "webpack" | "utoopack";
  };

  /** Plugins applied to the build pipeline. */
  plugins?: EvPlugin[];
}

/**
 * Default configuration values.
 */
export const CONFIG_DEFAULTS = {
  entry: "./src/main.tsx",
  html: "./index.html",
  port: 3000,
  serverPort: 3001,
  endpoint: DEFAULT_ENDPOINT,
} as const;

/**
 * Define configuration for the evjs framework.
 */
export function defineConfig(config: EvConfig): EvConfig {
  return config;
}

/**
 * Deeply merge user configuration with defaults.
 */
export function resolveConfig(userConfig?: EvConfig): ResolvedEvConfig {
  const config = userConfig ?? {};
  const serverEnabled = config.server !== false;
  const serverConfig = config.server === false ? {} : (config.server ?? {});

  return {
    entry: config.entry ?? CONFIG_DEFAULTS.entry,
    html: config.html ?? CONFIG_DEFAULTS.html,
    dev: {
      port: config.dev?.port ?? CONFIG_DEFAULTS.port,
      https: config.dev?.https ?? false,
    },
    serverEnabled,
    server: {
      entry: serverConfig.entry,
      runtime: serverConfig.runtime ?? "node",
      endpoint: serverConfig.endpoint ?? CONFIG_DEFAULTS.endpoint,
      dev: {
        port: serverConfig.dev?.port ?? CONFIG_DEFAULTS.serverPort,
        https: serverConfig.dev?.https ?? false,
      },
    },
    bundler: {
      name: config.bundler?.name ?? "webpack",
    },
    plugins: config.plugins ?? [],
  };
}
