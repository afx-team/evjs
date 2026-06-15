import type {
  AppGraph,
  AssetGroup,
  BuildEnvironment,
  BuildOutput,
  BuildPlan,
  BuildPlanUpdate,
} from "@evjs/shared/manifest";
import type { Logger } from "@logtape/logtape";
import type { Config, DefaultBundlerConfig, ResolvedConfig } from "./config.js";

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
  /** The current command. */
  command: "dev" | "build";
  /** The current working directory. */
  cwd: string;
  /** The fully resolved framework config. */
  config: ResolvedConfig<TBundlerCfg>;
  /** The framework build plan passed to the selected bundler adapter. */
  plan: BuildPlan;
  /** Selected bundler adapter name. */
  bundlerName: string;
  /** Environment currently being configured when known. */
  environment?: BuildEnvironment | "mixed";
  /** Logger plugins can use for framework-scoped messages. */
  logger: Logger;
  /** Adds an extra framework-level watch file in dev mode. */
  addWatchFile(file: string): void;
}

/**
 * Context passed to plugin config hooks.
 */
export interface PluginConfigContext {
  /** The current mode. */
  mode: "development" | "production";
  /** The current command. */
  command: "dev" | "build";
  /** The current working directory. */
  cwd: string;
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
   * Relative ordering tier for plugins without an explicit dependency edge.
   *
   * Dependencies still win over enforce ordering.
   */
  enforce?: "pre" | "normal" | "post";

  /**
   * Modify the raw user config before defaults are resolved.
   *
   * Use this for framework-level config such as `server.basePath` that must
   * be visible to dev proxy setup and build-time runtime defines.
   */
  config?: (
    config: Config<TBundlerCfg>,
    ctx: PluginConfigContext,
  ) =>
    | Config<TBundlerCfg>
    | undefined
    | Promise<Config<TBundlerCfg> | undefined>;

  /**
   * Initialize the plugin and return lifecycle hooks.
   *
   * Receives the fully resolved config and build context. All returned
   * hooks share state through closure.
   */
  setup?: (
    ctx: PluginContext<TBundlerCfg>,
  ) =>
    | PluginHooks<TBundlerCfg>
    | undefined
    | Promise<PluginHooks<TBundlerCfg> | undefined>;
}

/**
 * Context passed to plugin setup().
 */
export interface PluginContext<TBundlerCfg = DefaultBundlerConfig> {
  /** Current mode. */
  mode: "development" | "production";
  /** Current command. */
  command: "dev" | "build";
  /** The current working directory. */
  cwd: string;
  /** The fully resolved framework config. */
  config: ResolvedConfig<TBundlerCfg>;
  /** Logger plugins can use for framework-scoped messages. */
  logger: Logger;
  /** Adds an extra framework-level watch file in dev mode. */
  addWatchFile(file: string): void;
}

export interface CommandContext<TBundlerCfg = DefaultBundlerConfig>
  extends PluginContext<TBundlerCfg> {}

export interface BuildStartContext<TBundlerCfg = DefaultBundlerConfig>
  extends PluginContext<TBundlerCfg> {}

export interface AppGraphContext<TBundlerCfg = DefaultBundlerConfig>
  extends PluginContext<TBundlerCfg> {}

export interface BuildPlanContext<TBundlerCfg = DefaultBundlerConfig>
  extends PluginContext<TBundlerCfg> {
  graph: AppGraph;
}

export interface BuildOutputContext<TBundlerCfg = DefaultBundlerConfig>
  extends PluginContext<TBundlerCfg> {
  graph: AppGraph;
  plan: BuildPlan;
}

export interface DevPlanUpdateContext<TBundlerCfg = DefaultBundlerConfig>
  extends PluginContext<TBundlerCfg> {
  graph: AppGraph;
}

export interface DisposeContext<TBundlerCfg = DefaultBundlerConfig>
  extends PluginContext<TBundlerCfg> {}

/**
 * Lifecycle hooks returned from plugin setup().
 */
export interface PluginHooks<TBundlerCfg = DefaultBundlerConfig> {
  /** Called after setup and before graph/build work starts. */
  commandStart?: (ctx: CommandContext<TBundlerCfg>) => void | Promise<void>;

  /** Called before compilation begins. */
  buildStart?: (ctx: BuildStartContext<TBundlerCfg>) => void | Promise<void>;

  /**
   * Inspect or mutate the framework semantic graph before entries are planned.
   *
   * Use this for framework metadata such as pages, routes, server routes,
   * server functions, and remotes. This hook runs before bundler config
   * creation and is independent of the selected bundler adapter.
   */
  appGraph?: (
    graph: AppGraph,
    ctx: AppGraphContext<TBundlerCfg>,
  ) => void | Promise<void>;

  /**
   * Inspect or mutate the bundler-independent build plan.
   *
   * Use this for entry/html/runtime planning. Low-level bundler-specific
   * changes should stay in `bundlerConfig`.
   */
  buildPlan?: (
    plan: BuildPlan,
    ctx: BuildPlanContext<TBundlerCfg>,
  ) => void | Promise<void>;

  /**
   * Inspect or mutate the linked framework build output before it is emitted
   * as `dist/manifest.json` and before HTML documents are transformed.
   *
   * Deployment adapters should use this hook to add deployment metadata to the
   * single framework output emitted as `dist/manifest.json`.
   */
  buildOutput?: (
    output: BuildOutput,
    ctx: BuildOutputContext<TBundlerCfg>,
  ) => void | Promise<void>;

  /**
   * Modify the underlying bundler configuration directly.
   *
   * The config type defaults to the framework-agnostic
   * `DefaultBundlerConfig`. Use the typed helper exported by each bundler
   * adapter for type safety (e.g., `utoopack()` from
   * `@evjs/bundler-utoopack`).
   */
  bundlerConfig?: (
    config: TBundlerCfg,
    ctx: BundlerCtx<TBundlerCfg>,
  ) => void | Promise<void>;

  /** Called after compilation completes. Receives build result with manifests. */
  buildEnd?: (result: BuildResult) => void | Promise<void>;

  /**
   * Called in dev when framework-level declarations change and the new build
   * plan can be diffed against the previous plan.
   *
   * This hook is part of the breaking plugin contract even though the current
   * Utoopack adapter cannot yet apply dynamic entry updates without lower-layer
   * support.
   */
  devPlanUpdate?: (
    update: BuildPlanUpdate,
    ctx: DevPlanUpdateContext<TBundlerCfg>,
  ) => void | Promise<void>;

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

/**
 * Build result passed to the buildEnd hook.
 */
export interface BuildResult {
  /** Single framework build output. */
  output: BuildOutput;
  /** True if this is a rebuild triggered by file change (dev watch mode only). */
  isRebuild: boolean;
}

export type HtmlDocumentInfo =
  | {
      /** Framework owner type for the HTML document. */
      kind: "app";
      /** Stable HTML document id. */
      htmlId: string;
      /** Owning app id. */
      appId: string;
      /** Source HTML template path from resolved config. */
      template: string;
      /** Output HTML filename. */
      fileName: string;
      /** Assets injected into this HTML document. */
      assets: AssetGroup;
    }
  | {
      /** Framework owner type for the HTML document. */
      kind: "page";
      /** Stable HTML document id. */
      htmlId: string;
      /** Owning page id. */
      pageId: string;
      /** Source HTML template path from resolved config. */
      template: string;
      /** Output HTML filename. */
      fileName: string;
      /** Assets injected into this HTML document. */
      assets: AssetGroup;
    };

export type HtmlTransformContext<TBundlerCfg = DefaultBundlerConfig> =
  BuildResult &
    HtmlDocumentInfo &
    PluginContext<TBundlerCfg> & {
      buildId: string;
      publicPath: BuildOutput["publicPath"];
    };
export type AppGraphHookContext<TBundlerCfg = DefaultBundlerConfig> =
  AppGraphContext<TBundlerCfg>;
export type BuildPlanHookContext<TBundlerCfg = DefaultBundlerConfig> =
  BuildPlanContext<TBundlerCfg>;
export type BuildOutputHookContext<TBundlerCfg = DefaultBundlerConfig> =
  BuildOutputContext<TBundlerCfg>;
export type CommandHookContext<TBundlerCfg = DefaultBundlerConfig> =
  CommandContext<TBundlerCfg>;
