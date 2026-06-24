import {
  type AbsoluteHttpUrlValidationError,
  BUILD_IDENTIFIER_DESCRIPTION,
  DEFAULT_SERVER_BASE_PATH,
  getAbsoluteHttpUrlValidationError,
  getPageRouteParamSegmentValidationError,
  getPathPatternListValidationError,
  getPathPatternValidationError,
  isBuildIdentifier,
  type PageRouteParamSegmentValidationError,
  type PathPatternListValidationError,
  type PathPatternValidationError,
} from "@evjs/shared";
import type {
  ComponentModel,
  HydrationMode,
  PageRouteNode,
  PprConfig,
  PrerenderConfig,
  RenderMode,
} from "@evjs/shared/manifest";
import { validatePageRenderingContract } from "./build-tools/page-rendering-contract.js";
import { routePathShapeFromPath } from "./build-tools/page-route-conventions.js";
import type { BundlerAdapter } from "./bundler.js";
import type { Plugin } from "./plugin.js";

/**
 * Default bundler config shape used by framework-core APIs.
 *
 * Utoopack is the default bundler path. Projects that switch bundlers can pass
 * a narrower generic or use the typed helper exported by that adapter.
 */
export type DefaultBundlerConfig = import("@utoo/pack").ConfigComplete;

export type {
  BuildResult,
  BundlerCtx,
  ClientManifest,
  EvBuildResult,
  EvBundlerCtx,
  EvDocument,
  EvPlugin,
  EvPluginConfigContext,
  EvPluginContext,
  EvPluginHooks,
  HtmlDocument,
  HtmlDocumentInfo,
  HtmlTransformContext,
  ManifestAssets,
  PageManifestEntry,
  Plugin,
  PluginConfigContext,
  PluginContext,
  PluginHooks,
  RouteEntry,
  ServerFnEntry,
  ServerManifest,
  ServerRouteEntry,
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
  ppr: string;
  rsc?: string;
}

/**
 * A version of Config where all fields with defaults are guaranteed.
 */
export interface ResolvedConfig<TBundlerCfg = DefaultBundlerConfig> {
  /** Client entry point (SPA mode). */
  entry: string;
  /** HTML template path (SPA mode). */
  html: string;
  /** Emitted HTML and asset-tag output options. */
  output: ResolvedOutputConfig;
  /**
   * Resolved pages for MPA mode.
   *
   * When set, the build produces one HTML file per page, each with its own
   * entry bundle. The single-entry `entry` and `html` fields are ignored.
   */
  pages?: Record<string, ResolvedPageConfig>;
  /** Resolved single SPA application declaration. */
  app?: ResolvedAppConfig;
  /** Framework-managed page routing declaration, when enabled. */
  routing?: ResolvedPageRoutingConfig;
  /** Internal application declarations. */
  apps?: Record<string, ResolvedAppConfig>;
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
export interface Config<TBundlerCfg = DefaultBundlerConfig> {
  /** Client entry point. Default: "./src/main.tsx". */
  entry?: string;
  /** HTML template path. Default: "./index.html". */
  html?: string;

  /** Emitted HTML and asset-tag output options. */
  output?: OutputConfig;

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
   * Single SPA application declaration.
   *
   * Use this for an explicitly bootstrapped SPA entry. Framework render
   * metadata is declared by imported page modules, not by a second route config
   * field in `ev.config.ts`.
   */
  app?: AppConfig;

  /**
   * Framework-managed page routing.
   *
   * When enabled, evjs discovers React page modules from `src/pages`. SPA mode
   * builds one framework-managed app internally; MPA mode emits independent
   * router-free pages.
   */
  routing?: boolean | RoutingConfig;

  /** Bundler adapter. When omitted, defaults to utoopack. */
  bundler?: BundlerAdapter<TBundlerCfg>;

  /**
   * Framework plugins to extend behavior or modify the bundler config.
   */
  plugins?: Plugin<TBundlerCfg>[];

  /**
   * MPA (Multi-Page Application) configuration.
   *
   * Define multiple independent page outputs. A string page is shorthand for a
   * React component module managed by the evjs page runtime. Use `{ entry }`
   * only when the page owns its own bootstrap.
   * When set, the build produces one HTML file per page and the single-entry
   * `entry` / `html` fields are ignored.
   *
   * @example
   * ```ts
   * pages: {
   *   home: "./src/pages/Home.tsx",
   *   about: {
   *     entry: "./src/pages/about/main.tsx",
   *     html: "./src/pages/about/index.html",
   *   },
   * }
   * ```
   */
  pages?: Record<string, PageConfig>;
}

export type EvConfig<TBundlerCfg = DefaultBundlerConfig> = Config<TBundlerCfg>;
export type ResolvedEvConfig<TBundlerCfg = DefaultBundlerConfig> =
  ResolvedConfig<TBundlerCfg>;

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

export type CrossOriginLoadingPolicy = false | "anonymous" | "use-credentials";

export interface OutputConfig {
  /**
   * Adds a `crossorigin` attribute to JavaScript and CSS asset tags in emitted
   * HTML documents and configures the browser chunk loader to use the same
   * policy for dynamically loaded chunks. Default: "anonymous".
   */
  crossOriginLoading?: CrossOriginLoadingPolicy;
}

export interface ResolvedOutputConfig {
  crossOriginLoading: CrossOriginLoadingPolicy;
}

export type AppConfig = string | AppSourceConfig | AppEntryConfig;

export interface AppSourceConfig {
  source: string;
}

export interface AppEntryConfig {
  entry: string;
  html?: string;
  mount?: string;
}

export interface ResolvedAppConfig {
  source?: string;
  entry?: string;
  html?: string;
  mount?: string;
}

export interface PageRoutingConfig {
  /**
   * Page routing output mode.
   *
   * `spa` builds one TanStack Router-backed application from the page tree.
   * `mpa` builds one independent page output per file without a client router.
   * Default: "spa".
   */
  mode?: PageRoutingMode;
  /** Directory containing page modules. Default: "./src/pages". */
  dir?: string;
  /** HTML template for generated page routes. Defaults to top-level `html`. */
  html?: string;
  /** Mount selector for generated page routes. Default: "#app". */
  mount?: string;
  /**
   * SPA root layout module.
   *
   * Defaults to the `layout/index.tsx` convention beside the page route
   * directory in SPA mode. Set to `false` to disable the framework root layout.
   * MPA mode does not use framework layouts.
   */
  layout?: PageRoutingLayoutConfig;
}

export type PageRoutingMode = "spa" | "mpa";
export type PageRoutingLayoutConfig = string | false;

export type RoutingConfig = PageRoutingConfig;
export type RoutingMode = PageRoutingMode;

export interface ResolvedPageRoutingConfig {
  mode: PageRoutingMode;
  dir: string;
  html: string;
  mount: string;
  layout?: PageRoutingLayoutConfig;
  entry?: string;
  routes: PageRouteNode[];
  rootModule?: string;
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
  clientProxy: "@evjs/client/internal",
  serverRegister: "@evjs/server/register",
  crossOriginLoading: "anonymous",
  routingDir: "./src/pages",
  routingMode: "spa",
  mount: "#app",
} as const;
const MPA_LAYOUT_UNSUPPORTED_MESSAGE =
  "[evjs] routing.layout is only supported in SPA mode. MPA pages should import shared shell components directly or use shared HTML templates.";
const PUBLIC_ROOT_CONFIG_KEYS = new Set([
  "entry",
  "html",
  "output",
  "dev",
  "server",
  "transport",
  "app",
  "routing",
  "bundler",
  "plugins",
  "pages",
]);
const PUBLIC_PAGE_ROUTING_CONFIG_KEYS = new Set([
  "mode",
  "dir",
  "html",
  "mount",
  "layout",
]);
const PUBLIC_APP_CONFIG_KEYS = new Set(["source", "entry", "html", "mount"]);
const PUBLIC_PAGE_CONFIG_KEYS = new Set([
  "path",
  "entry",
  "component",
  "app",
  "html",
  "mount",
  "render",
  "hydrate",
  "prerender",
  "rsc",
]);
const PUBLIC_DEV_CONFIG_KEYS = new Set(["port", "https", "proxy"]);
const PUBLIC_SERVER_CONFIG_KEYS = new Set(["entry", "basePath", "rsc", "dev"]);
const PUBLIC_SERVER_DEV_CONFIG_KEYS = new Set(["port", "https"]);
const PUBLIC_SERVER_RSC_CONFIG_KEYS = new Set(["endpoint"]);
const PUBLIC_TRANSPORT_CONFIG_KEYS = new Set(["baseUrl"]);
const PUBLIC_OUTPUT_CONFIG_KEYS = new Set(["crossOriginLoading"]);
const PUBLIC_HTTPS_CONFIG_KEYS = new Set(["key", "cert"]);
const PUBLIC_DEV_PROXY_RULE_KEYS = new Set([
  "context",
  "target",
  "changeOrigin",
  "secure",
]);
const PUBLIC_BUNDLER_CONFIG_KEYS = new Set(["name", "build", "dev"]);

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
  rsc: ServerConfig["rsc"],
  shouldExposeDefaultEndpoint: boolean,
  serverBasePath: string,
): string | undefined {
  if (!rsc && !shouldExposeDefaultEndpoint) return undefined;
  if (typeof rsc === "object" && rsc.endpoint !== undefined) {
    return normalizePath(assertRoutePath(rsc.endpoint, "server.rsc.endpoint"));
  }
  return joinPath(serverBasePath, "rsc");
}

/**
 * Deeply merge user configuration with defaults.
 */
export function resolveConfig<TBundlerCfg = DefaultBundlerConfig>(
  userConfig?: Config<TBundlerCfg>,
): ResolvedConfig<TBundlerCfg> {
  const config = resolveRootConfig(userConfig);
  const serverEnabled = config.server !== false;
  const devConfig = resolveOptionalObjectConfig<DevConfig>(config.dev, "dev");
  validateDevConfigKeys(devConfig);
  const serverConfig =
    config.server === false
      ? {}
      : resolveOptionalObjectConfig<ServerConfig>(config.server, "server");
  validateServerConfigKeys(serverConfig);
  const serverRscConfig = resolveServerRscConfig(serverConfig.rsc);
  const serverDevConfig = resolveOptionalObjectConfig<ServerDevConfig>(
    serverConfig.dev,
    "server.dev",
  );
  validateServerDevConfigKeys(serverDevConfig);
  const transportConfig = resolveOptionalObjectConfig<TransportConfig>(
    config.transport,
    "transport",
  );
  validateTransportConfigKeys(transportConfig);
  const outputConfig = resolveOptionalObjectConfig<OutputConfig>(
    config.output,
    "output",
  );
  validateOutputConfigKeys(outputConfig);

  const entry =
    config.entry === undefined
      ? CONFIG_DEFAULTS.entry
      : assertNonEmptyString(config.entry, "entry");
  const defaultHtml =
    config.html === undefined
      ? CONFIG_DEFAULTS.html
      : assertNonEmptyString(config.html, "html");

  const resolvedPages = resolvePagesConfig(config.pages, defaultHtml);

  const resolvedApp =
    config.app !== undefined
      ? resolveAppConfig(config.app, defaultHtml)
      : undefined;
  const resolvedPageRouting = resolvePageRoutingConfig(
    config.routing,
    defaultHtml,
  );
  const resolvedApps = resolvedApp ? { default: resolvedApp } : undefined;

  const serverEntry =
    serverConfig.entry === undefined
      ? undefined
      : assertNonEmptyString(serverConfig.entry, "server.entry");
  const clientPort =
    devConfig.port === undefined
      ? CONFIG_DEFAULTS.port
      : assertTcpPort(devConfig.port, "dev.port");
  const serverPort =
    serverDevConfig.port === undefined
      ? CONFIG_DEFAULTS.serverPort
      : assertTcpPort(serverDevConfig.port, "server.dev.port");
  const serverBasePath = normalizePath(
    serverConfig.basePath === undefined
      ? CONFIG_DEFAULTS.serverBasePath
      : assertRoutePath(serverConfig.basePath, "server.basePath"),
  );
  const serverEndpoint = joinPath(serverBasePath, "fn");
  const pprEndpoint = joinPath(serverBasePath, "ppr");
  const rscEndpoint = resolveRscEndpoint(
    serverRscConfig,
    serverEnabled,
    serverBasePath,
  );
  const devHttps = resolveDevHttpsConfig(devConfig.https);
  const serverHttps = resolveServerDevHttpsConfig(serverDevConfig.https);
  const serverTarget = new URL(
    serverHttps ? "https://localhost" : "http://localhost",
  );
  serverTarget.port = String(serverPort);

  return {
    entry,
    html: defaultHtml,
    pages: resolvedPages,
    app: resolvedApp,
    routing: resolvedPageRouting,
    apps: resolvedApps,
    dev: {
      port: clientPort,
      https: devHttps,
      proxy: [
        // User-defined proxies take precedence
        ...resolveDevProxyRules(devConfig.proxy),
        // Framework runtime paths proxy to the API dev server only when it exists.
        ...(serverEnabled
          ? [
              {
                context: [
                  toProxyContext(serverEndpoint),
                  toProxyContext(pprEndpoint),
                  ...(rscEndpoint ? [toProxyContext(rscEndpoint)] : []),
                ],
                target: serverTarget.origin,
                changeOrigin: true,
                secure: false,
              },
            ]
          : []),
      ],
    },
    serverEnabled,
    server: {
      entry: serverEntry,
      basePath: serverBasePath,
      runtime: {
        basePath: serverBasePath,
        fn: serverEndpoint,
        ppr: pprEndpoint,
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
        https: serverHttps,
      },
    },
    transport: {
      baseUrl:
        transportConfig.baseUrl === undefined
          ? undefined
          : assertHttpUrl(transportConfig.baseUrl, "transport.baseUrl"),
    },
    output: {
      crossOriginLoading:
        outputConfig.crossOriginLoading === undefined
          ? CONFIG_DEFAULTS.crossOriginLoading
          : assertCrossOriginPolicy(
              outputConfig.crossOriginLoading,
              "output.crossOriginLoading",
            ),
    },
    bundler: resolveBundlerConfig<TBundlerCfg>(config.bundler),
    plugins: resolvePluginsConfig(config.plugins),
  };
}

export function resolvePluginsConfig<TBundlerCfg = DefaultBundlerConfig>(
  plugins: unknown,
): Plugin<TBundlerCfg>[] {
  if (plugins === undefined) return [];
  if (!Array.isArray(plugins)) {
    throw new Error("[evjs] plugins must be an array of plugin objects.");
  }
  return plugins.map((plugin, index) =>
    resolvePluginConfig<TBundlerCfg>(plugin, index),
  );
}

function resolvePluginConfig<TBundlerCfg = DefaultBundlerConfig>(
  plugin: unknown,
  index: number,
): Plugin<TBundlerCfg> {
  const path = `plugins[${index}]`;
  const pluginConfig = assertObjectConfig(plugin, path, "a plugin object");
  const {
    name: rawName,
    dependencies: rawDependencies,
    optionalDependencies: rawOptionalDependencies,
    enforce: rawEnforce,
    config: rawConfig,
    setup: rawSetup,
  } = pluginConfig;

  if (rawConfig !== undefined) {
    assertFunction<NonNullable<Plugin<TBundlerCfg>["config"]>>(
      rawConfig,
      `${path}.config`,
    );
  }
  if (rawSetup !== undefined) {
    assertFunction<NonNullable<Plugin<TBundlerCfg>["setup"]>>(
      rawSetup,
      `${path}.setup`,
    );
  }
  const dependencies =
    rawDependencies === undefined
      ? undefined
      : cloneStringArray(rawDependencies, `${path}.dependencies`);
  const optionalDependencies =
    rawOptionalDependencies === undefined
      ? undefined
      : cloneStringArray(
          rawOptionalDependencies,
          `${path}.optionalDependencies`,
        );
  if (dependencies !== undefined && optionalDependencies !== undefined) {
    assertDisjointPluginDependencies(dependencies, optionalDependencies, path);
  }

  return {
    name: assertTrimmedNonEmptyString(rawName, `${path}.name`),
    ...(dependencies !== undefined ? { dependencies } : {}),
    ...(optionalDependencies !== undefined ? { optionalDependencies } : {}),
    ...(rawEnforce !== undefined
      ? {
          enforce: assertPluginEnforce(rawEnforce, `${path}.enforce`),
        }
      : {}),
    ...(rawConfig !== undefined ? { config: rawConfig } : {}),
    ...(rawSetup !== undefined ? { setup: rawSetup } : {}),
  };
}

function assertDisjointPluginDependencies(
  dependencies: string[],
  optionalDependencies: string[],
  path: string,
): void {
  const requiredNames = new Set(dependencies);
  const duplicate = optionalDependencies.find((name) =>
    requiredNames.has(name),
  );
  if (duplicate !== undefined) {
    throw new Error(
      `[evjs] ${path}.optionalDependencies must not repeat required dependency "${duplicate}".`,
    );
  }
}

export function resolveBundlerConfig<TBundlerCfg = DefaultBundlerConfig>(
  bundler: unknown,
  path = "bundler",
): BundlerAdapter<TBundlerCfg> | undefined {
  if (bundler === undefined) return undefined;
  assertBundlerAdapter<TBundlerCfg>(bundler, path);
  return bundler;
}

function assertBundlerAdapter<TBundlerCfg = DefaultBundlerConfig>(
  value: unknown,
  path: string,
): asserts value is BundlerAdapter<TBundlerCfg> {
  const bundlerConfig = assertObjectConfig(
    value,
    path,
    "a bundler adapter object",
  );
  validateBundlerConfigKeys(bundlerConfig, path);
  assertTrimmedNonEmptyString(bundlerConfig.name, `${path}.name`);
  assertFunction<BundlerAdapter<TBundlerCfg>["build"]>(
    bundlerConfig.build,
    `${path}.build`,
  );
  assertFunction<BundlerAdapter<TBundlerCfg>["dev"]>(
    bundlerConfig.dev,
    `${path}.dev`,
  );
}

function validateBundlerConfigKeys(
  bundler: Record<string, unknown>,
  path: string,
): void {
  assertKnownConfigKeys(
    bundler,
    PUBLIC_BUNDLER_CONFIG_KEYS,
    path,
    "name, build, or dev",
  );
}

function resolveRootConfig<TBundlerCfg = DefaultBundlerConfig>(
  config: Config<TBundlerCfg> | undefined,
): Config<TBundlerCfg> {
  if (config === undefined) return {};
  const rootConfig = assertObjectConfig(config, "config", "a config object");
  validateRootConfigKeys(rootConfig);
  return rootConfig as Config<TBundlerCfg>;
}

function resolveOptionalObjectConfig<T>(value: unknown, path: string): T {
  if (value === undefined) return {} as T;
  return assertObjectConfig(value, path, "a config object") as T;
}

function assertKnownConfigKeys(
  config: object,
  allowedKeys: ReadonlySet<string>,
  path: string,
  supportedKeys: string,
  getCustomError?: (key: string) => string | undefined,
): void {
  for (const key of Object.keys(config)) {
    if (allowedKeys.has(key)) continue;
    const customError = getCustomError?.(key);
    throw new Error(
      customError ??
        `[evjs] ${path}.${key} is not supported. Use ${supportedKeys}.`,
    );
  }
}

function validateRootConfigKeys(config: Record<string, unknown>): void {
  assertKnownConfigKeys(
    config,
    PUBLIC_ROOT_CONFIG_KEYS,
    "config",
    "entry, html, output, dev, server, transport, app, routing, bundler, plugins, or pages",
    (key) => {
      if (key === "apps") {
        return "[evjs] config.apps is resolved framework metadata and cannot be configured. Use app for one explicit SPA, routing for file routes, or pages for explicit page outputs.";
      }
      if (key === "routes") {
        return "[evjs] config.routes is not a public config field. Use routing for file routes or pages for explicit page outputs.";
      }
      if (key === "functions" || key === "serverFunctions") {
        return `[evjs] config.${key} is not a public config field. Server functions are discovered from "use server" modules and endpoints are derived from server.basePath.`;
      }
    },
  );
}

function resolveServerRscConfig(rsc: ServerConfig["rsc"]): ServerConfig["rsc"] {
  if (rsc === undefined || typeof rsc === "boolean") return rsc;
  const rscConfig = assertObjectConfig(
    rsc,
    "server.rsc",
    "a server RSC object",
  );
  validateServerRscConfigKeys(rscConfig);
  return rscConfig as ServerRscConfig;
}

function validateServerConfigKeys(server: ServerConfig): void {
  assertKnownConfigKeys(
    server,
    PUBLIC_SERVER_CONFIG_KEYS,
    "server",
    "entry, basePath, rsc, or dev",
    (key) => {
      if (key === "functions") {
        return "[evjs] server.functions is not a public config field. Server function, PPR, and RSC endpoints are derived from server.basePath.";
      }
      if (key === "runtime" || key === "functionRuntime") {
        return `[evjs] server.${key} is resolved framework metadata and cannot be configured. Use server.basePath to change framework endpoint paths.`;
      }
    },
  );
}

function validateDevConfigKeys(dev: DevConfig): void {
  assertKnownConfigKeys(
    dev,
    PUBLIC_DEV_CONFIG_KEYS,
    "dev",
    "port, https, or proxy",
  );
}

function validateServerDevConfigKeys(dev: ServerDevConfig): void {
  assertKnownConfigKeys(
    dev,
    PUBLIC_SERVER_DEV_CONFIG_KEYS,
    "server.dev",
    "port or https",
  );
}

function validateServerRscConfigKeys(rsc: Record<string, unknown>): void {
  assertKnownConfigKeys(
    rsc,
    PUBLIC_SERVER_RSC_CONFIG_KEYS,
    "server.rsc",
    "endpoint",
  );
}

function validateTransportConfigKeys(transport: TransportConfig): void {
  assertKnownConfigKeys(
    transport,
    PUBLIC_TRANSPORT_CONFIG_KEYS,
    "transport",
    "baseUrl",
  );
}

function validateOutputConfigKeys(output: OutputConfig): void {
  assertKnownConfigKeys(
    output,
    PUBLIC_OUTPUT_CONFIG_KEYS,
    "output",
    "crossOriginLoading",
  );
}

function resolvePageRoutingConfig(
  routing: Config["routing"] | null,
  defaultHtml: string,
): ResolvedPageRoutingConfig | undefined {
  if (routing === undefined || routing === false) return undefined;
  let options: PageRoutingConfig;
  if (routing === true) {
    options = {};
  } else if (
    routing &&
    typeof routing === "object" &&
    !Array.isArray(routing)
  ) {
    options = routing as PageRoutingConfig;
  } else {
    throw new Error("[evjs] routing must be true, false, or a routing object.");
  }
  validatePageRoutingConfigKeys(options);
  const mode = resolvePageRoutingMode(options.mode);
  if (mode === "mpa" && options.layout !== undefined) {
    throw new Error(MPA_LAYOUT_UNSUPPORTED_MESSAGE);
  }
  const layout = resolvePageRoutingLayout(options.layout);
  return {
    mode,
    dir:
      options.dir === undefined
        ? CONFIG_DEFAULTS.routingDir
        : assertNonEmptyString(options.dir, "routing.dir"),
    html:
      options.html === undefined
        ? defaultHtml
        : assertNonEmptyString(options.html, "routing.html"),
    mount:
      options.mount === undefined
        ? CONFIG_DEFAULTS.mount
        : assertNonEmptyString(options.mount, "routing.mount"),
    ...(layout !== undefined ? { layout } : {}),
    routes: [],
  };
}

function validatePageRoutingConfigKeys(routing: PageRoutingConfig): void {
  assertKnownConfigKeys(
    routing,
    PUBLIC_PAGE_ROUTING_CONFIG_KEYS,
    "routing",
    "mode, dir, html, mount, or layout",
    (key) => {
      if (key === "entry") {
        return "[evjs] routing.entry is not a public config field. Use top-level entry or app entries for SPA applications; MPA routing creates one page entry per route file.";
      }
      if (key === "routes") {
        return "[evjs] routing.routes is not a public config field. evjs discovers page routes from routing.dir; use pages for explicit non-conventional page declarations.";
      }
    },
  );
}

function resolvePageRoutingMode(
  mode: PageRoutingMode | undefined,
): PageRoutingMode {
  const resolved = mode ?? CONFIG_DEFAULTS.routingMode;
  if (resolved === "spa" || resolved === "mpa") return resolved;
  throw new Error('[evjs] routing.mode must be "spa" or "mpa".');
}

function resolvePageRoutingLayout(
  layout: PageRoutingLayoutConfig | undefined,
): PageRoutingLayoutConfig | undefined {
  if (layout === undefined || layout === false) return layout;
  if (typeof layout === "string") {
    return assertNonEmptyString(layout, "routing.layout");
  }
  throw new Error("[evjs] routing.layout must be false or a non-empty string.");
}

function resolveAppConfig(
  app: AppConfig,
  defaultHtml: string,
): ResolvedAppConfig {
  if (typeof app === "string") {
    return { source: assertNonEmptyString(app, "app") };
  }
  if (!app || typeof app !== "object" || Array.isArray(app)) {
    throw new Error(
      "[evjs] app must be a string module path or an app object.",
    );
  }
  validateAppConfigKeys(app);

  const hasSource = "source" in app;
  const hasEntry = "entry" in app;
  if (hasSource === hasEntry) {
    throw new Error("[evjs] app must specify exactly one of source or entry.");
  }
  if (hasSource) {
    return { source: assertNonEmptyString(app.source, "app.source") };
  }
  return {
    entry: assertNonEmptyString(app.entry, "app.entry"),
    html:
      app.html === undefined
        ? defaultHtml
        : assertNonEmptyString(app.html, "app.html"),
    mount:
      app.mount === undefined
        ? undefined
        : assertNonEmptyString(app.mount, "app.mount"),
  };
}

function resolvePagesConfig(
  pages: Config["pages"],
  defaultHtml: string,
): ResolvedConfig["pages"] {
  const entries =
    pages === undefined
      ? []
      : Object.entries(assertObjectConfig(pages, "pages", "an object map"));
  if (entries.length === 0) return undefined;

  const resolved: NonNullable<ResolvedConfig["pages"]> = {};
  const pagePathOwners = new Map<string, string>();
  const pagePathShapeOwners = new Map<string, { name: string; path: string }>();

  for (const [name, page] of entries) {
    assertBuildIdentifierObjectKey(name, "pages");
    const pageConfig = resolvePageObjectConfig(name, page);
    validatePageConfig(name, pageConfig);

    const routePath =
      "path" in pageConfig && pageConfig.path !== undefined
        ? assertPageRoutePath(pageConfig.path, `pages.${name}.path`)
        : undefined;
    if (routePath) {
      const existing = pagePathOwners.get(routePath);
      if (existing) {
        throw new Error(
          `[evjs] pages.${name}.path duplicates pages.${existing}.path "${routePath}". Page paths must be unique.`,
        );
      }
      pagePathOwners.set(routePath, name);
      const routeShape = routePathShapeFromPath(routePath).key;
      const existingShapeOwner = pagePathShapeOwners.get(routeShape);
      if (existingShapeOwner) {
        throw new Error(
          `[evjs] pages.${name}.path "${routePath}" has the same route shape as pages.${existingShapeOwner.name}.path "${existingShapeOwner.path}". Use one dynamic param name for each URL shape.`,
        );
      }
      pagePathShapeOwners.set(routeShape, { name, path: routePath });
    }

    resolved[name] = {
      path: routePath,
      entry:
        "entry" in pageConfig
          ? assertNonEmptyString(pageConfig.entry, `pages.${name}.entry`)
          : undefined,
      component:
        "component" in pageConfig
          ? assertNonEmptyString(
              pageConfig.component,
              `pages.${name}.component`,
            )
          : undefined,
      app:
        "app" in pageConfig
          ? assertNonEmptyString(pageConfig.app, `pages.${name}.app`)
          : undefined,
      html:
        pageConfig.html === undefined
          ? defaultHtml
          : assertNonEmptyString(pageConfig.html, `pages.${name}.html`),
      mount:
        pageConfig.mount === undefined
          ? undefined
          : assertNonEmptyString(pageConfig.mount, `pages.${name}.mount`),
      ...resolvePageRenderingConfig(name, pageConfig),
    };
  }

  return resolved;
}

function resolvePageObjectConfig(
  name: string,
  page: unknown,
): PageObjectConfig {
  if (typeof page === "string") return { component: page };
  if (page && typeof page === "object" && !Array.isArray(page)) {
    validatePageConfigKeys(name, page);
    return page as PageObjectConfig;
  }
  throw new Error(
    `[evjs] pages.${name} must be a string module path or a page object.`,
  );
}

function validateAppConfigKeys(app: object): void {
  assertKnownConfigKeys(
    app,
    PUBLIC_APP_CONFIG_KEYS,
    "app",
    "source, entry, html, or mount",
  );
}

function validatePageConfigKeys(name: string, page: object): void {
  assertKnownConfigKeys(
    page,
    PUBLIC_PAGE_CONFIG_KEYS,
    `pages.${name}`,
    "path, entry, component, app, html, mount, render, hydrate, prerender, or rsc",
  );
}

function resolvePageRenderingConfig(
  name: string,
  page: PageObjectConfig,
): Pick<
  ResolvedPageConfig,
  "render" | "componentModel" | "hydrate" | "prerender" | "ppr"
> {
  const renderingKey = getPageRenderingConfigKey(page);
  if (!renderingKey) return {};
  if (!("component" in page)) {
    throw new Error(
      `[evjs] pages.${name}.${renderingKey} is only supported on component pages.`,
    );
  }

  const prerender = resolvePagePrerenderConfig(
    page.prerender,
    `pages.${name}.prerender`,
  );
  const ppr = derivePagePprConfig(prerender);
  const rsc = assertOptionalBoolean(page.rsc, `pages.${name}.rsc`);
  const render =
    page.render === undefined
      ? undefined
      : assertPageRenderMode(page.render, `pages.${name}.render`);
  const hydrate =
    page.hydrate === undefined
      ? undefined
      : assertPageHydrationMode(page.hydrate, `pages.${name}.hydrate`);
  const resolved: Pick<
    ResolvedPageConfig,
    "render" | "componentModel" | "hydrate" | "prerender" | "ppr"
  > = {
    ...(render !== undefined ? { render } : {}),
    ...(rsc ? { componentModel: "rsc" as const } : {}),
    ...(hydrate !== undefined ? { hydrate } : {}),
    ...(prerender !== undefined ? { prerender } : {}),
    ...(ppr ? { ppr } : {}),
  };

  validatePageRenderingContract(`pages.${name}`, resolved, {
    requireExplicitRenderForFullPrerender: true,
  });
  return resolved;
}

function getPageRenderingConfigKey(page: PageObjectConfig): string | undefined {
  return ["render", "hydrate", "prerender", "rsc"].find((key) => key in page);
}

function assertPageRenderMode(value: unknown, path: string): RenderMode {
  if (value === "csr" || value === "ssr" || value === "ssg") return value;
  if (value === "ppr") {
    throw new Error(
      `[evjs] ${path} mode "ppr" is not supported. Use render: "ssr" with prerender: { partial: true }.`,
    );
  }
  throw new Error(`[evjs] ${path} must be "csr", "ssr", or "ssg".`);
}

function assertPageHydrationMode(value: unknown, path: string): HydrationMode {
  if (
    value === "none" ||
    value === "load" ||
    value === "visible" ||
    value === "idle"
  ) {
    return value;
  }
  throw new Error(
    `[evjs] ${path} must be "none", "load", "visible", or "idle".`,
  );
}

function assertCrossOriginPolicy(
  value: unknown,
  path: string,
): CrossOriginLoadingPolicy {
  if (value === false || value === "anonymous" || value === "use-credentials") {
    return value;
  }
  throw new Error(
    `[evjs] ${path} must be false, "anonymous", or "use-credentials".`,
  );
}

function resolvePagePrerenderConfig(
  value: unknown,
  path: string,
): PrerenderConfig | undefined {
  if (value === undefined) return undefined;
  if (value === true) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`[evjs] ${path} must be true or an object.`);
  }

  const prerender = value as Exclude<PrerenderConfig, true>;
  const known = new Set(["partial", "delivery", "revalidate"]);
  const unknownKeys = Object.keys(prerender).filter((key) => !known.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(
      `[evjs] ${path} can only contain partial, delivery, or revalidate.`,
    );
  }
  if (Object.keys(prerender).length === 0) {
    throw new Error(
      `[evjs] ${path} object must declare partial, delivery, or revalidate.`,
    );
  }

  const config: Exclude<PrerenderConfig, true> = {};
  if (prerender.partial !== undefined) {
    if (typeof prerender.partial !== "boolean") {
      throw new Error(`[evjs] ${path}.partial must be a boolean.`);
    }
    config.partial = prerender.partial;
  }
  if (prerender.delivery !== undefined) {
    if (prerender.delivery !== "merge" && prerender.delivery !== "stream") {
      throw new Error(`[evjs] ${path}.delivery must be "merge" or "stream".`);
    }
    config.delivery = prerender.delivery;
  }
  if (prerender.revalidate !== undefined) {
    if (
      prerender.revalidate !== false &&
      (typeof prerender.revalidate !== "number" ||
        !isPositiveInteger(prerender.revalidate))
    ) {
      throw new Error(
        `[evjs] ${path}.revalidate must be a positive integer number of seconds or false.`,
      );
    }
    config.revalidate = prerender.revalidate;
  }

  return config;
}

function derivePagePprConfig(
  prerender: PrerenderConfig | undefined,
): Pick<PprConfig, "delivery" | "revalidate"> | undefined {
  if (!prerender || prerender === true || !prerender.partial) {
    return undefined;
  }
  return {
    delivery: prerender.delivery ?? "merge",
    ...(prerender.revalidate !== undefined
      ? { revalidate: prerender.revalidate }
      : {}),
  };
}

function resolveDevHttpsConfig(
  https: DevConfig["https"],
): ResolvedDevConfig["https"] {
  if (https === undefined) return false;
  if (typeof https === "boolean") return https;
  const httpsConfig = assertObjectConfig(
    https,
    "dev.https",
    "an HTTPS config object",
  );
  validateHttpsConfigKeys(httpsConfig, "dev.https");
  return {
    key: assertNonEmptyString(httpsConfig.key, "dev.https.key"),
    cert: assertNonEmptyString(httpsConfig.cert, "dev.https.cert"),
  };
}

function resolveServerDevHttpsConfig(
  https: ServerDevConfig["https"],
): ResolvedServerDevConfig["https"] {
  if (https === undefined || https === false) return false;
  const httpsConfig = assertObjectConfig(
    https,
    "server.dev.https",
    "an HTTPS config object",
  );
  validateHttpsConfigKeys(httpsConfig, "server.dev.https");
  return {
    key: assertNonEmptyString(httpsConfig.key, "server.dev.https.key"),
    cert: assertNonEmptyString(httpsConfig.cert, "server.dev.https.cert"),
  };
}

function validateHttpsConfigKeys(
  https: Record<string, unknown>,
  path: "dev.https" | "server.dev.https",
): void {
  assertKnownConfigKeys(https, PUBLIC_HTTPS_CONFIG_KEYS, path, "key and cert");
}

function resolveDevProxyRules(proxy: DevConfig["proxy"]): DevProxyRule[] {
  if (proxy === undefined) return [];
  if (!Array.isArray(proxy)) {
    throw new Error("[evjs] dev.proxy must be an array of proxy rules.");
  }
  return proxy.map((rule, index) => resolveDevProxyRule(rule, index));
}

function resolveDevProxyRule(rule: unknown, index: number): DevProxyRule {
  const path = `dev.proxy[${index}]`;
  const ruleConfig = assertObjectConfig(rule, path, "a proxy rule object");
  validateDevProxyRuleKeys(ruleConfig, path);
  const context = clonePathPatterns(ruleConfig.context, `${path}.context`);
  const changeOrigin = assertOptionalBoolean(
    ruleConfig.changeOrigin,
    `${path}.changeOrigin`,
  );
  const secure = assertOptionalBoolean(ruleConfig.secure, `${path}.secure`);

  return {
    context,
    target: assertHttpUrl(ruleConfig.target, `${path}.target`),
    ...(changeOrigin !== undefined ? { changeOrigin } : {}),
    ...(secure !== undefined ? { secure } : {}),
  };
}

function validateDevProxyRuleKeys(
  rule: Record<string, unknown>,
  path: string,
): void {
  assertKnownConfigKeys(
    rule,
    PUBLIC_DEV_PROXY_RULE_KEYS,
    path,
    "context, target, changeOrigin, or secure",
  );
}

function assertTcpPort(value: number, path: string): number {
  if (Number.isInteger(value) && value >= 1 && value <= 65535) return value;
  throw new Error(
    `[evjs] ${path} must be an integer TCP port from 1 to 65535.`,
  );
}

function assertNonEmptyObjectKey(key: string, path: string): void {
  if (key.trim()) return;
  throw new Error(`[evjs] ${path} must not contain empty keys.`);
}

function assertBuildIdentifierObjectKey(key: string, path: string): void {
  assertNonEmptyObjectKey(key, path);
  if (isBuildIdentifier(key)) return;
  throw new Error(
    `[evjs] ${path} key "${key}" must contain only ${BUILD_IDENTIFIER_DESCRIPTION}.`,
  );
}

function assertNonEmptyString(value: unknown, path: string): string {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`[evjs] ${path} must be a non-empty string.`);
}

function assertObjectConfig(
  value: unknown,
  path: string,
  description: string,
): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`[evjs] ${path} must be ${description}.`);
}

function assertTrimmedNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`[evjs] ${path} must be a non-empty string.`);
  }
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] ${path} must not contain leading or trailing whitespace.`,
    );
  }
  return value;
}

function assertHttpUrl(value: unknown, path: string): string {
  const error = getAbsoluteHttpUrlValidationError(value);
  if (error) {
    throw new Error(`[evjs] ${path} ${formatAbsoluteHttpUrlError(error)}`);
  }
  return value as string;
}

function formatAbsoluteHttpUrlError(
  error: AbsoluteHttpUrlValidationError,
): string {
  switch (error) {
    case "empty":
      return "must be a non-empty string.";
    case "whitespace":
      return "must not contain leading or trailing whitespace.";
    case "not-absolute-http-url":
      return "must be an absolute http(s) URL.";
  }
}

function assertRoutePath(value: unknown, path: string): string {
  const error = getPathPatternValidationError(value);
  if (!error) return value as string;
  throw new Error(`[evjs] ${path} ${formatRoutePathValidationError(error)}`);
}

function assertPageRoutePath(value: unknown, path: string): string {
  const routePath = assertRoutePath(value, path);
  const paramError = getPageRouteParamSegmentValidationError(routePath);
  if (paramError) {
    throw new Error(
      `[evjs] ${path} ${formatPageRouteParamValidationError(paramError)}`,
    );
  }
  return routePath;
}

function formatRoutePathValidationError(
  error: PathPatternValidationError,
): string {
  switch (error) {
    case "empty":
      return "must be a non-empty string.";
    case "missing-leading-slash":
      return 'must start with "/".';
    case "whitespace":
      return "must not contain whitespace.";
    case "query-or-hash":
      return "must not include a query string or hash.";
  }
}

function formatPageRouteParamValidationError(
  error: PageRouteParamSegmentValidationError,
): string {
  switch (error.error) {
    case "empty":
      return `contains dynamic segment "${error.segment}" without a param name.`;
    case "reserved":
      return `uses reserved dynamic param name "${error.name}" in segment "${error.segment}". Use a safe application-specific name.`;
    case "duplicate":
      return `uses duplicate dynamic param name "${error.name}" in segment "${error.segment}". Use unique param names within one route path.`;
    case "duplicate-wildcard":
      return `contains more than one wildcard segment "${error.segment}". Use at most one wildcard segment in a route path.`;
  }
}

function assertOptionalBoolean(
  value: unknown,
  path: string,
): boolean | undefined {
  if (value === undefined || typeof value === "boolean") return value;
  throw new Error(`[evjs] ${path} must be a boolean when provided.`);
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function assertFunction<
  TFunction extends (...args: never[]) => unknown = (
    ...args: never[]
  ) => unknown,
>(value: unknown, path: string): asserts value is TFunction {
  if (typeof value === "function") return;
  throw new Error(`[evjs] ${path} must be a function.`);
}

function assertPluginEnforce(value: unknown, path: string): Plugin["enforce"] {
  if (value === "pre" || value === "normal" || value === "post") {
    return value;
  }
  throw new Error(`[evjs] ${path} must be "pre", "normal", or "post".`);
}

function cloneStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`[evjs] ${path} must be an array of plugin names.`);
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const pluginName = assertTrimmedNonEmptyString(item, `${path}[${index}]`);
    if (seen.has(pluginName)) {
      throw new Error(
        `[evjs] ${path} must not contain duplicate plugin name "${pluginName}".`,
      );
    }
    seen.add(pluginName);
    return pluginName;
  });
}

function clonePathPatterns(value: unknown, path: string): string[] {
  const error = getPathPatternListValidationError(value);
  if (error) throwPathPatternListError(error, path);
  return [...(value as string[])];
}

function throwPathPatternListError(
  error: PathPatternListValidationError,
  path: string,
): never {
  switch (error.kind) {
    case "not-array":
      throw new Error(`[evjs] ${path} must be an array of path patterns.`);
    case "empty-array":
      throw new Error(`[evjs] ${path} must contain at least one path.`);
    case "duplicate-pattern":
      throw new Error(
        `[evjs] ${path} must not contain duplicate pattern "${error.pattern}".`,
      );
    case "invalid-pattern":
      throwPathPatternError(error.value, error.error, path);
  }
}

function throwPathPatternError(
  value: unknown,
  error: PathPatternValidationError,
  path: string,
): never {
  if (error === "empty" || typeof value !== "string") {
    throw new Error(`[evjs] ${path} must contain only non-empty strings.`);
  }
  if (error === "whitespace") {
    throw new Error(
      `[evjs] ${path} pattern "${value}" must not contain whitespace.`,
    );
  }
  if (error === "missing-leading-slash") {
    throw new Error(`[evjs] ${path} pattern "${value}" must start with "/".`);
  }
  throw new Error(
    `[evjs] ${path} pattern "${value}" must not include a query string or hash.`,
  );
}

/**
 * Define the evjs framework configuration with type inference.
 *
 * @param config - The framework configuration object.
 * @returns The exact same configuration object.
 */
export function defineConfig<TBundlerCfg = DefaultBundlerConfig>(
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
  /** Optional URL pathname served by the framework server for this page. */
  path?: string;
  /** Client entry point for this page. */
  entry: string;
  /** HTML template path. If omitted, uses the top-level `html` default. */
  html?: string;
  mount?: string;
}

export interface PageComponentConfig {
  /** Optional URL pathname served by the framework server for this page. */
  path?: string;
  /** React component module mounted by the evjs page runtime. */
  component: string;
  /** HTML template path. If omitted, uses the top-level `html` default. */
  html?: string;
  mount?: string;
  /** Framework document render mode. Defaults to "csr". */
  render?: RenderMode;
  /** Framework hydration mode. Defaults to "load" except SSG defaults to "none". */
  hydrate?: HydrationMode;
  /** Prerender behavior for SSR/SSG component pages. */
  prerender?: PrerenderConfig;
  /** Enable React Server Components for this component page. */
  rsc?: boolean;
}

export interface PageAppConfig {
  /** Optional URL pathname served by the framework server for this page. */
  path?: string;
  /** Lifecycle module with mount/hydrate/unmount exports. */
  app: string;
  /** HTML template path. If omitted, uses the top-level `html` default. */
  html?: string;
  mount?: string;
}

export interface ResolvedPageConfig {
  path?: string;
  entry?: string;
  component?: string;
  app?: string;
  html: string;
  mount?: string;
  render?: RenderMode;
  componentModel?: ComponentModel;
  hydrate?: HydrationMode;
  prerender?: PrerenderConfig;
  ppr?: PprConfig;
}

/**
 * Whether the resolved config is in MPA (multi-page) mode.
 */
export function isMpa<T = unknown>(config: ResolvedConfig<T>): boolean {
  return (
    (config.pages !== undefined && Object.keys(config.pages).length > 0) ||
    config.routing?.mode === "mpa"
  );
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
