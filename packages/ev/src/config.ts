import { DEFAULT_ENDPOINT } from "@evjs/shared";
import type { BundlerAdapter } from "./bundler.js";
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

/**
 * A version of EvConfig where all fields with defaults are guaranteed.
 */
export interface ResolvedEvConfig<TBundlerCfg = unknown> {
  /** Resolved asset prefix for CDN deployment, always ends with "/". */
  assetPrefix: string;
  /** Client entry point (SPA mode). */
  entry: string;
  /** HTML template path (SPA mode). */
  html: string;
  /**
   * Resolved pages for MPA mode.
   *
   * When set, the build produces one HTML file per page, each with its own
   * entry bundle. The single-entry `entry` and `html` fields are ignored.
   */
  pages?: Record<string, { entry: string; html: string }>;
  /** Client dev server options. */
  dev: ResolvedDevConfig;
  /** Whether the server is enabled (true unless `server: false`). */
  serverEnabled: boolean;
  /** Server configuration. */
  server: ResolvedServerConfig;
  /** Bundler adapter. When omitted, defaults to utoopack. */
  bundler?: BundlerAdapter<TBundlerCfg>;
  /** Active plugins. */
  plugins: EvPlugin<TBundlerCfg>[];
}

/**
 * evjs framework configuration.
 */
export interface EvConfig<TBundlerCfg = unknown> {
  /**
   * URL prefix for all client assets (JS, CSS, images, fonts).
   * Use this when deploying static assets to a CDN on a different domain.
   *
   * At build time, this prefix is applied to all `<script>` and `<link>` tags
   * in the generated HTML. It is also used as the bundler's runtime `publicPath`,
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

  /** Bundler adapter. When omitted, defaults to utoopack. */
  bundler?: BundlerAdapter<TBundlerCfg>;

  /**
   * Framework plugins to extend behavior or modify the bundler config.
   */
  plugins?: EvPlugin<TBundlerCfg>[];

  /**
   * MPA (Multi-Page Application) configuration.
   *
   * Define multiple independent page entries, each with its own JS entry
   * point and optional HTML template. When set, the build produces one
   * HTML file per page and the single-entry `entry` / `html` fields are
   * ignored.
   *
   * @example
   * ```ts
   * pages: {
   *   home: { entry: "./src/pages/home/main.tsx" },
   *   about: {
   *     entry: "./src/pages/about/main.tsx",
   *     html: "./src/pages/about/index.html",
   *   },
   * }
   * ```
   */
  pages?: Record<string, PageConfig>;
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
 * Deeply merge user configuration with defaults.
 */
export function resolveConfig<TBundlerCfg = unknown>(
  userConfig?: EvConfig<TBundlerCfg>,
): ResolvedEvConfig<TBundlerCfg> {
  const config = userConfig ?? {};
  const serverEnabled = config.server !== false;
  const serverConfig = config.server === false ? {} : (config.server ?? {});

  const rawPrefix = config.assetPrefix ?? CONFIG_DEFAULTS.assetPrefix;
  const assetPrefix = rawPrefix.endsWith("/") ? rawPrefix : `${rawPrefix}/`;

  const defaultHtml = config.html ?? CONFIG_DEFAULTS.html;

  // Resolve MPA pages — fill in default html per page
  let resolvedPages:
    | Record<string, { entry: string; html: string }>
    | undefined;
  if (config.pages && Object.keys(config.pages).length > 0) {
    resolvedPages = {};
    for (const [name, page] of Object.entries(config.pages)) {
      resolvedPages[name] = {
        entry: page.entry,
        html: page.html ?? defaultHtml,
      };
    }
  }

  return {
    assetPrefix,
    entry: config.entry ?? CONFIG_DEFAULTS.entry,
    html: defaultHtml,
    pages: resolvedPages,
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
    bundler: config.bundler,
    plugins: config.plugins ?? [],
  };
}
/**
 * Define the evjs framework configuration with type inference.
 *
 * @param config - The framework configuration object.
 * @returns The exact same configuration object.
 */
export function defineConfig<TBundlerCfg = unknown>(
  config: EvConfig<TBundlerCfg>,
): EvConfig<TBundlerCfg> {
  return config;
}

/**
 * Configuration for a single page in MPA mode.
 */
export interface PageConfig {
  /** Client entry point for this page. */
  entry: string;
  /** HTML template path. If omitted, uses the top-level `html` default. */
  html?: string;
}

/**
 * Whether the resolved config is in MPA (multi-page) mode.
 */
export function isMpa<T = unknown>(config: ResolvedEvConfig<T>): boolean {
  return config.pages !== undefined && Object.keys(config.pages).length > 0;
}
