import { DEFAULT_SERVER_BASE_PATH } from "@evjs/shared";
import type {
  HydrationMode,
  PprConfig,
  RenderMode,
  SharedDependencyMap,
} from "@evjs/shared/manifest";
import type { BundlerAdapter } from "./bundler.js";
import type { Plugin } from "./plugin.js";

export type {
  BuildResult,
  BundlerCtx,
  HtmlDocument,
  HtmlDocumentInfo,
  HtmlTransformContext,
  Plugin,
  PluginConfigContext,
  PluginContext,
  PluginHooks,
} from "./plugin.js";

/** Resolved dev server configuration (all defaults applied). */
export interface ResolvedDevConfig {
  /** Client dev server port. */
  port: number;
  /** HTTPS configuration. */
  https: boolean | { key: string; cert: string };
  /** Dev proxy rules. */
  proxy: DevProxyRule[];
}

/** Internal server-function transform/runtime wiring. */
export interface ResolvedFunctionRuntimeConfig {
  /** Server function RPC endpoint path. */
  endpoint: string;
  /** Client-side transport module for server function stubs. */
  clientProxy: string;
  /** Server-side registration module for server functions. */
  serverRegister: string;
}

/** Proxy rule for the dev server. */
export interface DevProxyRule {
  context: string[];
  target: string;
  changeOrigin?: boolean;
  secure?: boolean;
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
  /** Framework server runtime base path. */
  basePath: string;
  /** Derived framework server runtime paths. */
  runtime: ResolvedServerRuntimeConfig;
  /** Internal build-time modules used by server-function transforms. */
  functionRuntime: ResolvedFunctionRuntimeConfig;
  /** RSC Flight endpoint configuration when enabled. */
  rsc?: ResolvedServerRscConfig;
  /** Server dev options. */
  dev: ResolvedServerDevConfig;
}

export interface ResolvedServerRuntimeConfig {
  basePath: string;
  fn: string;
  rsc?: string;
}

/**
 * A version of Config where all fields with defaults are guaranteed.
 */
export interface ResolvedConfig<
  TBundlerCfg = import("@utoo/pack").ConfigComplete,
> {
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
  pages?: Record<string, ResolvedPageConfig>;
  /** Explicit application declarations. */
  apps?: Record<string, ResolvedAppConfig>;
  /** Remote app manifests configured for shell/runtime loading. */
  remotes: Record<string, ResolvedRemoteConfig>;
  /** Remote app manifest emitted by this build, when this package is a remote. */
  remote?: ResolvedRemoteBuildConfig;
  /** Client dev server options. */
  dev: ResolvedDevConfig;
  /** Whether the server is enabled (true unless `server: false`). */
  serverEnabled: boolean;
  /** Server configuration. */
  server: ResolvedServerConfig;
  /** Browser-to-server transport configuration. */
  transport: ResolvedTransportConfig;
  /** Bundler adapter. When omitted, defaults to utoopack. */
  bundler?: BundlerAdapter<TBundlerCfg>;
  /** Active plugins. */
  plugins: Plugin<TBundlerCfg>[];
}

/**
 * evjs framework configuration.
 */
export interface Config<TBundlerCfg = import("@utoo/pack").ConfigComplete> {
  /** Client entry point. Default: "./src/main.tsx". */
  entry?: string;
  /** HTML template path. Default: "./index.html". */
  html?: string;

  /** Client dev server options. */
  dev?: DevConfig;

  /**
   * Server configuration.
   *
   * Set to `false` to disable the server entirely (CSR-only mode).
   * When `false`, build output goes to flat `dist/` instead of `dist/client/` + `dist/server/`,
   * and any `"use server"` module will cause a build error.
   */
  server?: false | ServerConfig;

  /**
   * Browser-to-server transport options.
   *
   * Same-origin applications do not need this. Set `baseUrl` only when the
   * browser runtime calls a framework server hosted on another origin.
   */
  transport?: TransportConfig;

  /**
   * Application-level declarations.
   *
   * `routes` points to the same module that application runtime imports for
   * its real route tree. It is an explicit graph-analysis source, not a file
   * convention.
   */
  apps?: Record<string, AppConfig>;

  /** Remote applications loaded from framework manifests. */
  remotes?: Record<string, RemoteConfig>;

  /**
   * Remote app emitted by this build.
   *
   * Use this when the current package is a manifest-driven remote that will be
   * loaded by another evjs shell. Host applications consume remotes through
   * `remotes`; remote packages declare themselves through this singular
   * `remote` field.
   */
  remote?: RemoteBuildConfig;

  /** Bundler adapter. When omitted, defaults to utoopack. */
  bundler?: BundlerAdapter<TBundlerCfg>;

  /**
   * Framework plugins to extend behavior or modify the bundler config.
   */
  plugins?: Plugin<TBundlerCfg>[];

  /**
   * MPA (Multi-Page Application) configuration.
   *
   * Define multiple independent page entries. A page can be a string entry
   * path or an object with its own JS entry point and optional HTML template.
   * When set, the build produces one HTML file per page and the single-entry
   * `entry` / `html` fields are ignored.
   *
   * @example
   * ```ts
   * pages: {
   *   home: "./src/pages/home/main.tsx",
   *   about: {
   *     entry: "./src/pages/about/main.tsx",
   *     html: "./src/pages/about/index.html",
   *   },
   * }
   * ```
   */
  pages?: Record<string, PageConfig>;
}

/** Client dev server options. */
export interface DevConfig {
  /** Client dev server port. Default: 3000. */
  port?: number;
  /** Enable HTTPS. If an object is provided, it can be explicit key/cert PEM strings or file paths. */
  https?: boolean | { key: string; cert: string };
  /**
   * Dev proxy configuration.
   * Configures the client dev server to proxy requests to backend services.
   * Defaults to forwarding the derived framework server function endpoint to
   * the local API dev server.
   */
  proxy?: DevProxyRule[];
}

/** Server configuration. */
export interface ServerConfig {
  /** Explicit server entry file. If provided, overrides auto-generated entry. */
  entry?: string;
  /**
   * Framework server runtime base path. Defaults to "/__evjs".
   *
   * Server function, PPR, and RSC endpoints are derived from this path.
   */
  basePath?: string;
  /** React Server Components Flight endpoint configuration. */
  rsc?: boolean | ServerRscConfig;
  /** Server dev options. */
  dev?: ServerDevConfig;
}

export interface ServerRscConfig {
  /**
   * RSC Flight endpoint path. Defaults to `${server.basePath}/rsc` when RSC is enabled.
   */
  endpoint?: string;
}

export interface ResolvedServerRscConfig {
  endpoint: string;
}

export interface TransportConfig {
  /** Absolute or relative server origin used by the browser runtime. */
  baseUrl?: string;
}

export interface ResolvedTransportConfig {
  baseUrl?: string;
}

export interface AppConfig {
  entry: string;
  html?: string;
  routes?: string;
  mount?: string;
}

export interface ResolvedAppConfig {
  entry: string;
  html: string;
  routes?: string;
  mount?: string;
}

export interface RemoteConfig {
  manifest: string;
  activeWhen?: string[];
}

export interface ResolvedRemoteConfig {
  manifest: string;
  activeWhen?: string[];
}

export interface RemoteBuildConfig {
  name: string;
  baseUrl?: string;
  shared?: SharedDependencyMap;
  entries: Record<string, RemoteBuildEntryConfig>;
}

export interface RemoteBuildEntryConfig {
  app: string;
  activeWhen?: string[];
  mount?: string;
}

export interface ResolvedRemoteBuildConfig {
  name: string;
  baseUrl: string;
  shared?: SharedDependencyMap;
  entries: Record<string, ResolvedRemoteBuildEntryConfig>;
}

export interface ResolvedRemoteBuildEntryConfig {
  app: string;
  activeWhen?: string[];
  mount?: string;
}

/** Server dev options. */
export interface ServerDevConfig {
  /** API server port (dev mode). Default: 3001. */
  port?: number;
  /** Enable HTTPS for the API server. Must provide explicit key/cert payloads or file paths. */
  https?: { key: string; cert: string } | false;
}

/**
 * Default configuration values.
 */
export const CONFIG_DEFAULTS = {
  entry: "./src/main.tsx",
  html: "./index.html",
  port: 3000,
  serverPort: 3001,
  serverBasePath: DEFAULT_SERVER_BASE_PATH,
  clientProxy: "@evjs/client",
  serverRegister: "@evjs/server/register",
} as const;

function toProxyContext(endpoint: string): string {
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}

function normalizePath(value: string): string {
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/, "")
    : withLeadingSlash;
}

function joinPath(basePath: string, segment: string): string {
  return `${normalizePath(basePath)}/${segment.replace(/^\/+/, "")}`;
}

function resolveRscEndpoint(
  serverConfig: ServerConfig,
  requiredByPageConfig: boolean,
): string | undefined {
  if (!serverConfig.rsc && !requiredByPageConfig) return undefined;
  const serverBasePath = normalizePath(
    serverConfig.basePath ?? CONFIG_DEFAULTS.serverBasePath,
  );
  if (typeof serverConfig.rsc === "object" && serverConfig.rsc.endpoint) {
    return normalizePath(serverConfig.rsc.endpoint);
  }
  return joinPath(serverBasePath, "rsc");
}

/**
 * Deeply merge user configuration with defaults.
 */
export function resolveConfig<
  TBundlerCfg = import("@utoo/pack").ConfigComplete,
>(userConfig?: Config<TBundlerCfg>): ResolvedConfig<TBundlerCfg> {
  const config = userConfig ?? {};
  const serverEnabled = config.server !== false;
  const serverConfig = config.server === false ? {} : (config.server ?? {});

  const defaultHtml = config.html ?? CONFIG_DEFAULTS.html;

  // Resolve MPA pages — fill in default html per page
  let resolvedPages: Record<string, ResolvedPageConfig> | undefined;
  if (config.pages && Object.keys(config.pages).length > 0) {
    resolvedPages = {};
    for (const [name, page] of Object.entries(config.pages)) {
      const pageConfig = typeof page === "string" ? { entry: page } : page;
      validatePageConfig(name, pageConfig);
      resolvedPages[name] = {
        path: "path" in pageConfig ? pageConfig.path : undefined,
        entry: "entry" in pageConfig ? pageConfig.entry : undefined,
        component: "component" in pageConfig ? pageConfig.component : undefined,
        app: "app" in pageConfig ? pageConfig.app : undefined,
        html: pageConfig.html ?? defaultHtml,
        render: pageConfig.render ?? "csr",
        hydrate: pageConfig.hydrate,
        mount: pageConfig.mount,
        ppr: "ppr" in pageConfig ? pageConfig.ppr : undefined,
      };
    }
  }

  const requiresRscEndpoint =
    resolvedPages &&
    Object.values(resolvedPages).some((page) => page.render === "rsc");
  const resolvedApps = config.apps
    ? Object.fromEntries(
        Object.entries(config.apps).map(([id, app]) => [
          id,
          {
            entry: app.entry,
            html: app.html ?? defaultHtml,
            routes: app.routes,
            mount: app.mount,
          },
        ]),
      )
    : undefined;

  const serverPort = serverConfig.dev?.port ?? CONFIG_DEFAULTS.serverPort;
  const serverBasePath = normalizePath(
    serverConfig.basePath ?? CONFIG_DEFAULTS.serverBasePath,
  );
  const serverEndpoint = joinPath(serverBasePath, "fn");
  const rscEndpoint = resolveRscEndpoint(
    serverConfig,
    Boolean(requiresRscEndpoint),
  );
  const serverTarget = new URL(
    serverConfig.dev?.https ? "https://localhost" : "http://localhost",
  );
  serverTarget.port = String(serverPort);

  return {
    entry: config.entry ?? CONFIG_DEFAULTS.entry,
    html: defaultHtml,
    pages: resolvedPages,
    apps: resolvedApps,
    remotes: Object.fromEntries(
      Object.entries(config.remotes ?? {}).map(([name, remote]) => [
        name,
        {
          manifest: remote.manifest,
          activeWhen: remote.activeWhen ? [...remote.activeWhen] : undefined,
        },
      ]),
    ),
    remote: config.remote
      ? {
          name: config.remote.name,
          baseUrl: config.remote.baseUrl ?? "/",
          ...(config.remote.shared
            ? { shared: cloneSharedDependencies(config.remote.shared) }
            : {}),
          entries: Object.fromEntries(
            Object.entries(config.remote.entries).map(([entryId, entry]) => [
              entryId,
              {
                app: entry.app,
                activeWhen: entry.activeWhen
                  ? [...entry.activeWhen]
                  : undefined,
                mount: entry.mount,
              },
            ]),
          ),
        }
      : undefined,
    dev: {
      port: config.dev?.port ?? CONFIG_DEFAULTS.port,
      https: config.dev?.https ?? false,
      proxy: [
        // User-defined proxies take precedence
        ...(config.dev?.proxy ?? []),
        // Framework always proxies the server function endpoint to the local API dev server
        {
          context: [
            toProxyContext(serverEndpoint),
            ...(rscEndpoint ? [toProxyContext(rscEndpoint)] : []),
          ],
          target: serverTarget.origin,
          changeOrigin: true,
          secure: false,
        },
      ],
    },
    serverEnabled,
    server: {
      entry: serverConfig.entry,
      basePath: serverBasePath,
      runtime: {
        basePath: serverBasePath,
        fn: serverEndpoint,
        ...(rscEndpoint ? { rsc: rscEndpoint } : {}),
      },
      rsc: rscEndpoint ? { endpoint: rscEndpoint } : undefined,
      functionRuntime: {
        endpoint: serverEndpoint,
        clientProxy: CONFIG_DEFAULTS.clientProxy,
        serverRegister: CONFIG_DEFAULTS.serverRegister,
      },
      dev: {
        port: serverPort,
        https: serverConfig.dev?.https ?? false,
      },
    },
    transport: {
      baseUrl: config.transport?.baseUrl,
    },
    bundler: config.bundler,
    plugins: config.plugins ?? [],
  };
}

function cloneSharedDependencies(
  shared: SharedDependencyMap,
): SharedDependencyMap {
  return Object.fromEntries(
    Object.entries(shared).map(([name, dependency]) => [
      name,
      {
        ...(dependency.shareKey ? { shareKey: dependency.shareKey } : {}),
        ...(dependency.requiredVersion
          ? { requiredVersion: dependency.requiredVersion }
          : {}),
        ...(dependency.singleton !== undefined
          ? { singleton: dependency.singleton }
          : {}),
        ...(dependency.strictVersion !== undefined
          ? { strictVersion: dependency.strictVersion }
          : {}),
        ...(dependency.eager !== undefined ? { eager: dependency.eager } : {}),
      },
    ]),
  );
}
/**
 * Define the evjs framework configuration with type inference.
 *
 * @param config - The framework configuration object.
 * @returns The exact same configuration object.
 */
export function defineConfig<TBundlerCfg = import("@utoo/pack").ConfigComplete>(
  config: Config<TBundlerCfg>,
): Config<TBundlerCfg> {
  return config;
}

/**
 * Configuration for a single page in MPA mode.
 */
export type PageConfig = string | PageObjectConfig;

/**
 * Object form for a single page in MPA mode.
 */
export type PageObjectConfig =
  | PageEntryConfig
  | PageComponentConfig
  | PageAppConfig;

export interface PageEntryConfig {
  /** Optional URL path served by the framework server for this page. */
  path?: string;
  /** Client entry point for this page. */
  entry: string;
  /** HTML template path. If omitted, uses the top-level `html` default. */
  html?: string;
  render?: Extract<RenderMode, "csr">;
  hydrate?: HydrationMode;
  mount?: string;
}

export interface PageComponentConfig {
  /** Optional URL path served by the framework server for this page. */
  path?: string;
  /** React component module mounted by the evjs page runtime. */
  component: string;
  /** HTML template path. If omitted, uses the top-level `html` default. */
  html?: string;
  render?: RenderMode;
  hydrate?: HydrationMode;
  mount?: string;
  ppr?: PprConfig;
}

export interface PageAppConfig {
  /** Optional URL path served by the framework server for this page. */
  path?: string;
  /** Lifecycle module with mount/hydrate/unmount exports. */
  app: string;
  /** HTML template path. If omitted, uses the top-level `html` default. */
  html?: string;
  render?: Extract<RenderMode, "csr" | "ssr">;
  hydrate?: HydrationMode;
  mount?: string;
}

export interface ResolvedPageConfig {
  path?: string;
  entry?: string;
  component?: string;
  app?: string;
  html: string;
  render: RenderMode;
  hydrate?: HydrationMode;
  mount?: string;
  ppr?: PprConfig;
}

/**
 * Whether the resolved config is in MPA (multi-page) mode.
 */
export function isMpa<T = unknown>(config: ResolvedConfig<T>): boolean {
  return config.pages !== undefined && Object.keys(config.pages).length > 0;
}

function validatePageConfig(name: string, page: PageObjectConfig): void {
  const entryLikeKeys = [
    "entry" in page,
    "component" in page,
    "app" in page,
  ].filter(Boolean);

  if (entryLikeKeys.length !== 1) {
    throw new Error(
      `[evjs] Page "${name}" must specify exactly one of entry, component, or app.`,
    );
  }
}
