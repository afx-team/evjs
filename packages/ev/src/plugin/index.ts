import type { FrameworkRuntime } from "@evjs/server";
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
import type { Logger } from "@logtape/logtape";
import type { Config, ResolvedFrameworkConfig } from "../config/index.js";

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
export {
  definePlugin,
  type PluginFactory,
  type PluginInstance,
  type PluginOptionsContext,
  type PluginOptionsContract,
  type PluginOptionsDefinition,
  pluginOptions,
} from "./defined.js";

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
export interface ConfigureBundlerContext<TBundlerCfg = unknown> {
  /** The current mode. */
  readonly mode: "development" | "production";
  /** The current working directory. */
  readonly cwd: string;
  /** The fully resolved, read-only framework config. */
  readonly config: ReadonlyFrameworkConfig<TBundlerCfg>;
  /** Selected bundler adapter name. */
  readonly bundlerName: string;
  /** Environment currently being configured when known. */
  readonly environment?: BuildEnvironment | "mixed";
  /** Logger plugins can use for framework-scoped messages. */
  readonly logger: Logger;
  /** Adds an extra framework-level watch file in dev mode. */
  addWatchFile(file: string): void;
}

/** Context passed to plugin configure hooks. */
export interface PluginConfigureContext {
  /** The current mode. */
  readonly mode: "development" | "production";
  /** The current working directory. */
  readonly cwd: string;
  /** Extra CLI flags made available to plugins. */
  readonly flags?: DeepReadonly<CliFlags>;
}

/** Framework configuration a plugin may change before defaults are resolved. */
export type PluginConfigureInput<TBundlerCfg = unknown> = Omit<
  Config<TBundlerCfg>,
  "plugins"
>;

type PluginConfigureOutput<TBundlerCfg> = PluginConfigureInput<TBundlerCfg> & {
  readonly plugins?: never;
};

type ConfigureHookResult<TBundlerCfg> =
  | PluginConfigureOutput<TBundlerCfg>
  | undefined
  | void
  | Promise<PluginConfigureOutput<TBundlerCfg> | undefined>
  | Promise<void>;

type PluginSetupResult<TBundlerCfg> =
  | PluginHooks<TBundlerCfg>
  | undefined
  | void
  | Promise<PluginHooks<TBundlerCfg> | undefined>
  | Promise<void>;

type EmitIRHookResult = void | Promise<void>;

type AnyFunction = (...args: never[]) => unknown;

declare const pluginBundlerConfigType: unique symbol;

type PluginBundlerConfigType<TBundlerCfg> = (config: TBundlerCfg) => void;

type DeepReadonly<T> = T extends AnyFunction
  ? T
  : T extends readonly unknown[]
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

type ReadonlyPlugin<TBundlerCfg> = Readonly<
  Omit<Plugin<TBundlerCfg>, "dependencies" | "optionalDependencies">
> & {
  readonly dependencies?: readonly string[];
  readonly optionalDependencies?: readonly string[];
};

type ReadonlyFrameworkConfig<TBundlerCfg> = DeepReadonly<
  Omit<ResolvedFrameworkConfig<TBundlerCfg>, "plugins">
> & {
  readonly plugins: readonly ReadonlyPlugin<TBundlerCfg>[];
};

type PluginConfigureHook<TBundlerCfg> = <
  TActualBundlerCfg extends TBundlerCfg = TBundlerCfg,
>(
  config: PluginConfigureInput<TActualBundlerCfg>,
  ctx: PluginConfigureContext,
) => ConfigureHookResult<TActualBundlerCfg>;

type PluginSetupHook<TBundlerCfg> = <
  TActualBundlerCfg extends TBundlerCfg = TBundlerCfg,
>(
  ctx: PluginSetupContext<TActualBundlerCfg>,
) => PluginSetupResult<TBundlerCfg>;

type PluginEmitIRHook<TBundlerCfg> = <
  TActualBundlerCfg extends TBundlerCfg = TBundlerCfg,
>(
  ctx: PluginEmitIRContext<TActualBundlerCfg>,
) => EmitIRHookResult;

/**
 * An evjs plugin.
 *
 * A bare `Plugin` is valid with any bundler. Pass a concrete bundler config
 * type only when the plugin intentionally depends on that config shape.
 */
export interface Plugin<TBundlerCfg = unknown> {
  /** Type-only marker that keeps bundler-specific plugins incompatible. */
  readonly [pluginBundlerConfigType]?: PluginBundlerConfigType<TBundlerCfg>;

  /**
   * Stable plugin identity used by dependencies, Page settings, generated IR,
   * diagnostics, and logging.
   */
  readonly id: string;

  /**
   * Required plugin dependencies that must run before this plugin.
   *
   * Missing required dependencies are treated as configuration errors.
   */
  readonly dependencies?: readonly string[];

  /**
   * Optional plugin dependencies that run before this plugin when present.
   *
   * Missing optional dependencies are ignored. Present optional dependencies
   * still participate in dependency ordering and cycle detection.
   */
  readonly optionalDependencies?: readonly string[];

  /**
   * Modify the raw user config before defaults are resolved.
   *
   * Use this for framework-level config such as `server.basePath` that must
   * be visible to dev proxy setup and build-time runtime defines. Plugin
   * installation is application-owned and cannot be changed from this hook.
   */
  configure?: PluginConfigureHook<TBundlerCfg>;

  /**
   * Initialize the plugin and return lifecycle hooks.
   *
   * Receives the fully resolved config and build context. All returned
   * hooks share state through closure.
   */
  setup?: PluginSetupHook<TBundlerCfg>;

  /**
   * Declare interactive CLI keyboard shortcuts for `ev dev`.
   *
   * This contribution is collected once from the fixed resolved plugin set of
   * each immutable dev Session. Its static descriptors are independent from
   * setup lifecycle state; each `action` receives the live
   * {@link PluginDevSession} when its key is pressed. Core ships no built-in
   * shortcuts, including help. The first plugin to register a key owns it, and
   * the engine is a no-op in CI / non-TTY contexts.
   */
  cliShortcuts?: () =>
    | readonly PluginCliShortcut[]
    | Promise<readonly PluginCliShortcut[]>;

  /**
   * Emit generated framework modules and slots into the `.ev` IR.
   *
   * This hook is separate from setup() lifecycle hooks. It declares generated
   * modules, structured framework slots, and resolution changes before bundler
   * configuration is created.
   */
  emitIR?: PluginEmitIRHook<TBundlerCfg>;

  /**
   * Relative ordering tier for plugins without an explicit dependency edge.
   *
   * Dependencies still win over enforce ordering.
   */
  enforce?: "pre" | "normal" | "post";
}

interface PluginBaseContext<TBundlerCfg = unknown> {
  /** Current mode. */
  readonly mode: "development" | "production";
  /** The current working directory. */
  readonly cwd: string;
  /** The fully resolved, read-only framework config. */
  readonly config: ReadonlyFrameworkConfig<TBundlerCfg>;
  /** Extra CLI flags made available to plugins. */
  readonly flags?: DeepReadonly<CliFlags>;
  /** Logger plugins can use for framework-scoped messages. */
  readonly logger: Logger;
}

/** Context passed to plugin setup(). */
export interface PluginSetupContext<TBundlerCfg = unknown>
  extends PluginBaseContext<TBundlerCfg> {
  /** Adds an extra framework-level watch file in dev mode. */
  addWatchFile(file: string): void;
}

export type CliFlagValue = boolean | string | Array<boolean | string>;

export type CliFlags = Record<string, CliFlagValue>;

/** Read-only framework snapshot exposed while plugins emit framework IR. */
export interface FrameworkView {
  /** Normalized Applications discovered before bundling. */
  readonly applications: readonly FrameworkApplicationView[];
  /** Explicit or convention-derived pages discovered before bundling. */
  readonly pages: readonly FrameworkPageView[];
  /** Client route graph discovered from `src/pages` or config. */
  readonly routes: readonly FrameworkRouteView[];
  /** Materialized HTML Documents from the normalized CoreGraph. */
  readonly documents: readonly FrameworkDocumentView[];
  /** Server request Routes discovered from `api.*` anchors under `src/apis`. */
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
  readonly aliases?: readonly string[];
  readonly applicationId: string;
  readonly owner: DeepReadonly<CoreDocumentOwner>;
  readonly mount?: string;
  readonly bootstrap?: DeepReadonly<CoreDocumentBootstrap>;
  readonly provenance: DeepReadonly<CoreNodeProvenance>;
}

export type FrameworkApplicationPluginSettingsView = Readonly<
  Record<string, { readonly enabled: boolean }>
>;

export type FrameworkPagePluginSettingsView = Readonly<
  Record<
    string,
    | { readonly enabled: false; readonly options?: never }
    | {
        readonly enabled: true;
        readonly options: Readonly<Record<string, unknown>>;
      }
  >
>;

export interface FrameworkApplicationView {
  readonly id: string;
  /** Effective settings for installed plugins on this Application. */
  readonly plugins: FrameworkApplicationPluginSettingsView;
  /** Source boundary claimed by the Application provider. */
  readonly root: string;
  /** Route and Document materialization mode for this Application. */
  readonly routingMode: "spa" | "mpa";
  /** Application-level React layout shared by its Page routes. */
  readonly layout?: string;
  /** Semantic Pages owned by this Application. */
  readonly pageIds: readonly string[];
  /** Client or Document Routes owned by this Application. */
  readonly routeIds: readonly string[];
  /** HTML Documents owned by this Application. */
  readonly documentIds: readonly string[];
  /** Producer and source that declared this Application. */
  readonly provenance: DeepReadonly<CoreNodeProvenance>;
}

export interface FrameworkPageView {
  readonly id: string;
  /** Logical Application that owns this normalized Page. */
  readonly applicationId: string;
  /** Canonical Page source and its private-code ownership boundary. */
  readonly source: FrameworkPageSourceView;
  /** Effective settings for installed plugins on this Page. */
  readonly plugins: FrameworkPagePluginSettingsView;
  readonly render: RenderMode;
  readonly componentModel?: ComponentModel;
  readonly hydrate?: HydrationMode;
  readonly prerender?: DeepReadonly<PrerenderConfig>;
  readonly ppr?: DeepReadonly<PprConfig>;
  readonly metadata?: DeepReadonly<PageMetadata>;
  /** Producer and source that declared this Page. */
  readonly provenance: DeepReadonly<CoreNodeProvenance>;
}

export interface FrameworkPageSourceView {
  readonly module: string;
  readonly scope: DeepReadonly<CorePageScope>;
  readonly provider: string;
  /** Build-only canonical Page config module, when one was authored. */
  readonly config?: string;
}

export interface FrameworkRouteView {
  readonly id: string;
  /** Logical Application that owns this normalized client Route. */
  readonly applicationId: string;
  readonly parentId?: string;
  /** Normalized URL pattern. */
  readonly pattern: DeepReadonly<CoreRoutePattern>;
  /** Semantic destination of this client Route. */
  readonly target: DeepReadonly<CoreClientRouteTarget>;
  /** Complete client Route composition facets. */
  readonly facets: DeepReadonly<CoreRouteFacets>;
  /** Producer and source that declared this Route. */
  readonly provenance: DeepReadonly<CoreNodeProvenance>;
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
  | FrameworkReactServerPageEntryMetadata
  | FrameworkApplicationEntryMetadata
  | FrameworkServerAppEntryMetadata;

export interface FrameworkReactComponentPageEntryMetadata {
  readonly type: "react-component-page";
  readonly component: string;
  readonly layers?: readonly FrameworkReactPageLayer[];
  readonly mount: string;
  readonly hydrate: HydrationMode;
  readonly render: RenderMode;
  readonly route?: {
    readonly id: string;
    readonly path: string;
  };
}

export interface FrameworkReactServerPageEntryMetadata {
  readonly type: "react-server-page";
  readonly component: string;
  readonly layers?: readonly FrameworkReactPageLayer[];
}

export interface FrameworkReactPageLayer {
  readonly kind: "layout" | "wrapper";
  readonly module: string;
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
  readonly target?: DeepReadonly<AppRouteTarget>;
  readonly wrappers?: readonly string[];
  readonly layout?: false;
  readonly errorModule?: string;
  readonly notFoundModule?: string;
  readonly metadata?: DeepReadonly<PageMetadata>;
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

export interface PluginEmitIRContext<TBundlerCfg = unknown>
  extends PluginSetupContext<TBundlerCfg> {
  readonly framework: FrameworkView;
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
    /**
     * Disable framework-owned startup for a generated SPA Application facade.
     * The replacing entry must call the exported app.render() itself.
     */
    autoStart?: boolean;
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
    : K extends "server.entry"
      ? ServerEntryContribution
      : K extends "page.wrapper"
        ? PageWrapperContribution
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

interface ServerEntryContributionBase {
  id: string;
  module: GeneratedModuleRef | string;
  target: { kind: "page"; pageId: string };
}

/** Imports into or replaces one existing framework-owned Page server entry. */
export type ServerEntryContribution = ServerEntryContributionBase &
  (
    | {
        position: EntryContributionPosition;
        mode?: "import";
      }
    | {
        /** Replacement positions are normalized but do not affect output. */
        position?: EntryContributionPosition;
        mode: "replace";
      }
  );

/**
 * Wraps semantic Pages with one React component module.
 *
 * The module must default-export a component that accepts `children`.
 */
export interface PageWrapperContribution {
  id: string;
  module: GeneratedModuleRef | string;
  /** Defaults to "all", which applies every available side and requires one. */
  runtime?: ContributionRuntime;
  /** Omit to wrap every semantic Page. */
  target?: ContributionTarget;
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

export interface BeforeBuildContext<TBundlerCfg = unknown>
  extends PluginBaseContext<TBundlerCfg> {
  /** True when processing a dev rebuild rather than the initial output. */
  readonly isRebuild: boolean;
}

/**
 * Late lifecycle context passed after the client dev server starts listening.
 * Analysis watch registration is intentionally unavailable at this stage.
 */
export interface DevServerReadyContext<TBundlerCfg = unknown>
  extends PluginBaseContext<TBundlerCfg> {
  readonly mode: "development";
  /** Actual client dev server origin reported by the bundler adapter. */
  readonly origin: string;
  /**
   * Cooperative cancellation signal aborted when the owning immutable
   * development Session starts closing. Aborting the signal does not settle
   * the hook's Promise automatically; asynchronous work must observe it.
   */
  readonly signal: AbortSignal;
}

export interface TransformOutputContext<TBundlerCfg = unknown>
  extends PluginBaseContext<TBundlerCfg> {}

export interface DisposeContext<TBundlerCfg = unknown>
  extends PluginBaseContext<TBundlerCfg> {}

type BeforeBuildHook<TBundlerCfg> = <
  TActualBundlerCfg extends TBundlerCfg = TBundlerCfg,
>(
  ctx: BeforeBuildContext<TActualBundlerCfg>,
) => void | Promise<void>;

type DevServerReadyHook<TBundlerCfg> = <
  TActualBundlerCfg extends TBundlerCfg = TBundlerCfg,
>(
  ctx: DevServerReadyContext<TActualBundlerCfg>,
) => void | Promise<void>;

type TransformOutputHook<TBundlerCfg> = <
  TActualBundlerCfg extends TBundlerCfg = TBundlerCfg,
>(
  output: BuildOutput,
  ctx: TransformOutputContext<TActualBundlerCfg>,
) => void | Promise<void>;

type ConfigureBundlerHook<TBundlerCfg> = <
  TActualBundlerCfg extends TBundlerCfg = TBundlerCfg,
>(
  config: TActualBundlerCfg,
  ctx: ConfigureBundlerContext<TActualBundlerCfg>,
) => void | Promise<void>;

type DisposeHook<TBundlerCfg> = <
  TActualBundlerCfg extends TBundlerCfg = TBundlerCfg,
>(
  ctx: DisposeContext<TActualBundlerCfg>,
) => void | Promise<void>;

type TransformHtmlHook<TBundlerCfg> = <
  TActualBundlerCfg extends TBundlerCfg = TBundlerCfg,
>(
  doc: HtmlDocument,
  ctx: TransformHtmlContext<TActualBundlerCfg>,
) => void | Promise<void>;

/**
 * Lifecycle hooks returned from plugin setup().
 *
 * Bare `PluginHooks` are safe with every bundler. Pass a concrete bundler
 * config type for hooks that intentionally depend on one config shape.
 */
export interface PluginHooks<TBundlerCfg = unknown> {
  /** Type-only marker that keeps bundler-specific hooks incompatible. */
  readonly [pluginBundlerConfigType]?: PluginBundlerConfigType<TBundlerCfg>;

  /**
   * Modify the underlying bundler configuration directly.
   *
   * Bare hooks are bundler-polymorphic. Use the typed helper exported by an
   * adapter or pass a concrete config type for adapter-specific changes.
   */
  configureBundler?: ConfigureBundlerHook<TBundlerCfg>;

  /**
   * Called once after this immutable development Session's client server is
   * listening. The actual adapter-reported origin is available on the context.
   * Ordinary bundler/HMR rebuilds do not call this hook again.
   *
   * Rejecting this hook while its Session is active terminates the whole
   * development run. Session shutdown or replacement aborts the context signal
   * and waits for an in-flight hook to settle before running dispose hooks. CLI
   * shortcut binding proceeds independently and does not wait for this hook to
   * settle.
   */
  devServerReady?: DevServerReadyHook<TBundlerCfg>;

  /**
   * Called after fresh bundler facts are available and before evjs links and
   * publishes canonical output.
   */
  beforeBuild?: BeforeBuildHook<TBundlerCfg>;

  /**
   * Inspect or mutate the linked framework build output before deployment
   * metadata is projected and before HTML documents are transformed.
   *
   * Deployment adapters should prefer afterBuild().deploymentMetadata for the
   * canonical deployable artifact shape, and use this hook only when they need
   * to add data to the in-memory BuildOutput before projection.
   * CoreGraph-owned Document file names and aliases are immutable here.
   */
  transformOutput?: TransformOutputHook<TBundlerCfg>;

  /**
   * Transform the output HTML document after asset injection.
   *
   * Receives the parsed DOM document and the current HTML document context.
   * Mutate the document in place (e.g. `doc.head.insertAdjacentHTML(...)`).
   * Runs after evjs injects `<script>` / `<link>` tags but before the
   * document is serialized for static emission or compiled into a request-time
   * server shell. Multiple plugins are applied in order.
   */
  transformHtml?: TransformHtmlHook<TBundlerCfg>;

  /**
   * Called after canonical output is published successfully. Receives an
   * isolated snapshot; mutations do not affect later hooks or artifacts.
   */
  afterBuild?: (result: BuildResult) => void | Promise<void>;

  /**
   * Retire this plugin snapshot after a production build, dev shutdown,
   * configuration replacement, or initialization rollback. Ordinary dev
   * rebuilds do not dispose the active snapshot.
   */
  dispose?: DisposeHook<TBundlerCfg>;
}

/**
 * Capability handle surfaced to a plugin shortcut action at press time.
 *
 * This is the dev-facing shape; the build orchestrator (`_internal/build`)
 * constructs the concrete implementation. `origin` is the client dev server
 * URL exposed by the active immutable bundler controller. Surface is
 * intentionally minimal: it exposes only data and a Supervisor shutdown
 * trigger. Core ships no built-in shortcut actions (no `restart`, `open`,
 * etc.); plugins that want such behavior implement it themselves from these
 * primitives plus their own utilities.
 */
export interface PluginDevSession {
  /** Client dev server origin, e.g. `http://localhost:3000`. */
  readonly origin: string;
  /** Request dev shutdown (equivalent to Ctrl-C); resolves after the request. */
  close(): Promise<void>;
}

/** A plugin-contributed CLI keyboard shortcut. */
export interface PluginCliShortcut {
  /** Lowercase single-character key matched against a pressed line. */
  readonly key: string;
  /** Human description of what the shortcut does. */
  readonly description: string;
  /**
   * Action invoked with the live {@link PluginDevSession}. Omitting it reserves
   * the key and description without running an action; later duplicates remain
   * ignored by the first-writer-wins rule.
   */
  readonly action?: (session: PluginDevSession) => void | Promise<void>;
}

/** Build result passed to plugin hooks. */
export interface BuildResult {
  /** Single framework build output. */
  output: BuildOutput;
  /** Server runtime contract generated from BuildOutput plus runtime-only facts. */
  frameworkRuntime?: FrameworkRuntime;
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
  /** Logical HTML filename; request-time server shells are not written here. */
  fileName: string;
  /** Assets injected into this HTML document. */
  assets: AssetGroup;
}

export type TransformHtmlContext<TBundlerCfg = unknown> = BuildResult &
  HtmlDocumentInfo &
  PluginBaseContext<TBundlerCfg> & {
    buildId: string;
    publicPath: BuildOutput["publicPath"];
  };
