import type {
  AppRouteTarget,
  AssetGroup,
  BuildEntryPhase,
  BuildEnvironment,
  BuildOutput,
  ClientContributionRuntime,
  ComponentModel,
  ContributionRuntime,
  ContributionTarget,
  CoreClientRouteTarget,
  CoreDocumentBootstrap,
  CoreDocumentOwner,
  CoreNodeProvenance,
  CorePageScope,
  CoreRouteFacets,
  CoreRoutePattern,
  DeploymentMetadata,
  EntryContributionPosition,
  FrameworkSlotName,
  GeneratedScope,
  HtmlTagName,
  HtmlTagPlacement,
  HydrationMode,
  PageMetadata,
  PageRouteKind,
  PprConfig,
  PrerenderConfig,
  RenderMode,
  ServerRuntime,
} from "@evjs/shared/manifest";
import { createDeploymentMetadata } from "@evjs/shared/manifest";
import type { Logger } from "@logtape/logtape";
import type { FrameworkRuntimeOutput } from "../_internal/build/framework-runtime.js";
import type {
  Config,
  ConfigExtensionNamespace,
  DefaultBundlerConfig,
  ResolvedConfig,
} from "../config/index.js";

export type {
  ClientContributionRuntime,
  ContributionRuntime,
  ContributionTarget,
  CorePageScope,
  EntryContributionPosition,
  FrameworkSlotName,
  GeneratedScope,
  HtmlTagName,
  HtmlTagPlacement,
} from "@evjs/shared/manifest";

/**
 * Minimal DOM element / document interface for plugin HTML manipulation.
 *
 * This is a bundler-agnostic subset of the standard DOM API. The concrete
 * implementation is provided by the underlying parser (`domparser-rs`), but
 * plugins only depend on this interface.
 */
export interface HtmlDocument {
  // ── Querying ──────────────────────────────────────────────────────────
  querySelector(selectors: string): HtmlDocument | null;
  querySelectorAll(selectors: string): HtmlDocument[];
  getElementById(id: string): HtmlDocument | null;
  getElementsByTagName(tagName: string): HtmlDocument[];
  getElementsByClassName(classNames: string): HtmlDocument[];

  // ── Attributes ────────────────────────────────────────────────────────
  getAttribute(name: string): string | null;
  getAttributeNames(): string[];
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;

  // ── Tree mutation ─────────────────────────────────────────────────────
  appendChild(newChild: HtmlDocument): HtmlDocument;
  removeChild(child: HtmlDocument): HtmlDocument;
  insertBefore(
    newNode: HtmlDocument,
    refNode?: HtmlDocument | null,
  ): HtmlDocument;
  replaceChild(newChild: HtmlDocument, oldChild: HtmlDocument): HtmlDocument;
  append(newChild: HtmlDocument): void;
  prepend(newChild: HtmlDocument): void;
  before(newSibling: HtmlDocument): void;
  after(newSibling: HtmlDocument): void;
  remove(): void;
  replaceWith(newNode: HtmlDocument): void;

  // ── Content insertion ─────────────────────────────────────────────────
  insertAdjacentHTML(position: string, html: string): void;
  insertAdjacentText(position: string, text: string): void;
  insertAdjacentElement(position: string, element: HtmlDocument): void;

  // ── Creation (document-level) ─────────────────────────────────────────
  createElement(tagName: string): HtmlDocument;
  createTextNode(data: string): HtmlDocument;
  createComment(data: string): HtmlDocument;

  // ── Properties ────────────────────────────────────────────────────────
  readonly tagName: string | null;
  id: string;
  className: string;
  innerHTML: string;
  readonly outerHTML: string;
  textContent: string;

  // ── Traversal ─────────────────────────────────────────────────────────
  readonly parentNode: HtmlDocument | null;
  readonly parentElement: HtmlDocument | null;
  readonly firstChild: HtmlDocument | null;
  readonly lastChild: HtmlDocument | null;
  readonly firstElementChild: HtmlDocument | null;
  readonly lastElementChild: HtmlDocument | null;
  readonly previousSibling: HtmlDocument | null;
  readonly nextSibling: HtmlDocument | null;
  readonly previousElementSibling: HtmlDocument | null;
  readonly nextElementSibling: HtmlDocument | null;
  readonly children: HtmlDocument[];
  readonly childNodes: HtmlDocument[];
  readonly childElementCount: number;
  hasChildNodes(): boolean;
  contains(otherNode: HtmlDocument): boolean;

  // ── Document-level accessors ──────────────────────────────────────────
  readonly head: HtmlDocument | null;
  readonly body: HtmlDocument | null;
  readonly title: string;
  readonly documentElement: HtmlDocument | null;

  // ── Cloning ───────────────────────────────────────────────────────────
  cloneNode(deep?: boolean): HtmlDocument;

  // ── Serialization ─────────────────────────────────────────────────────
  toString(): string;
}

/**
 * Context passed to plugin bundler hooks.
 */
export interface BundlerCtx<TBundlerCfg = DefaultBundlerConfig> {
  /** The current mode. */
  mode: "development" | "production";
  /** The current working directory. */
  cwd: string;
  /** The fully resolved framework config. */
  config: ResolvedConfig<TBundlerCfg>;
  /** The current command. */
  command: "dev" | "build";
  /** Selected bundler adapter name. */
  bundlerName: string;
  /** Environment currently being configured when known. */
  environment?: BuildEnvironment | "mixed";
  /** Logger plugins can use for framework-scoped messages. */
  logger: Logger;
  /** Adds an extra framework-level watch file in dev mode. */
  addWatchFile(file: string): void;
}

/** Context passed to plugin config hooks. */
export interface PluginConfigContext {
  /** The current mode. */
  mode: "development" | "production";
  /** The current working directory. */
  cwd: string;
  /** Extra CLI flags made available to plugins. */
  flags?: CliFlags;
  /** The current command. */
  command: "dev" | "build";
}

type ConfigHookResult<TBundlerCfg> =
  | Config<TBundlerCfg>
  | undefined
  | void
  | Promise<Config<TBundlerCfg> | undefined>
  | Promise<void>;

type PluginSetupResult<TBundlerCfg> =
  | PluginHooks<TBundlerCfg>
  | undefined
  | void
  | Promise<PluginHooks<TBundlerCfg> | undefined>
  | Promise<void>;

type ContributionsHookResult = void | Promise<void>;

/** Context available while a Page extension value is resolved. */
export interface PluginPageExtensionContext {
  readonly pageId: string;
  readonly pageModule: string;
  readonly pageRoot?: string;
  /** Canonical build-time `page.config.*` module, when present. */
  readonly configSource?: string;
}

/** Declarative Page extension registered by a plugin descriptor. */
export interface PluginPageExtensionDefinition<
  TValue = unknown,
  TConfigured = unknown,
> {
  /** Globally unique namespaced extension id, for example `@company/access`. */
  namespace: ConfigExtensionNamespace;
  /** Optional schema version recorded in the CoreGraph extension registry. */
  schemaVersion?: string;
  /** Default value, evaluated independently for every Page. */
  defaults?:
    | TValue
    | ((context: PluginPageExtensionContext) => TValue | undefined);
  /**
   * Merge defaults with an explicitly authored namespaced value. This callback
   * is not invoked when the Page omits the namespace; defaults are materialized
   * directly in that case. By default plain objects are shallow-merged with
   * configured fields winning; other configured values replace defaults.
   */
  merge?: (
    defaults: TValue | undefined,
    configured: TConfigured,
    context: PluginPageExtensionContext,
  ) => TValue | undefined;
  /** Return false/a message or throw to reject the materialized value. */
  validate?: (
    value: TValue,
    context: PluginPageExtensionContext,
  ) => undefined | boolean | string;
}

/** Registration context passed to a plugin's `describe` hook. */
export interface PluginDescribeContext {
  pageExtension<TValue = unknown, TConfigured = unknown>(
    definition: PluginPageExtensionDefinition<TValue, TConfigured>,
  ): void;
}

/**
 * An evjs plugin.
 */
export interface Plugin<TBundlerCfg = DefaultBundlerConfig> {
  /** Plugin name for debugging and logging. */
  name: string;

  /**
   * Required plugin dependencies that must run before this plugin.
   *
   * Missing required dependencies are treated as configuration errors.
   */
  dependencies?: string[];

  /**
   * Optional plugin dependencies that run before this plugin when present.
   *
   * Missing optional dependencies are ignored. Present optional dependencies
   * still participate in dependency ordering and cycle detection.
   */
  optionalDependencies?: string[];

  /**
   * Modify the raw user config before defaults are resolved.
   *
   * Use this for framework-level config such as `server.basePath` that must
   * be visible to dev proxy setup and build-time runtime defines.
   */
  config?: (
    config: Config<TBundlerCfg>,
    ctx: PluginConfigContext,
  ) => ConfigHookResult<TBundlerCfg>;

  /**
   * Initialize the plugin and return lifecycle hooks.
   *
   * Receives the fully resolved config and build context. All returned
   * hooks share state through closure.
   */
  setup?: (ctx: PluginContext<TBundlerCfg>) => PluginSetupResult<TBundlerCfg>;

  /**
   * Declare generated framework contributions for the `.ev` IR.
   *
   * This hook is separate from setup() lifecycle hooks. It declares generated
   * modules, structured framework slots, and resolution changes before bundler
   * configuration is created.
   */
  contributions?: (
    ctx: ContributionContext<TBundlerCfg>,
  ) => ContributionsHookResult;

  /** Declare namespaced framework extensions before graph analysis. */
  describe?: (context: PluginDescribeContext) => void;

  /**
   * Relative ordering tier for plugins without an explicit dependency edge.
   *
   * Dependencies still win over enforce ordering.
   */
  enforce?: "pre" | "normal" | "post";
}

/**
 * Define an evjs plugin while preserving its inferred authoring shape.
 */
export function definePlugin<
  TBundlerCfg = DefaultBundlerConfig,
  const TPlugin extends Plugin<TBundlerCfg> = Plugin<TBundlerCfg>,
>(plugin: TPlugin): TPlugin {
  return plugin;
}

/** Context passed to plugin setup(). */
export interface PluginContext<TBundlerCfg = DefaultBundlerConfig> {
  /** Current mode. */
  mode: "development" | "production";
  /** The current working directory. */
  cwd: string;
  /** The fully resolved framework config. */
  config: ResolvedConfig<TBundlerCfg>;
  /** Extra CLI flags made available to plugins. */
  flags?: CliFlags;
  /** Current command. */
  command: "dev" | "build";
  /** Logger plugins can use for framework-scoped messages. */
  logger: Logger;
  /** Adds an extra framework-level watch file in dev mode. */
  addWatchFile(file: string): void;
}

export type CliFlagValue = boolean | string | Array<boolean | string>;

export type CliFlags = Record<string, CliFlagValue>;

/** Read-only framework IR snapshot exposed to contribution hooks. */
export interface FrameworkIRView {
  /** Normalized Applications discovered before bundling. */
  readonly applications: readonly FrameworkApplicationView[];
  /** Explicit or convention-derived pages discovered before bundling. */
  readonly pages: readonly FrameworkPageView[];
  /** Client route graph discovered from `src/pages` or config. */
  readonly routes: readonly FrameworkRouteView[];
  /** Materialized HTML Documents from the normalized CoreGraph. */
  readonly documents: readonly FrameworkDocumentView[];
  /** Server file routes discovered from `src/apis`. */
  readonly serverRoutes: readonly FrameworkServerRouteView[];
  /** Server functions discovered from `"use server"` modules. */
  readonly serverFunctions: readonly FrameworkServerFunctionView[];
  /** Bundler-independent entries that the framework will materialize. */
  readonly entries: readonly FrameworkEntryView[];
  getEntry(name: string): FrameworkEntryView | undefined;
  /** Resolve one normalized client Application entry. */
  getApplicationEntry(
    applicationId?: string,
  ): FrameworkApplicationEntryView | undefined;
}

export interface FrameworkDocumentView {
  readonly id: string;
  readonly template: string;
  readonly output: string;
  readonly applicationId: string;
  readonly owner: CoreDocumentOwner;
  readonly mount?: string;
  readonly bootstrap?: CoreDocumentBootstrap;
  readonly provenance: CoreNodeProvenance;
  readonly extensions: Readonly<Record<string, unknown>>;
}

export interface FrameworkApplicationView {
  readonly id: string;
  /** Resolved CoreGraph Application extensions. */
  readonly extensions: Readonly<Record<string, unknown>>;
  /** Source boundary claimed by the Application provider. */
  readonly root: string;
  /** Whether this Application owns one shared client router or many Pages. */
  readonly topology: "spa" | "mpa";
  /** Semantic Pages owned by this Application. */
  readonly pageIds: readonly string[];
  /** Client or Document Routes owned by this Application. */
  readonly routeIds: readonly string[];
  /** HTML Documents owned by this Application. */
  readonly documentIds: readonly string[];
  /** Producer and source that declared this Application. */
  readonly provenance: CoreNodeProvenance;
}

export interface FrameworkPageView {
  readonly id: string;
  /** Logical Application that owns this normalized Page. */
  readonly applicationId: string;
  /** Canonical Page source and its private-code ownership boundary. */
  readonly source: FrameworkPageSourceView;
  /** Resolved Page extensions available to plugin consumers. */
  readonly extensions: Readonly<Record<string, unknown>>;
  readonly render: RenderMode;
  readonly componentModel?: ComponentModel;
  readonly hydrate?: HydrationMode;
  readonly prerender?: PrerenderConfig;
  readonly ppr?: PprConfig;
  readonly metadata?: PageMetadata;
  /** Producer and source that declared this Page. */
  readonly provenance: CoreNodeProvenance;
}

export interface FrameworkPageSourceView {
  readonly module: string;
  readonly scope: CorePageScope;
  readonly provider: string;
  /** Build-only canonical Page config module, when one was authored. */
  readonly config?: string;
}

export interface FrameworkRouteView {
  readonly realm: "client";
  readonly id: string;
  /** Logical Application that owns this normalized client Route. */
  readonly applicationId: string;
  readonly parentId?: string;
  /** Normalized URL pattern. */
  readonly pattern: CoreRoutePattern;
  /** Semantic destination of this client Route. */
  readonly target: CoreClientRouteTarget;
  /** Complete client Route composition facets. */
  readonly facets: CoreRouteFacets;
  /** Resolved CoreGraph client Route extensions. */
  readonly extensions: Readonly<Record<string, unknown>>;
  /** Producer and source that declared this Route. */
  readonly provenance: CoreNodeProvenance;
}

export interface FrameworkServerFunctionView {
  readonly id: string;
  readonly module: string;
  readonly exportName: string;
}

export interface FrameworkServerRouteView {
  readonly id: string;
  readonly module: string;
  readonly path: string;
  readonly methods: readonly string[];
}

export interface FrameworkEntryView {
  readonly name: string;
  readonly import: string;
  readonly environment: BuildEnvironment;
  readonly runtime?: "browser" | ServerRuntime;
  readonly phase?: BuildEntryPhase;
  readonly kind:
    | "application-client"
    | "page-client"
    | "page-server"
    | "rsc-page"
    | "ppr-shell"
    | "ppr-region"
    | "server-runtime"
    | "runtime";
  readonly owner?: FrameworkEntryOwner;
  readonly metadata?: FrameworkEntryMetadataView;
}

/** Semantic owner exposed by the plugin framework-entry view. */
export interface FrameworkEntryOwner {
  readonly applicationId?: string;
  readonly pageId?: string;
  readonly routeId?: string;
  readonly regionId?: string;
}

export interface FrameworkApplicationEntryView extends FrameworkEntryView {
  readonly kind: "application-client";
  readonly metadata: FrameworkApplicationEntryMetadata;
}

export type FrameworkEntryMetadataView =
  | FrameworkReactComponentPageEntryMetadata
  | FrameworkApplicationEntryMetadata
  | FrameworkServerAppEntryMetadata;

export interface FrameworkReactComponentPageEntryMetadata {
  readonly type: "react-component-page";
  readonly component: string;
  readonly layouts?: readonly string[];
  readonly mount: string;
  readonly hydrate: HydrationMode;
  readonly render: RenderMode;
  readonly route?: {
    readonly id: string;
    readonly path: string;
  };
}

export interface FrameworkApplicationEntryMetadata {
  readonly type: "application";
  readonly routes: readonly FrameworkPageAppRouteView[];
  readonly mount: string;
  readonly rootModule?: string;
}

export interface FrameworkPageAppRouteView {
  readonly id: string;
  readonly path: string;
  readonly parentId?: string;
  readonly kind?: PageRouteKind | "group" | "redirect";
  readonly module?: string;
  readonly target?: AppRouteTarget;
  readonly wrappers?: readonly string[];
  readonly layout?: false;
  readonly errorModule?: string;
  readonly notFoundModule?: string;
  readonly metadata?: PageMetadata;
}

export interface FrameworkServerMiddlewareView {
  readonly id: string;
  readonly module: string;
  readonly scope: "global" | "route";
  readonly scopeSegments?: readonly string[];
}

export interface FrameworkServerAppRouteView extends FrameworkServerRouteView {
  readonly middlewares?: readonly FrameworkServerMiddlewareView[];
}

export interface FrameworkServerAppEntryMetadata {
  readonly type: "server-app";
  readonly routes: readonly FrameworkServerAppRouteView[];
  readonly middlewares?: readonly FrameworkServerMiddlewareView[];
  readonly serverFunctions?: readonly FrameworkServerFunctionView[];
}

export interface ContributionContext<TBundlerCfg = DefaultBundlerConfig>
  extends PluginContext<TBundlerCfg> {
  readonly framework: FrameworkIRView;
  readonly emit: EmitApi;
  slot<K extends FrameworkSlotName>(name: K): FrameworkSlot<K>;
}

export interface EmitApi {
  module(input: {
    id: string;
    scope: GeneratedScope;
    source:
      | string
      | ((helpers: {
          importOf(ref: GeneratedModuleRef): string;
          importFile(file: string): string;
        }) => string);
    extension?: ".ts" | ".tsx" | ".js" | ".jsx" | ".css" | ".less" | ".json";
  }): GeneratedModuleRef;

  data(input: {
    id: string;
    scope: GeneratedScope;
    value: unknown;
  }): GeneratedModuleRef;

  entryFacade(input: {
    id: string;
    entry: FrameworkEntryView;
    scope?: GeneratedScope;
  }): GeneratedModuleRef;

  importOf(ref: GeneratedModuleRef): string;
}

export interface GeneratedModuleRef {
  readonly __evGeneratedModuleRef: unique symbol;
}

export interface FrameworkSlot<K extends FrameworkSlotName> {
  add(input: FrameworkSlotInput<K>): void;
}

export type FrameworkSlotInput<K extends FrameworkSlotName> =
  K extends "client.entry"
    ? ClientEntryContribution
    : K extends "server.request.middleware"
      ? ServerRequestMiddlewareContribution
      : K extends "html.tag"
        ? HtmlTagContribution
        : K extends "resolve.alias"
          ? ResolveAliasContribution
          : K extends "resolve.external"
            ? ResolveExternalContribution
            : never;

export interface ClientEntryContribution {
  id: string;
  module: GeneratedModuleRef | string;
  position: EntryContributionPosition;
  runtime?: ClientContributionRuntime;
  target?: ContributionTarget;
  /**
   * Replaces the generated entry facade with this module.
   *
   * Default "import" mode preserves the framework main import and imports this
   * contribution at the requested position. "replace" is reserved for plugins
   * such as qiankun slave mode that must own the entry exports.
   */
  mode?: "import" | "replace";
}

export interface ServerRequestMiddlewareContribution {
  id: string;
  module: GeneratedModuleRef | string;
}

export interface HtmlTagContribution {
  id: string;
  tag: HtmlTagName;
  placement: HtmlTagPlacement;
  attrs?: Record<string, string | boolean>;
  children?: string;
  target?: ContributionTarget;
}

export interface ResolveAliasContribution {
  id: string;
  specifier: string;
  replacement: GeneratedModuleRef | string;
}

export interface ResolveExternalContribution {
  id: string;
  specifier: string;
  source?: string;
  runtime?: ContributionRuntime;
}

export interface BuildStartContext<TBundlerCfg = DefaultBundlerConfig>
  extends PluginContext<TBundlerCfg> {}

export interface BuildOutputContext<TBundlerCfg = DefaultBundlerConfig>
  extends PluginContext<TBundlerCfg> {}

export interface DisposeContext<TBundlerCfg = DefaultBundlerConfig>
  extends PluginContext<TBundlerCfg> {}

/**
 * Lifecycle hooks returned from plugin setup().
 */
export interface PluginHooks<TBundlerCfg = DefaultBundlerConfig> {
  /** Called before compilation begins. */
  buildStart?: (ctx: BuildStartContext<TBundlerCfg>) => void | Promise<void>;

  /**
   * Inspect or mutate the linked framework build output before deployment
   * metadata is projected and before HTML documents are transformed.
   *
   * Deployment adapters should prefer buildEnd().deploymentMetadata for the
   * canonical deployable artifact shape, and use this hook only when they need
   * to add data to the in-memory BuildOutput before projection.
   */
  buildOutput?: (
    output: BuildOutput,
    ctx: BuildOutputContext<TBundlerCfg>,
  ) => void | Promise<void>;

  /**
   * Modify the underlying bundler configuration directly.
   *
   * The config type defaults to Utoopack's config shape because Utoopack is
   * the default adapter. Projects that switch bundlers can pass a narrower
   * generic or use the typed helper exported by that adapter.
   */
  bundlerConfig?: (
    config: TBundlerCfg,
    ctx: BundlerCtx<TBundlerCfg>,
  ) => void | Promise<void>;

  /** Called after compilation completes. Receives the canonical build result. */
  buildEnd?: (result: BuildResult) => void | Promise<void>;

  /** Called when the command is shutting down or after a build finishes. */
  dispose?: (ctx: DisposeContext<TBundlerCfg>) => void | Promise<void>;

  /**
   * Transform the output HTML document after asset injection.
   *
   * Receives the parsed DOM document and the current HTML document context.
   * Mutate the document in place (e.g. `doc.head.insertAdjacentHTML(...)`).
   * Runs after evjs injects `<script>` / `<link>` tags but before the
   * document is serialized and emitted. Multiple plugins are applied in order.
   */
  transformHtml?: (
    doc: HtmlDocument,
    ctx: HtmlTransformContext<TBundlerCfg>,
  ) => void | Promise<void>;
}

/** Build result passed to plugin hooks. */
export interface BuildResult {
  /** Single framework build output. */
  output: BuildOutput;
  /** Server runtime contract generated from BuildOutput plus runtime-only facts. */
  frameworkRuntime?: FrameworkRuntimeOutput;
  /** Deployment metadata projection for adapters and tooling. */
  deploymentMetadata: DeploymentMetadata;
  /** True if this is a rebuild triggered by file change (dev watch mode only). */
  isRebuild: boolean;
}

export interface HtmlDocumentInfo {
  /** Stable normalized Document id. */
  documentId: string;
  /** Logical Application that owns this Document. */
  applicationId: string;
  /** Semantic owner of this normalized Document. */
  owner: CoreDocumentOwner;
  /** Source HTML template path from resolved config. */
  template: string;
  /** Output HTML filename. */
  fileName: string;
  /** Assets injected into this HTML document. */
  assets: AssetGroup;
}

export type HtmlTransformContext<TBundlerCfg = DefaultBundlerConfig> =
  BuildResult &
    HtmlDocumentInfo &
    PluginContext<TBundlerCfg> & {
      buildId: string;
      publicPath: BuildOutput["publicPath"];
    };
export type BuildOutputHookContext<TBundlerCfg = DefaultBundlerConfig> =
  BuildOutputContext<TBundlerCfg>;

export function createBuildResult(
  output: BuildOutput,
  isRebuild: boolean,
  options: { frameworkRuntime?: FrameworkRuntimeOutput } = {},
): BuildResult {
  return {
    output,
    ...(options.frameworkRuntime
      ? { frameworkRuntime: options.frameworkRuntime }
      : {}),
    deploymentMetadata: createDeploymentMetadata(output),
    isRebuild,
  };
}
