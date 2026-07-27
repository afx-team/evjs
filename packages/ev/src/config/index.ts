import {
  type AbsoluteHttpUrlValidationError,
  DEFAULT_SERVER_BASE_PATH,
  getAbsoluteHttpUrlValidationError,
  getPathPatternListValidationError,
  getPathPatternValidationError,
  type PathPatternListValidationError,
  type PathPatternValidationError,
} from "@evjs/shared";
import type {
  BigfishRouteExtension,
  BigfishRouteMappedString,
  BigfishRouteMenuKey,
  BigfishRouteStaticValue,
  HydrationMode,
  PageMetadata,
  PageRouteNode,
  PrerenderConfig,
  RenderMode,
  ServerMiddlewareNode,
  ServerRouteNode,
} from "@evjs/shared/manifest";
import type { BundlerAdapter } from "../_internal/build/bundler.js";
import { isPluginLifecycleDescriptorField } from "../plugin/hook-names.js";
import type { Plugin } from "../plugin/index.js";
import { resolveBigfishRouteMetadata } from "./bigfish-route-metadata.js";
import {
  type ConfigExtensionValues,
  type ResolvedApplicationExtensionValues,
  resolveConfigExtensionValues,
  type StaticConfigValue,
} from "./extensions.js";

export type { PageMetadata } from "@evjs/shared/manifest";
export type {
  ConfigExtensionNamespace,
  ConfigExtensionValues,
  ResolvedApplicationExtensionValues,
  StaticConfigCompatible,
  StaticConfigValue,
} from "./extensions.js";

/**
 * Default bundler config shape used by framework-core APIs.
 *
 * Utoopack is the default bundler path. Projects that switch bundlers can pass
 * a narrower generic or use the typed helper exported by that adapter.
 */
export type DefaultBundlerConfig = import("@utoo/pack").ConfigComplete;

export { type ConfigPatch, merge } from "./merge.js";

/** Resolved dev server configuration (all defaults applied). */
export interface ResolvedDevConfig {
  /** Client dev server port. */
  port: number;
  /** HTTPS configuration. */
  https: boolean | { key: string; cert: string };
  /** Dev proxy rules. */
  proxy: DevProxyRule[];
}

/** Proxy rule for the dev server. */
export interface DevProxyRule {
  context: string[];
  target: string;
  pathRewrite?: DevProxyPathRewrite;
  changeOrigin?: boolean;
  secure?: boolean;
}

export type DevProxyPathRewrite =
  | Record<string, string>
  | ((path: string) => string);

/** Resolved server dev configuration (all defaults applied). */
export interface ResolvedServerDevConfig {
  /** API server port (dev mode). */
  port: number;
  /** HTTPS for the API server. */
  https: { key: string; cert: string } | false;
}

/** Resolved server configuration (all defaults applied). */
export interface ResolvedServerConfig {
  /** Framework server runtime base path. */
  basePath: string;
  /** Derived framework server runtime paths. */
  runtime: ResolvedServerRuntimeConfig;
  /** RSC Flight endpoint configuration when enabled. */
  rsc?: ResolvedServerRscConfig;
  /** Framework-managed server file routing declaration, when enabled. */
  routing?: ResolvedServerRoutingConfig;
  /** Framework-managed server conventions, when enabled. */
  conventions?: ResolvedServerConventionsConfig;
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
  /** Whether framework file conventions are enabled. */
  conventions: boolean;
  /** Emitted HTML and asset-tag output options. */
  output: ResolvedOutputConfig;
  /** Framework-managed page routing declaration, when enabled. */
  routing?: ResolvedPageRoutingConfig;
  /** @internal Normalized Bigfish-style SPA migration input. */
  application?: ResolvedConfigRouteApplication;
  /**
   * Statically validated Application extension input authored in ev.config.
   *
   * Plugin defaults, merge, and validation run later, before setup().
   */
  extensions: Readonly<Record<string, StaticConfigValue>>;
  /** Client dev server options. */
  dev: ResolvedDevConfig;
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
 * Framework config after plugin Application extensions have been materialized.
 *
 * This is the config snapshot exposed to setup, lifecycle, contribution, and
 * bundler contexts.
 */
export type ResolvedFrameworkConfig<TBundlerCfg = DefaultBundlerConfig> = Omit<
  ResolvedConfig<TBundlerCfg>,
  "extensions"
> & {
  extensions: ResolvedApplicationExtensionValues;
};

/**
 * evjs framework configuration.
 */
export interface Config<TBundlerCfg = DefaultBundlerConfig> {
  /**
   * Enable framework file conventions.
   *
   * Defaults to `true`. Set to `false` only when the application owns all
   * browser and server runtime composition explicitly. This is the only
   * convention opt-out; individual Page, route, layout, and middleware
   * conventions cannot be disabled independently.
   */
  conventions?: boolean;

  /** Emitted HTML and asset-tag output options. */
  output?: OutputConfig;

  /** Client dev server options. */
  dev?: DevConfig;

  /** Server configuration. */
  server?: ServerConfig;

  /**
   * Browser-to-server transport options.
   *
   * Same-origin applications do not need this. Set `baseUrl` only when the
   * browser runtime calls a framework server hosted on another origin.
   */
  transport?: TransportConfig;

  /**
   * Framework-managed Page routing.
   *
   * Set only `mode` to choose SPA or MPA materialization. Both modes discover
   * the same `page.*`-anchored Page tree under `src/pages`; changing the mode
   * does not change Page identity or private directory scope.
   *
   * Discovery runs only when `routing` is explicitly present. Omission never
   * scans `src/pages`.
   */
  routing?: PageRoutingConfig;

  /**
   * Temporary migration input for an explicit Bigfish SPA route tree.
   * It cannot be combined with canonical `routing`; remove it after moving
   * each published Page to a `page.*` anchor.
   */
  application?: ConfigRouteApplication;

  /**
   * Namespaced, static Application configuration owned by active plugins.
   *
   * Values are validated and merged by the matching
   * `applicationExtension()` declaration. Executable plugin options belong in
   * the plugin factory instead of this CoreGraph-bound data.
   */
  extensions?: ConfigExtensionValues;

  /** Bundler adapter. When omitted, defaults to utoopack. */
  bundler?: BundlerAdapter<TBundlerCfg>;

  /**
   * Framework plugins to extend behavior or modify the bundler config.
   */
  plugins?: Plugin<TBundlerCfg>[];
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
  /**
   * Framework-managed server file routing.
   *
   * Defaults to enabled. evjs discovers Request/Response `api.*` anchors from
   * `src/apis` while top-level file conventions are enabled.
   */
  routing?: ServerRoutingConfig;
  /**
   * Framework server runtime base path. Defaults to "/__evjs".
   *
   * Server function, PPR, and RSC endpoints are derived from this path.
   */
  basePath?: string;
  /**
   * Optional RSC Flight endpoint override.
   *
   * RSC is enabled by a Page's `page.config.ts`, not by server config.
   */
  rsc?: ServerRscConfig;
  /** Server dev options. */
  dev?: ServerDevConfig;
}

export interface ServerRscConfig {
  /** RSC Flight endpoint path override. */
  endpoint: string;
}

export interface ResolvedServerRscConfig {
  endpoint: string;
}

export interface ServerRoutingConfig {
  /** Directory containing server route modules. Default: "./src/apis". */
  dir?: string;
}

export interface ResolvedServerRoutingConfig {
  dir: string;
  routes: ServerRouteNode[];
}

export interface ResolvedServerConventionsConfig {
  globalMiddlewares: ServerMiddlewareNode[];
  routeMiddlewares: ServerMiddlewareNode[];
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
   * Directory for browser/public build artifacts. Default: "dist/client".
   */
  client?: string;
  /**
   * Directory for framework server build artifacts. Default: "dist/server".
   */
  server?: string;
  /**
   * Adds a `crossorigin` attribute to JavaScript and CSS asset tags in emitted
   * HTML documents and configures the browser chunk loader to use the same
   * policy for dynamically loaded chunks. Default: "anonymous".
   */
  crossOriginLoading?: CrossOriginLoadingPolicy;
}

export interface ResolvedOutputConfig {
  client: string;
  server: string;
  crossOriginLoading: CrossOriginLoadingPolicy;
}

export interface PageRoutingConfig {
  /**
   * Page materialization mode.
   *
   * Both values use the same `page.*` Page tree. `spa` builds one client-routed
   * application; `mpa` builds one independent document per Page.
   */
  mode: PageRoutingMode;
  /** Directory containing page modules. Default: "./src/pages". */
  dir?: string;
  /** HTML template for generated page routes. Default: "./index.html". */
  html?: string;
  /** Mount selector for generated page routes. Default: "#app". */
  mount?: string;
}

export type PageRoutingMode = "spa" | "mpa";

/**
 * Canonical configuration colocated with a `page.*` Page anchor.
 *
 * The module is evaluated by evjs at build time. Its resolved value must be
 * static JSON data; plugins decide whether an extension is consumed while
 * building or explicitly projected into generated runtime code.
 */
export interface PageFileConfig<
  TExtensions extends ConfigExtensionValues = ConfigExtensionValues,
> extends PageMetadata {
  /** Framework document render mode. Defaults to "csr". */
  readonly render?: RenderMode;
  /** Framework hydration mode. Defaults to "load" except SSG defaults to "none". */
  readonly hydrate?: HydrationMode;
  /** Prerender behavior for SSR/SSG Pages. */
  readonly prerender?: PrerenderConfig;
  /** Enable React Server Components. Requires `render: "ssr"`. */
  readonly rsc?: true;
  /** Namespaced plugin-owned Page configuration. */
  readonly extensions?: TExtensions;
  /**
   * Static HTML Document output owned by this Page.
   *
   * This is valid only when the Page materializes its own static Document.
   */
  readonly document?: PageFileDocumentConfig;
  /**
   * Configuration for the unique semantic Route anchored by this Page.
   *
   * Route-owned data remains separate from Page `extensions`.
   */
  readonly route?: PageFileRouteConfig;
}

export interface PageFileDocumentConfig {
  /**
   * Additional relative output files containing the same transformed HTML.
   *
   * Aliases do not create Routes or additional semantic Documents.
   */
  readonly aliases?: readonly string[];
  /** Namespaced plugin-owned configuration for this Page-owned Document. */
  readonly extensions?: ConfigExtensionValues;
}

export interface PageFileRouteConfig {
  /** Namespaced plugin-owned Route configuration. */
  readonly extensions?: ConfigExtensionValues;
}

export interface ConfigRouteApplication {
  /** Directory containing `page.*`-anchored Page scopes. Default: "./src/pages". */
  pageRoot?: string;
  /** Application-owned Document defaults. */
  document?: ConfigRouteApplicationDocument;
  /** Project-local Application/root layout component. */
  layout?: string;
  /** Required non-empty Bigfish SPA route tree used only during source migration. */
  routes: [ConfigRoute, ...ConfigRoute[]];
}

export interface ConfigRouteApplicationDocument {
  /** HTML template shared by routes without an override. */
  template?: string;
  /** Default mount selector. */
  mount?: string;
  /** Namespaced plugin-owned Document configuration. */
  extensions?: ConfigExtensionValues;
}

export interface ResolvedConfigRouteApplicationDocument {
  template: string;
  mount: string;
  extensions?: Readonly<Record<string, StaticConfigValue>>;
}

export interface ResolvedConfigRouteApplication {
  pageRoot: string;
  document: ResolvedConfigRouteApplicationDocument;
  layout?: string;
  routes: ResolvedConfigRoute[];
}

export interface ConfigRoute {
  /** Absolute, relative, empty, or omitted route path. */
  path?: string;
  /** Page directory id relative to `application.pageRoot`; "." selects its root. */
  page?: string;
  /** Bigfish component reference accepted by the SPA migration normalizer. */
  component?: string;
  /** Redirect destination. Relative destinations resolve from the parent. */
  redirect?: string;
  /** Ordered React wrapper modules around this route. */
  wrappers?: string[];
  /** Route layout module, or `false` to bypass the Application layout. */
  layout?: string | false;
  /** Nested Umi/Bigfish route declarations. */
  routes?: ConfigRoute[];
  /** Namespaced plugin-owned configuration for this semantic Route. */
  extensions?: ConfigExtensionValues;
  /** Menu or breadcrumb label retained for migration plugins. */
  name?: string;
  /** Static menu icon name retained for migration plugins. */
  icon?: string;
  /** Browser-title metadata retained for migration plugins. */
  title?: string;
  /** Hide this route from generated menus. */
  hideInMenu?: boolean;
  /** Promote child menu entries to this route's level. */
  flatMenu?: boolean;
  /** Bigfish B-position identifier, optionally keyed by site. */
  spmBPos?: BigfishRouteMappedString;
  /** Bigfish/Umi access policy name. */
  access?: string;
  /** BOP menu identifier, optionally keyed by site; null/empty disables it. */
  menuKey?: BigfishRouteMenuKey;
  /** Static BOP menu-switch options retained for the owning plugin. */
  menuAssetOptions?: Record<string, BigfishRouteStaticValue>;
  /**
   * Acknowledges the exact terminal-match semantics already represented by
   * the Core Route. `false` is not representable and is rejected.
   */
  exact?: true;
}

export interface ResolvedConfigRoute {
  path?: string;
  /** Resolved Page directory id relative to `application.pageRoot`. */
  page?: string;
  /** Resolved Page module retained by the SPA migration normalizer. */
  component?: string;
  redirect?: string;
  wrappers?: string[];
  layout?: string | false;
  routes?: ResolvedConfigRoute[];
  extensions?: Readonly<Record<string, StaticConfigValue>>;
  /** @internal Strict Bigfish metadata projected to a registered Route extension. */
  metadata?: BigfishRouteExtension;
}

/** Internal discovery metadata retained for a canonical `page.*` Page. */
export interface PageAnchorMetadata {
  pageId: string;
  directory: string;
  entry: string;
  exportName: "default";
  configModule?: string;
}

/** Internal provider metadata carried from discovery into graph analysis. */
export interface PageRouteDiscoveryMetadata {
  /** Canonical positive-anchor Pages. */
  pages?: PageAnchorMetadata[];
}

export interface ResolvedPageRoutingConfig {
  mode: PageRoutingMode;
  dir: string;
  html: string;
  mount: string;
  routes: PageRouteNode[];
  rootModule?: string;
  /** Internal provider metadata; it does not activate page-level behavior. */
  metadata?: PageRouteDiscoveryMetadata;
  /** Absolute files that graph analysis and dev watch must track explicitly. */
  dependencies?: string[];
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
  html: "./index.html",
  port: 3000,
  serverPort: 3001,
  serverBasePath: DEFAULT_SERVER_BASE_PATH,
  crossOriginLoading: "anonymous",
  outputClientDir: "dist/client",
  outputServerDir: "dist/server",
  routingDir: "./src/pages",
  serverRoutingDir: "./src/apis",
  serverMiddlewareFile: "./src/middleware.ts",
  mount: "#app",
} as const;
const PUBLIC_ROOT_CONFIG_KEYS = new Set([
  "conventions",
  "output",
  "dev",
  "server",
  "transport",
  "routing",
  "application",
  "extensions",
  "bundler",
  "plugins",
]);
const PUBLIC_PAGE_ROUTING_CONFIG_KEYS = new Set([
  "mode",
  "dir",
  "html",
  "mount",
]);
const PUBLIC_CONFIG_ROUTE_APPLICATION_KEYS = new Set([
  "pageRoot",
  "document",
  "routes",
  "layout",
]);
const PUBLIC_CONFIG_ROUTE_KEYS = new Set([
  "path",
  "page",
  "component",
  "redirect",
  "wrappers",
  "layout",
  "routes",
  "extensions",
  "name",
  "icon",
  "title",
  "hideInMenu",
  "flatMenu",
  "spmBPos",
  "access",
  "menuKey",
  "menuAssetOptions",
  "exact",
]);
const PUBLIC_CONFIG_ROUTE_APPLICATION_DOCUMENT_KEYS = new Set([
  "template",
  "mount",
  "extensions",
]);
const PUBLIC_DEV_CONFIG_KEYS = new Set(["port", "https", "proxy"]);
const PUBLIC_SERVER_CONFIG_KEYS = new Set([
  "routing",
  "basePath",
  "rsc",
  "dev",
]);
const PUBLIC_SERVER_ROUTING_CONFIG_KEYS = new Set(["dir"]);
const PUBLIC_SERVER_DEV_CONFIG_KEYS = new Set(["port", "https"]);
const PUBLIC_SERVER_RSC_CONFIG_KEYS = new Set(["endpoint"]);
const PUBLIC_TRANSPORT_CONFIG_KEYS = new Set(["baseUrl"]);
const PUBLIC_OUTPUT_CONFIG_KEYS = new Set([
  "client",
  "server",
  "crossOriginLoading",
]);
const PUBLIC_HTTPS_CONFIG_KEYS = new Set(["key", "cert"]);
const PUBLIC_DEV_PROXY_RULE_KEYS = new Set([
  "context",
  "target",
  "pathRewrite",
  "changeOrigin",
  "secure",
]);
const PUBLIC_PLUGIN_CONFIG_KEYS = new Set([
  "name",
  "dependencies",
  "optionalDependencies",
  "enforce",
  "describe",
  "config",
  "setup",
  "contributions",
]);
const PUBLIC_BUNDLER_CONFIG_KEYS = new Set([
  "name",
  "capabilities",
  "build",
  "dev",
]);
const PUBLIC_BUNDLER_CAPABILITY_KEYS = new Set(["build", "dev"]);
const PUBLIC_BUNDLER_BUILD_CAPABILITY_KEYS = new Set(["server", "rsc", "ppr"]);
const PUBLIC_BUNDLER_DEV_CAPABILITY_KEYS = new Set([
  "html",
  "entries",
  "routes",
  "server",
  "resolution",
]);

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

function toRuntimeEndpoint(endpoint: string): string {
  return endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
}

function resolveRscEndpoint(rsc: ServerConfig["rsc"]): string | undefined {
  if (!rsc) return undefined;
  return toRuntimeEndpoint(
    normalizePath(assertRoutePath(rsc.endpoint, "server.rsc.endpoint")),
  );
}

/**
 * Deeply merge user configuration with defaults.
 */
export function resolveConfig<TBundlerCfg = DefaultBundlerConfig>(
  userConfig?: Config<TBundlerCfg>,
): ResolvedConfig<TBundlerCfg> {
  const config = resolveRootConfig(userConfig);
  const conventions = resolveConventionsConfig(config.conventions);
  const devConfig = resolveOptionalConfigRecord<DevConfig>(config.dev, "dev");
  validateDevConfigKeys(devConfig);
  const serverConfig = resolveOptionalConfigRecord<ServerConfig>(
    config.server,
    "server",
  );
  validateServerConfigKeys(serverConfig);
  const serverRscConfig = resolveServerRscConfig(serverConfig.rsc);
  const serverDevConfig = resolveOptionalConfigRecord<ServerDevConfig>(
    serverConfig.dev,
    "server.dev",
  );
  validateServerDevConfigKeys(serverDevConfig);
  const transportConfig = resolveOptionalConfigRecord<TransportConfig>(
    config.transport,
    "transport",
  );
  validateTransportConfigKeys(transportConfig);
  const outputConfig = resolveOptionalConfigRecord<OutputConfig>(
    config.output,
    "output",
  );
  validateOutputConfigKeys(outputConfig);
  validateConventionSourceConflicts(config, serverConfig, conventions);

  const defaultHtml = CONFIG_DEFAULTS.html;

  const resolvedApplication = resolveConfigRouteProfile(config, defaultHtml);
  const resolvedPageRouting =
    resolvedApplication === undefined && conventions
      ? resolvePageRoutingConfig(config.routing, defaultHtml)
      : undefined;

  const resolvedServerRouting = conventions
    ? resolveServerRoutingConfig(serverConfig.routing)
    : undefined;
  const resolvedServerConventions =
    conventions && resolvedServerRouting
      ? {
          globalMiddlewares: [],
          routeMiddlewares: [],
        }
      : undefined;
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
  const serverEndpoint = toRuntimeEndpoint(joinPath(serverBasePath, "fn"));
  const pprEndpoint = toRuntimeEndpoint(joinPath(serverBasePath, "ppr"));
  const rscEndpoint = resolveRscEndpoint(serverRscConfig);
  // Page rendering enables RSC from the CoreGraph. Keep the derived path
  // available to the dev proxy even when no endpoint override is configured;
  // the resolved runtime only exposes RSC when the graph actually needs it.
  const rscProxyEndpoint =
    rscEndpoint ?? toRuntimeEndpoint(joinPath(serverBasePath, "rsc"));
  const devHttps = resolveDevHttpsConfig(devConfig.https);
  const serverHttps = resolveServerDevHttpsConfig(serverDevConfig.https);
  const serverTarget = new URL(
    serverHttps ? "https://localhost" : "http://localhost",
  );
  serverTarget.port = String(serverPort);

  return {
    conventions,
    routing: resolvedPageRouting,
    ...(resolvedApplication
      ? {
          application: resolvedApplication,
        }
      : {}),
    extensions: resolveConfigExtensionValues(
      config.extensions,
      "config.extensions",
    ),
    dev: {
      port: clientPort,
      https: devHttps,
      proxy: [
        // User-defined proxies take precedence
        ...resolveDevProxyRules(devConfig.proxy),
        // Framework runtime paths proxy to the API dev server.
        {
          context: [
            toProxyContext(serverEndpoint),
            toProxyContext(pprEndpoint),
            toProxyContext(rscProxyEndpoint),
          ],
          target: serverTarget.origin,
          changeOrigin: true,
          secure: false,
        },
      ],
    },
    server: {
      basePath: serverBasePath,
      runtime: {
        basePath: serverBasePath,
        fn: serverEndpoint,
        ppr: pprEndpoint,
        ...(rscEndpoint ? { rsc: rscEndpoint } : {}),
      },
      rsc: rscEndpoint ? { endpoint: rscEndpoint } : undefined,
      routing: resolvedServerRouting,
      conventions: resolvedServerConventions,
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
      ...resolveOutputDirectories(outputConfig),
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
  assertConfigArray(plugins, "plugins");
  return plugins.map((plugin, index) =>
    resolvePluginConfig<TBundlerCfg>(plugin, index),
  );
}

function resolvePluginConfig<TBundlerCfg = DefaultBundlerConfig>(
  plugin: unknown,
  index: number,
): Plugin<TBundlerCfg> {
  const path = `plugins[${index}]`;
  const pluginConfig = assertPlainConfigRecord(plugin, path, "a plugin object");
  assertKnownConfigKeys(
    pluginConfig,
    PUBLIC_PLUGIN_CONFIG_KEYS,
    path,
    "name, dependencies, optionalDependencies, enforce, describe, config, setup, or contributions",
    (key) =>
      isPluginLifecycleDescriptorField(key)
        ? `[evjs] ${path}.${key} is not a Plugin descriptor field. Return the hook from ${path}.setup() instead.`
        : undefined,
  );
  const {
    name: rawName,
    dependencies: rawDependencies,
    optionalDependencies: rawOptionalDependencies,
    enforce: rawEnforce,
    describe: rawDescribe,
    config: rawConfig,
    setup: rawSetup,
    contributions: rawContributions,
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
  if (rawContributions !== undefined) {
    assertFunction<NonNullable<Plugin<TBundlerCfg>["contributions"]>>(
      rawContributions,
      `${path}.contributions`,
    );
  }
  if (rawDescribe !== undefined) {
    assertFunction<NonNullable<Plugin<TBundlerCfg>["describe"]>>(
      rawDescribe,
      `${path}.describe`,
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
    ...(rawDescribe !== undefined ? { describe: rawDescribe } : {}),
    ...(rawConfig !== undefined ? { config: rawConfig } : {}),
    ...(rawSetup !== undefined ? { setup: rawSetup } : {}),
    ...(rawContributions !== undefined
      ? { contributions: rawContributions }
      : {}),
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
  const bundlerConfig = assertPlainConfigRecord(
    value,
    path,
    "a bundler adapter object",
  );
  validateBundlerConfigKeys(bundlerConfig, path);
  assertTrimmedNonEmptyString(bundlerConfig.name, `${path}.name`);
  validateBundlerCapabilities(
    bundlerConfig.capabilities,
    `${path}.capabilities`,
  );
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
    "name, capabilities, build, or dev",
  );
}

function validateBundlerCapabilities(value: unknown, path: string): void {
  const capabilities = assertPlainConfigRecord(
    value,
    path,
    "a bundler capabilities object",
  );
  assertKnownConfigKeys(
    capabilities,
    PUBLIC_BUNDLER_CAPABILITY_KEYS,
    path,
    "build or dev",
  );
  const build = assertPlainConfigRecord(
    capabilities.build,
    `${path}.build`,
    "a build capabilities object",
  );
  assertKnownConfigKeys(
    build,
    PUBLIC_BUNDLER_BUILD_CAPABILITY_KEYS,
    `${path}.build`,
    "server, rsc, or ppr",
  );
  for (const key of PUBLIC_BUNDLER_BUILD_CAPABILITY_KEYS) {
    assertRequiredBoolean(build[key], `${path}.build.${key}`);
  }
  const dev = assertPlainConfigRecord(
    capabilities.dev,
    `${path}.dev`,
    "a dev capabilities object",
  );
  assertKnownConfigKeys(
    dev,
    PUBLIC_BUNDLER_DEV_CAPABILITY_KEYS,
    `${path}.dev`,
    "html, entries, routes, server, or resolution",
  );
  for (const key of PUBLIC_BUNDLER_DEV_CAPABILITY_KEYS) {
    assertRequiredBoolean(dev[key], `${path}.dev.${key}`);
  }
}

function assertRequiredBoolean(
  value: unknown,
  path: string,
): asserts value is boolean {
  if (typeof value === "boolean") return;
  throw new Error(`[evjs] ${path} must be a boolean.`);
}

function resolveRootConfig<TBundlerCfg = DefaultBundlerConfig>(
  config: Config<TBundlerCfg> | undefined,
): Config<TBundlerCfg> {
  if (config === undefined) return {};
  const rootConfig = assertPlainConfigRecord(
    config,
    "config",
    "a config object",
  );
  validateRootConfigKeys(rootConfig);
  return rootConfig as Config<TBundlerCfg>;
}

function resolveConventionsConfig(conventions: unknown): boolean {
  if (conventions === undefined) return true;
  if (typeof conventions === "boolean") return conventions;
  throw new Error("[evjs] conventions must be a boolean.");
}

function validateConventionSourceConflicts<TBundlerCfg>(
  config: Config<TBundlerCfg>,
  server: ServerConfig,
  conventions: boolean,
): void {
  if (conventions) return;

  const conflicts = [
    config.routing !== undefined ? "routing" : undefined,
    server.routing !== undefined ? "server.routing" : undefined,
  ].filter((value): value is string => value !== undefined);
  if (conflicts.length === 0) return;

  throw new Error(
    `[evjs] conventions: false cannot be combined with ${conflicts.join(
      " or ",
    )}. Remove the file-convention declaration when using the global opt-out. application.routes remains available as an explicit Bigfish SPA migration input.`,
  );
}

function resolveOptionalConfigRecord<T>(value: unknown, path: string): T {
  if (value === undefined) return {} as T;
  return assertPlainConfigRecord(value, path, "a config object") as T;
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
    "conventions, output, dev, server, transport, routing, application, extensions, bundler, or plugins",
    (key) => {
      if (key === "entry") {
        return "[evjs] config.entry has been removed from framework config. Use canonical routing with src/pages/**/page.*; standalone runtimes own their entry outside @evjs/ev config.";
      }
      if (key === "apps") {
        return "[evjs] config.apps has been removed from framework config. Use canonical routing with src/pages/**/page.*.";
      }
      if (key === "app") {
        return "[evjs] config.app has been removed. Migrate the published entry to src/pages/**/page.* and configure routing.mode.";
      }
      if (key === "pages") {
        return "[evjs] config.pages has been removed. Migrate every published Page to src/pages/**/page.* with adjacent page.config.ts files and configure routing.mode.";
      }
      if (key === "routes") {
        return "[evjs] top-level config.routes has been removed. Bigfish SPA migration route trees must be declared once under application.routes.";
      }
      if (key === "html") {
        return "[evjs] top-level config.html has been removed. Use routing.html or application.document.template.";
      }
      if (key === "functions" || key === "serverFunctions") {
        return `[evjs] config.${key} is not a public config field. Server functions are discovered from "use server" modules and endpoints are derived from server.basePath.`;
      }
    },
  );
}

function resolveConfigRouteProfile<TBundlerCfg>(
  config: Config<TBundlerCfg>,
  defaultHtml: string,
): ResolvedConfigRouteApplication | undefined {
  if (config.application === undefined) {
    return undefined;
  }
  if (config.routing !== undefined) {
    throw new Error(
      "[evjs] application.routes cannot be combined with routing. Use the Bigfish SPA migration input or canonical page.* routing, not both.",
    );
  }

  const rawApplication = assertPlainConfigRecord(
    config.application,
    "application",
    "an application object",
  );
  assertKnownConfigKeys(
    rawApplication,
    PUBLIC_CONFIG_ROUTE_APPLICATION_KEYS,
    "application",
    "pageRoot, document, layout, or routes",
    (key) => {
      if (key === "topology" || key === "mode") {
        return `[evjs] application.${key} has been removed. Bigfish-style application.routes is a SPA-only migration input. To move a Bigfish application to canonical routing, migrate its routes to src/pages/**/page.* and use routing.mode "spa".`;
      }
      if (key === "html" || key === "mount") {
        return `[evjs] application.${key} has been removed. Use application.document.${key === "html" ? "template" : "mount"}.`;
      }
      if (key === "extensions") {
        return "[evjs] application.extensions is not supported. Use top-level config.extensions for plugin-owned Application configuration; application is only the Bigfish SPA route-tree migration input.";
      }
    },
  );
  const rawRoutes = rawApplication.routes;
  const routesPath = "application.routes";
  if (rawRoutes === undefined) {
    throw new Error(
      "[evjs] application requires a non-empty application.routes array.",
    );
  }
  if (!Array.isArray(rawRoutes) || rawRoutes.length === 0) {
    throw new Error(
      `[evjs] ${routesPath} must be a non-empty array of route objects.`,
    );
  }
  assertConfigArray(rawRoutes, routesPath);

  const pageRoot = resolveConfigRoutePageRoot(rawApplication.pageRoot);
  const document = resolveConfigRouteApplicationDocument(
    rawApplication.document,
    defaultHtml,
  );
  const routes = rawRoutes.map((route, index) =>
    resolveConfigRoute(route, `${routesPath}[${index}]`, pageRoot),
  );
  return {
    pageRoot,
    document,
    ...(rawApplication.layout === undefined
      ? {}
      : {
          layout: normalizeConfigRouteModuleReference(
            rawApplication.layout,
            "application.layout",
            "wrapper",
          ),
        }),
    routes,
  };
}

function resolveConfigRoutePageRoot(value: unknown): string {
  const reference =
    value === undefined
      ? CONFIG_DEFAULTS.routingDir
      : assertTrimmedNonEmptyString(value, "application.pageRoot");
  const normalized = reference.startsWith("./")
    ? reference.slice(2)
    : reference;
  const segments = normalized.split("/");
  if (
    reference.includes("\\") ||
    reference.includes("?") ||
    reference.includes("#") ||
    hasConfigPathControlCharacter(reference) ||
    reference.startsWith("/") ||
    /^[A-Za-z]:/.test(reference) ||
    normalized.length === 0 ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(
      '[evjs] application.pageRoot must be a safe project-relative directory such as "./src/pages" and must not escape the project.',
    );
  }
  return `./${normalized}`;
}

function resolveConfigRouteApplicationDocument(
  value: unknown,
  defaultHtml: string,
): ResolvedConfigRouteApplicationDocument {
  const document =
    value === undefined
      ? {}
      : assertPlainConfigRecord(
          value,
          "application.document",
          "a document object",
        );
  assertKnownConfigKeys(
    document,
    PUBLIC_CONFIG_ROUTE_APPLICATION_DOCUMENT_KEYS,
    "application.document",
    "template, mount, or extensions",
  );
  const extensions =
    document.extensions === undefined
      ? undefined
      : resolveConfigExtensionValues(
          document.extensions,
          "application.document.extensions",
        );
  return {
    template:
      document.template === undefined
        ? defaultHtml
        : assertNonEmptyString(
            document.template,
            "application.document.template",
          ),
    mount:
      document.mount === undefined
        ? CONFIG_DEFAULTS.mount
        : assertNonEmptyString(document.mount, "application.document.mount"),
    ...(extensions ? { extensions } : {}),
  };
}

function resolveConfigRoutePageId(value: unknown, path: string): string {
  const pageId = assertTrimmedNonEmptyString(value, path);
  if (pageId === ".") return pageId;
  const segments = pageId.split("/");
  if (
    pageId.includes("\\") ||
    pageId.includes("?") ||
    pageId.includes("#") ||
    hasConfigPathControlCharacter(pageId) ||
    pageId.startsWith("/") ||
    pageId.endsWith("/") ||
    /^[A-Za-z]:/.test(pageId) ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        segment === "__proto__" ||
        segment === "constructor" ||
        segment === "prototype",
    )
  ) {
    throw new Error(
      `[evjs] ${path} must be a safe Page id relative to application.pageRoot and must not escape that directory.`,
    );
  }
  return pageId;
}

function deriveConfigRoutePageIdFromComponent(
  component: string,
  pageRoot: string,
): string {
  if (component === pageRoot) return ".";
  const prefix = `${pageRoot}/`;
  if (!component.startsWith(prefix)) {
    throw new Error(
      `[evjs] component alias "${component}" must resolve inside application.pageRoot "${pageRoot}".`,
    );
  }
  const relative = component
    .slice(prefix.length)
    .replace(/\.(?:tsx?|jsx?)$/, "");
  let pageId = relative;
  if (relative === "index" || relative === "page") {
    pageId = ".";
  } else if (relative.endsWith("/index")) {
    pageId = relative.slice(0, -"/index".length);
  } else if (relative.endsWith("/page")) {
    pageId = relative.slice(0, -"/page".length);
  }
  return resolveConfigRoutePageId(pageId, "component Page id");
}

function hasConfigPathControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function resolveConfigRoute(
  value: unknown,
  routePath: string,
  pageRoot: string,
): ResolvedConfigRoute {
  const route = assertPlainConfigRecord(value, routePath, "a route object");
  assertKnownConfigKeys(
    route,
    PUBLIC_CONFIG_ROUTE_KEYS,
    routePath,
    "path, page, component, redirect, wrappers, layout, routes, or documented Bigfish route metadata",
    (key) => {
      if (key === "children") {
        return `[evjs] ${routePath}.children is not supported. Current Umi/Bigfish route config uses routes for nested declarations.`;
      }
    },
  );

  const pathValue = resolveOptionalConfigRoutePath(
    route.path,
    `${routePath}.path`,
  );
  if (route.page !== undefined && route.component !== undefined) {
    throw new Error(
      `[evjs] ${routePath} must declare only one of page or the deprecated component alias.`,
    );
  }
  const componentAlias =
    route.component === undefined
      ? undefined
      : normalizeConfigRouteModuleReference(
          route.component,
          `${routePath}.component`,
          "component",
          pageRoot,
        );
  let page: string | undefined;
  if (route.page !== undefined) {
    page = resolveConfigRoutePageId(route.page, `${routePath}.page`);
  } else if (componentAlias !== undefined) {
    page = deriveConfigRoutePageIdFromComponent(componentAlias, pageRoot);
  }
  const component = componentAlias;
  const redirect =
    route.redirect === undefined
      ? undefined
      : assertTrimmedNonEmptyString(route.redirect, `${routePath}.redirect`);
  if (page && redirect) {
    throw new Error(
      `[evjs] ${routePath} must not declare both page and redirect.`,
    );
  }

  const childValue = route.routes;
  let routes: ResolvedConfigRoute[] | undefined;
  if (childValue !== undefined) {
    if (!Array.isArray(childValue)) {
      throw new Error(
        `[evjs] ${routePath}.routes must be a non-empty array of route objects.`,
      );
    }
    const childPath = `${routePath}.routes`;
    assertConfigArray(childValue, childPath);
    if (childValue.length === 0) {
      if (!page) {
        throw new Error(
          `[evjs] ${childPath} must be a non-empty array of route objects.`,
        );
      }
    } else {
      routes = childValue.map((child, index) =>
        resolveConfigRoute(child, `${childPath}[${index}]`, pageRoot),
      );
    }
  }
  if (redirect && routes) {
    throw new Error(
      `[evjs] ${routePath} redirect routes cannot declare nested routes.`,
    );
  }
  if (!page && !redirect && !routes) {
    throw new Error(
      `[evjs] ${routePath} must declare page, redirect, or nested routes.`,
    );
  }

  let wrappers: string[] | undefined;
  if (route.wrappers !== undefined) {
    if (!Array.isArray(route.wrappers)) {
      throw new Error(`[evjs] ${routePath}.wrappers must be an array.`);
    }
    assertConfigArray(route.wrappers, `${routePath}.wrappers`);
    wrappers = route.wrappers.map((wrapper, index) =>
      normalizeConfigRouteModuleReference(
        wrapper,
        `${routePath}.wrappers[${index}]`,
        "wrapper",
      ),
    );
  }
  if (redirect && wrappers && wrappers.length > 0) {
    throw new Error(
      `[evjs] ${routePath} redirect routes cannot declare wrappers.`,
    );
  }
  const layout =
    route.layout === undefined || route.layout === false
      ? route.layout
      : normalizeConfigRouteModuleReference(
          route.layout,
          `${routePath}.layout`,
          "wrapper",
        );
  if (redirect && layout === false) {
    throw new Error(
      `[evjs] ${routePath} redirect routes cannot declare layout: false because redirects do not render a Page.`,
    );
  }
  if (redirect && typeof layout === "string") {
    throw new Error(
      `[evjs] ${routePath} redirect routes cannot declare layout because redirects do not render a Page.`,
    );
  }
  if (route.exact !== undefined && route.exact !== true) {
    throw new Error(
      `[evjs] ${routePath}.exact only accepts true because Core Routes already use exact terminal-match semantics; exact: false cannot be represented by the normalized route tree.`,
    );
  }
  if (route.exact === true && routes) {
    throw new Error(
      `[evjs] ${routePath}.exact: true is valid only on a terminal Route without nested routes.`,
    );
  }
  const extensions =
    route.extensions === undefined
      ? undefined
      : resolveConfigExtensionValues(
          route.extensions,
          `${routePath}.extensions`,
        );
  const metadata = resolveBigfishRouteMetadata(route, routePath);
  return {
    ...(pathValue !== undefined ? { path: pathValue } : {}),
    ...(page
      ? {
          page,
          ...(component ? { component } : {}),
        }
      : {}),
    ...(redirect ? { redirect } : {}),
    ...(wrappers ? { wrappers } : {}),
    ...(layout !== undefined ? { layout } : {}),
    ...(routes ? { routes } : {}),
    ...(extensions ? { extensions } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function resolveOptionalConfigRoutePath(
  value: unknown,
  path: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`[evjs] ${path} must be a string.`);
  }
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] ${path} must not contain leading or trailing whitespace.`,
    );
  }
  return value;
}

function normalizeConfigRouteModuleReference(
  value: unknown,
  path: string,
  kind: "component" | "wrapper",
  pageRoot: string = CONFIG_DEFAULTS.routingDir,
): string {
  const reference = assertTrimmedNonEmptyString(value, path);
  if (
    reference.includes("\\") ||
    reference.includes("?") ||
    reference.includes("#") ||
    reference.startsWith("/") ||
    reference.startsWith("../") ||
    reference.includes("/../") ||
    reference.includes("/./") ||
    reference.endsWith("/..") ||
    reference.endsWith("/.") ||
    reference.includes("//")
  ) {
    throw createConfigRouteModuleReferenceError(path, kind);
  }

  let projectPath: string;
  if (kind === "component") {
    if (reference.startsWith("@/pages/")) {
      projectPath = `./src/pages/${reference.slice("@/pages/".length)}`;
    } else if (reference.startsWith("./src/")) {
      projectPath = reference;
    } else if (reference.startsWith("src/")) {
      projectPath = `./${reference}`;
    } else if (reference.startsWith("./")) {
      projectPath = `${pageRoot}/${reference.slice(2)}`;
    } else if (!reference.startsWith(".") && !reference.startsWith("@")) {
      projectPath = `${pageRoot}/${reference}`;
    } else {
      throw createConfigRouteModuleReferenceError(path, kind);
    }
  } else if (reference.startsWith("@/")) {
    projectPath = `./src/${reference.slice(2)}`;
  } else if (reference.startsWith("./src/")) {
    projectPath = reference;
  } else if (reference.startsWith("src/")) {
    projectPath = `./${reference}`;
  } else if (reference.startsWith("./")) {
    projectPath = `./src/${reference.slice(2)}`;
  } else if (!reference.startsWith(".") && !reference.startsWith("@")) {
    projectPath = `./src/${reference}`;
  } else {
    throw createConfigRouteModuleReferenceError(path, kind);
  }

  if (projectPath.endsWith("/")) {
    throw createConfigRouteModuleReferenceError(path, kind);
  }
  return projectPath;
}

function createConfigRouteModuleReferenceError(
  path: string,
  kind: "component" | "wrapper",
): Error {
  return kind === "component"
    ? new Error(
        `[evjs] ${path} must be a project page reference using "@/pages/...", "./src/pages/...", or a bare/"./" path relative to src/pages. Package, absolute, and parent-directory references cannot declare a traceable Page scope.`,
      )
    : new Error(
        `[evjs] ${path} must be a project source reference using "@/...", "./src/...", or a bare/"./" path relative to src. Package, absolute, and parent-directory references are not supported by application.routes migration input.`,
      );
}

function assertPlainConfigRecord(
  value: unknown,
  path: string,
  description: string,
): Record<string, unknown> {
  if (isPlainConfigRecord(value)) {
    assertEnumerableStringOwnKeys(value, path);
    return value;
  }
  throw new Error(`[evjs] ${path} must be ${description}.`);
}

function assertEnumerableStringOwnKeys(value: object, path: string): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new Error(`[evjs] ${path} must not contain symbol fields.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new Error(
        `[evjs] ${path}.${key} must be an enumerable data property so config resolution does not execute accessors or lose fields during serialization.`,
      );
    }
  }
}

function assertConfigArray(value: unknown[], path: string): void {
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) {
      throw new Error(
        `[evjs] ${path} must not be sparse; index ${index} is missing.`,
      );
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)) {
      throw new Error(
        `[evjs] ${path} arrays must not contain symbol or extra properties.`,
      );
    }
    if (Number(key) >= value.length) {
      throw new Error(`[evjs] ${path} array index ${key} is out of bounds.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new Error(
        `[evjs] ${path}[${key}] must be an enumerable data property so config resolution does not execute accessors or lose fields during serialization.`,
      );
    }
  }
}

function isPlainConfigRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function resolveServerRscConfig(rsc: unknown): ServerConfig["rsc"] {
  if (rsc === undefined) return undefined;
  if (typeof rsc === "boolean") {
    throw new Error(
      "[evjs] server.rsc is an endpoint override, not an enable switch. Enable RSC with rsc: true in page.config.ts, or provide server.rsc.endpoint to override its derived path.",
    );
  }
  const rscConfig = assertPlainConfigRecord(
    rsc,
    "server.rsc",
    "a server RSC object",
  );
  validateServerRscConfigKeys(rscConfig);
  if (rscConfig.endpoint === undefined) {
    throw new Error("[evjs] server.rsc.endpoint is required.");
  }
  return {
    endpoint: rscConfig.endpoint as string,
  };
}

function validateServerConfigKeys(server: ServerConfig): void {
  assertKnownConfigKeys(
    server,
    PUBLIC_SERVER_CONFIG_KEYS,
    "server",
    "routing, basePath, rsc, or dev",
    (key) => {
      if (key === "conventions") {
        return "[evjs] server.conventions has been removed. Use top-level conventions: false to disable all file conventions.";
      }
      if (key === "entry") {
        return "[evjs] server.entry is not supported. Use server.routing file conventions under src/apis instead.";
      }
      if (key === "functions") {
        return "[evjs] server.functions is not a public config field. Server function, PPR, and RSC endpoints are derived from server.basePath.";
      }
      if (key === "runtime") {
        return `[evjs] server.${key} is resolved framework metadata and cannot be configured. Use server.basePath to change framework endpoint paths.`;
      }
      if (key === "functionRuntime") {
        return "[evjs] server.functionRuntime is internal build metadata and cannot be configured. Use server.basePath to change framework endpoint paths.";
      }
    },
  );
}

function resolveServerRoutingConfig(
  routing: ServerConfig["routing"] | boolean | null,
): ResolvedServerRoutingConfig | undefined {
  if (routing === false) {
    throw new Error(
      "[evjs] server.routing: false has been removed. Use top-level conventions: false to disable all file conventions.",
    );
  }
  if (routing === true) {
    throw new Error(
      "[evjs] server.routing: true has been removed. Use server.routing: {} to request the default src/apis directory, or omit server.routing for optional default discovery.",
    );
  }
  const options =
    routing === undefined
      ? {}
      : assertPlainConfigRecord(
          routing,
          "server.routing",
          "a server routing object",
        );
  validateServerRoutingConfigKeys(options);
  return {
    dir:
      options.dir === undefined
        ? CONFIG_DEFAULTS.serverRoutingDir
        : assertNonEmptyString(options.dir, "server.routing.dir"),
    routes: [],
  };
}

function validateServerRoutingConfigKeys(
  routing: Record<string, unknown>,
): void {
  assertKnownConfigKeys(
    routing,
    PUBLIC_SERVER_ROUTING_CONFIG_KEYS,
    "server.routing",
    "dir",
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
    "client, server, or crossOriginLoading",
  );
}

function resolvePageRoutingConfig(
  routing: Config["routing"] | boolean | null,
  defaultHtml: string,
): ResolvedPageRoutingConfig | undefined {
  if (routing === undefined) return undefined;
  if (routing === false) {
    throw new Error(
      "[evjs] routing: false has been removed. Use top-level conventions: false to disable all file conventions.",
    );
  }
  if (routing === true) {
    throw new Error(
      '[evjs] routing: true has been removed. Use routing: { mode: "spa" } or routing: { mode: "mpa" } to enable canonical Page discovery.',
    );
  }
  const options = assertPlainConfigRecord(
    routing,
    "routing",
    "a routing object",
  );
  validatePageRoutingConfigKeys(options);
  const mode = resolvePageRoutingMode(options.mode);
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
    routes: [],
  };
}

function validatePageRoutingConfigKeys(routing: Record<string, unknown>): void {
  assertKnownConfigKeys(
    routing,
    PUBLIC_PAGE_ROUTING_CONFIG_KEYS,
    "routing",
    "mode, dir, html, or mount",
    (key) => {
      if (key === "conventions") {
        return "[evjs] routing.conventions has been removed. Canonical Page facets are discovered from positive files; use top-level conventions: false only to disable all file conventions.";
      }
      if (key === "compatibility") {
        return "[evjs] routing.compatibility has been removed. Canonical routing discovers <routing.dir>/**/page.* anchors; migrate Page entries to page.* and Page settings to page.config.ts, then configure only routing.mode.";
      }
      if (key === "convention") {
        return "[evjs] routing.convention has been removed. Canonical routing discovers <routing.dir>/**/page.* anchors; migrate Page entries to page.* and Page settings to page.config.ts, then configure only routing.mode.";
      }
      if (key === "entry") {
        return "[evjs] routing.entry has been removed. SPA routing generates its framework bootstrap from the normalized Page-and-Route graph.";
      }
      if (key === "routes") {
        return "[evjs] routing.routes is not a public config field. Canonical route URLs come from page.* anchor directories under routing.dir; use application.routes only as the Bigfish route-tree migration input.";
      }
    },
  );
}

function resolvePageRoutingMode(mode: unknown): PageRoutingMode {
  if (mode === undefined) {
    throw new Error(
      '[evjs] routing.mode is required and must be "spa" or "mpa".',
    );
  }
  if (mode === "spa" || mode === "mpa") return mode;
  throw new Error('[evjs] routing.mode must be "spa" or "mpa".');
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

function resolveOutputDirectories(
  outputConfig: OutputConfig,
): Pick<ResolvedOutputConfig, "client" | "server"> {
  const client =
    outputConfig.client === undefined
      ? CONFIG_DEFAULTS.outputClientDir
      : assertOutputDirectory(outputConfig.client, "output.client");
  const server =
    outputConfig.server === undefined
      ? CONFIG_DEFAULTS.outputServerDir
      : assertOutputDirectory(outputConfig.server, "output.server");

  if (normalizeOutputDirectory(client) === normalizeOutputDirectory(server)) {
    throw new Error(
      "[evjs] output.client and output.server must point to different directories.",
    );
  }

  return { client, server };
}

function assertOutputDirectory(value: unknown, path: string): string {
  return assertNonEmptyString(value, path);
}

function normalizeOutputDirectory(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "") || ".";
}

function resolveDevHttpsConfig(
  https: DevConfig["https"],
): ResolvedDevConfig["https"] {
  if (https === undefined) return false;
  if (typeof https === "boolean") return https;
  const httpsConfig = assertPlainConfigRecord(
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
  const httpsConfig = assertPlainConfigRecord(
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
  assertConfigArray(proxy, "dev.proxy");
  return proxy.map((rule, index) => resolveDevProxyRule(rule, index));
}

function resolveDevProxyRule(rule: unknown, index: number): DevProxyRule {
  const path = `dev.proxy[${index}]`;
  const ruleConfig = assertPlainConfigRecord(rule, path, "a proxy rule object");
  validateDevProxyRuleKeys(ruleConfig, path);
  const context = clonePathPatterns(ruleConfig.context, `${path}.context`);
  const pathRewrite = resolveDevProxyPathRewrite(
    ruleConfig.pathRewrite,
    `${path}.pathRewrite`,
  );
  const changeOrigin = assertOptionalBoolean(
    ruleConfig.changeOrigin,
    `${path}.changeOrigin`,
  );
  const secure = assertOptionalBoolean(ruleConfig.secure, `${path}.secure`);

  return {
    context,
    target: assertHttpUrl(ruleConfig.target, `${path}.target`),
    ...(pathRewrite !== undefined ? { pathRewrite } : {}),
    ...(changeOrigin !== undefined ? { changeOrigin } : {}),
    ...(secure !== undefined ? { secure } : {}),
  };
}

function resolveDevProxyPathRewrite(
  value: unknown,
  path: string,
): DevProxyPathRewrite | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "function") {
    return value as (path: string) => string;
  }

  const rules = assertPlainConfigRecord(
    value,
    path,
    "a path rewrite object or function",
  );
  const resolved: Record<string, string> = {};
  for (const [pattern, replacement] of Object.entries(rules)) {
    if (typeof replacement !== "string") {
      throw new Error(
        `[evjs] ${path}[${JSON.stringify(pattern)}] must be a string.`,
      );
    }
    resolved[pattern] = replacement;
  }
  return resolved;
}

function validateDevProxyRuleKeys(
  rule: Record<string, unknown>,
  path: string,
): void {
  assertKnownConfigKeys(
    rule,
    PUBLIC_DEV_PROXY_RULE_KEYS,
    path,
    "context, target, pathRewrite, changeOrigin, or secure",
  );
}

function assertTcpPort(value: number, path: string): number {
  if (Number.isInteger(value) && value >= 1 && value <= 65535) return value;
  throw new Error(
    `[evjs] ${path} must be an integer TCP port from 1 to 65535.`,
  );
}

function assertNonEmptyString(value: unknown, path: string): string {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`[evjs] ${path} must be a non-empty string.`);
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

function assertOptionalBoolean(
  value: unknown,
  path: string,
): boolean | undefined {
  if (value === undefined || typeof value === "boolean") return value;
  throw new Error(`[evjs] ${path} must be a boolean when provided.`);
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
  assertConfigArray(value, path);
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
  if (Array.isArray(value)) {
    assertConfigArray(value, path);
  }
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
 * Define the build-time configuration colocated with a canonical `page.*`
 * anchor while preserving extension value inference.
 */
export function definePageConfig<const TConfig extends PageFileConfig>(
  config: TConfig & Record<Exclude<keyof TConfig, keyof PageFileConfig>, never>,
): TConfig {
  return config;
}
