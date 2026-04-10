import { DEFAULT_ENDPOINT } from "@evjs/shared";
import type { EvPlugin } from "./plugin.js";

export type {
  EvBuildResult,
  EvBundlerCtx,
  EvDocument,
  EvPlugin,
  EvPluginContext,
  EvPluginHooks,
} from "./plugin.js";

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
  /** Resolved asset prefix for CDN deployment, always ends with "/". */
  assetPrefix: string;
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
 * evjs framework configuration.
 */
export interface EvConfig {
  /**
   * URL prefix for all client assets (JS, CSS, images, fonts).
   * Use this when deploying static assets to a CDN on a different domain.
   *
   * At build time, this prefix is applied to all `<script>` and `<link>` tags
   * in the generated HTML. It is also used as Webpack's runtime `publicPath`,
   * so dynamically loaded chunks resolve against it. A
   * `<script>window.assetPrefix = "..."</script>` tag is injected so the value
   * is available at runtime and can be rewritten at deploy time.
   *
   * @example "https://cdn.example.com/assets/"
   * @default "/"
   */
  assetPrefix?: string;
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
  assetPrefix: "/",
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

  const rawPrefix = config.assetPrefix ?? CONFIG_DEFAULTS.assetPrefix;
  const assetPrefix = rawPrefix.endsWith("/") ? rawPrefix : `${rawPrefix}/`;

  return {
    assetPrefix,
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
