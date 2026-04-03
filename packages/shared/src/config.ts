/**
 * Context passed to plugin config hooks.
 */
export interface EvConfigCtx {
  /** The current mode. */
  mode: "development" | "production";
}

/**
 * Context passed to plugin bundler hooks.
 */
export interface EvBundlerCtx {
  /** The current mode. */
  mode: "development" | "production";
  /** The fully resolved framework config. */
  config: ResolvedEvConfig;
}

/**
 * A version of EvConfig where all fields with defaults are guaranteed.
 */
export type ResolvedEvConfig = Required<
  Omit<EvConfig, "dev" | "server" | "bundler" | "plugins">
> & {
  dev: Required<NonNullable<EvConfig["dev"]>>;
  /** Whether the server is enabled (true unless `server: false`). */
  serverEnabled: boolean;
  server: Required<Omit<NonNullable<Exclude<EvConfig["server"], false>>, "entry" | "dev">> & {
    entry?: string;
    dev: Required<NonNullable<NonNullable<Exclude<EvConfig["server"], false>>["dev"]>>;
  };
  bundler: Required<NonNullable<EvConfig["bundler"]>>;
  plugins: EvPlugin[];
};

/**
 * An evjs plugin.
 */
export interface EvPlugin {
  /** Plugin name for debugging and logging. */
  name: string;
  /**
   * Hook to modify the framework configuration.
   */
  config?:
    | ((config: EvConfig, ctx: EvConfigCtx) => EvConfig)
    | ((config: EvConfig, ctx: EvConfigCtx) => void);

  /**
   * Hook to modify the underlying bundler configuration.
   */
  bundler?: (bundlerConfig: unknown, ctx: EvBundlerCtx) => unknown;
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
    /**
     * Escape hatch to fully modify the underlying bundler configuration.
     * The `config` type is `any` so the CLI remains bundler-agnostic.
     */
    config?: (bundlerConfig: unknown, ctx: EvBundlerCtx) => unknown;
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
  endpoint: "/api/fn",
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
      config: config.bundler?.config ?? (() => {}),
    },
    plugins: config.plugins ?? [],
  };
}
