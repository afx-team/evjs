import type {
  AssetGroup,
  BuildEnvironment,
  BuildOutput,
} from "@evjs/shared/manifest";
import { createServerManifest } from "@evjs/shared/manifest";
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

/** JavaScript and CSS assets exposed to plugin manifest views. */
export interface ManifestAssets {
  /** JavaScript bundle paths. */
  js: string[];
  /** CSS bundle paths. */
  css: string[];
}

/** A discovered client route exposed to plugin manifest views. */
export interface RouteEntry {
  /** Route path, e.g. "/", "/posts/$postId", or "*". */
  path: string;
}

/** Per-page client manifest entry exposed to plugin hooks. */
export interface PageManifestEntry {
  /** Bundle asset paths for this page. */
  assets: ManifestAssets;
  /** Discovered routes for this page. */
  routes?: RouteEntry[];
}

/** Client-focused manifest view derived from the linked framework output. */
export interface ClientManifest {
  /** Schema version for this manifest view. */
  version: 1;
  /** Bundle asset paths for SPA HTML injection. */
  assets: ManifestAssets;
  /** Discovered client routes. */
  routes?: RouteEntry[];
  /** Per-page assets for page-style outputs. */
  pages?: Record<string, PageManifestEntry>;
}

/** Server function entry exposed to plugin manifest views. */
export interface ServerFnEntry {
  /** Emitted assets containing this function. */
  assets: ManifestAssets;
}

/** Server route entry exposed to plugin manifest views. */
export interface ServerRouteEntry {
  /** URL path pattern handled by this route. */
  path: string;
  /** HTTP methods explicitly handled by this route. */
  methods: string[];
  /** Emitted assets containing this route handler. */
  assets: ManifestAssets;
}

/** Server-focused manifest view derived from the linked framework output. */
export interface ServerManifest {
  /** Schema version for this manifest view. */
  version: 1;
  /** Server bundle entry filename. */
  entry?: string;
  /** Server bundle asset paths. */
  assets: ManifestAssets;
  /** Registered server functions. */
  fns: Record<string, ServerFnEntry>;
  /** Registered server route handlers. */
  routes?: ServerRouteEntry[];
}

/** Base context passed to plugin bundler hooks. */
export interface EvBundlerCtx<TBundlerCfg = DefaultBundlerConfig> {
  /** The current mode. */
  mode: "development" | "production";
  /** The current working directory. */
  cwd: string;
  /** The fully resolved framework config. */
  config: ResolvedConfig<TBundlerCfg>;
}

/**
 * Context passed to plugin bundler hooks.
 */
export interface BundlerCtx<TBundlerCfg = DefaultBundlerConfig>
  extends EvBundlerCtx<TBundlerCfg> {
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

/** Base context passed to plugin config hooks. */
export interface EvPluginConfigContext {
  /** The current mode. */
  mode: "development" | "production";
  /** The current working directory. */
  cwd: string;
}

/**
 * Context passed to plugin config hooks.
 */
export interface PluginConfigContext extends EvPluginConfigContext {
  /** The current command. */
  command: "dev" | "build";
}

type ConfigHookResult<TBundlerCfg> =
  | Config<TBundlerCfg>
  | undefined
  | void
  | Promise<Config<TBundlerCfg> | undefined>
  | Promise<void>;

type EvPluginSetupResult<TBundlerCfg> =
  | EvPluginHooks<TBundlerCfg>
  | undefined
  | void
  | Promise<EvPluginHooks<TBundlerCfg> | undefined>
  | Promise<void>;

type PluginSetupResult<TBundlerCfg> =
  | PluginHooks<TBundlerCfg>
  | undefined
  | void
  | Promise<PluginHooks<TBundlerCfg> | undefined>
  | Promise<void>;

/**
 * An evjs plugin.
 */
export interface EvPlugin<TBundlerCfg = DefaultBundlerConfig> {
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
    ctx: EvPluginConfigContext,
  ) => ConfigHookResult<TBundlerCfg>;

  /**
   * Initialize the plugin and return lifecycle hooks.
   *
   * Receives the fully resolved config and build context. All returned
   * hooks share state through closure.
   */
  setup?: (
    ctx: EvPluginContext<TBundlerCfg>,
  ) => EvPluginSetupResult<TBundlerCfg>;
}

/** An evjs plugin. The `EvPlugin` alias shape is accepted. */
export interface Plugin<TBundlerCfg = DefaultBundlerConfig>
  extends Omit<EvPlugin<TBundlerCfg>, "config" | "setup"> {
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
  ) => ConfigHookResult<TBundlerCfg>;

  /**
   * Initialize the plugin and return lifecycle hooks.
   *
   * Receives the fully resolved config and build context. All returned
   * hooks share state through closure.
   */
  setup?: (ctx: PluginContext<TBundlerCfg>) => PluginSetupResult<TBundlerCfg>;
}

/** Base context passed to plugin setup(). */
export interface EvPluginContext<TBundlerCfg = DefaultBundlerConfig> {
  /** Current mode. */
  mode: "development" | "production";
  /** The current working directory. */
  cwd: string;
  /** The fully resolved framework config. */
  config: ResolvedConfig<TBundlerCfg>;
}

/**
 * Context passed to plugin setup().
 */
export interface PluginContext<TBundlerCfg = DefaultBundlerConfig>
  extends EvPluginContext<TBundlerCfg> {
  /** Current command. */
  command: "dev" | "build";
  /** Logger plugins can use for framework-scoped messages. */
  logger: Logger;
  /** Adds an extra framework-level watch file in dev mode. */
  addWatchFile(file: string): void;
}

export interface BuildStartContext<TBundlerCfg = DefaultBundlerConfig>
  extends PluginContext<TBundlerCfg> {}

export interface BuildOutputContext<TBundlerCfg = DefaultBundlerConfig>
  extends PluginContext<TBundlerCfg> {}

export interface DisposeContext<TBundlerCfg = DefaultBundlerConfig>
  extends PluginContext<TBundlerCfg> {}

/** Lifecycle hooks returned from plugin setup(). */
export interface EvPluginHooks<TBundlerCfg = DefaultBundlerConfig> {
  /** Called before compilation begins. */
  buildStart?: () => void | Promise<void>;

  /**
   * Modify the underlying bundler configuration directly.
   *
   * The config type defaults to Utoopack's config shape because Utoopack is
   * the default adapter. Projects that switch bundlers can pass a narrower
   * generic or use the typed helper exported by that adapter.
   */
  bundlerConfig?: (
    config: TBundlerCfg,
    ctx: EvBundlerCtx<TBundlerCfg>,
  ) => void | Promise<void>;

  /** Called after compilation completes. Receives build result with manifests. */
  buildEnd?: (result: EvBuildResult) => void | Promise<void>;

  /**
   * Transform the output HTML document after asset injection.
   *
   * Receives the parsed DOM document and the build result (with manifests).
   * Mutate the document in place (e.g. `doc.head.insertAdjacentHTML(...)`).
   * Runs after evjs injects `<script>` / `<link>` tags but before the
   * document is serialized and emitted. Multiple plugins are applied in order.
   */
  transformHtml?: (
    doc: HtmlDocument,
    result: EvBuildResult,
  ) => void | Promise<void>;
}

/**
 * Lifecycle hooks returned from plugin setup().
 */
export interface PluginHooks<TBundlerCfg = DefaultBundlerConfig>
  extends Omit<
    EvPluginHooks<TBundlerCfg>,
    "buildStart" | "bundlerConfig" | "buildEnd" | "transformHtml"
  > {
  /** Called before compilation begins. */
  buildStart?:
    | EvPluginHooks<TBundlerCfg>["buildStart"]
    | ((ctx: BuildStartContext<TBundlerCfg>) => void | Promise<void>);

  /**
   * Inspect or mutate the linked framework build output before it is emitted
   * as the framework manifest and before HTML documents are transformed.
   *
   * Deployment adapters should use this hook to add deployment metadata to the
   * BuildOutput emitted as `dist/build-output.json`.
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

  /** Called after compilation completes. Receives build result with manifests. */
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
export interface EvBuildResult {
  /** Client-focused manifest view derived from `output`. */
  clientManifest: ClientManifest;
  /** Server-focused manifest view derived from `output`. */
  serverManifest: ServerManifest;
  /** True if this is a rebuild triggered by file change (dev watch mode only). */
  isRebuild: boolean;
}

/**
 * Build result passed to the buildEnd hook.
 */
export interface BuildResult extends EvBuildResult {
  /** Single framework build output. */
  output: BuildOutput;
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
export type BuildOutputHookContext<TBundlerCfg = DefaultBundlerConfig> =
  BuildOutputContext<TBundlerCfg>;

export type EvDocument = HtmlDocument;

const EMPTY_ASSETS: ManifestAssets = { js: [], css: [] };

export function createBuildResult(
  output: BuildOutput,
  isRebuild: boolean,
): BuildResult {
  return {
    output,
    clientManifest: createClientManifest(output),
    serverManifest: createServerManifest(output),
    isRebuild,
  };
}

function createClientManifest(output: BuildOutput): ClientManifest {
  const pageEntries = Object.entries(output.pages).filter(
    ([, page]) => page.document,
  );
  const routes = createRouteEntries(output);
  const pages =
    pageEntries.length > 0
      ? Object.fromEntries(
          pageEntries.map(([pageId, page]) => {
            const pageRoutes = createRouteEntries(output, pageId);
            return [
              pageId,
              {
                assets: cloneAssets(page.assets),
                ...(pageRoutes.length > 0 ? { routes: pageRoutes } : {}),
              },
            ];
          }),
        )
      : undefined;

  return {
    version: 1,
    assets: pages
      ? cloneAssets(EMPTY_ASSETS)
      : cloneAssets(getAppAssets(output)),
    ...(routes.length > 0 ? { routes } : {}),
    ...(pages ? { pages } : {}),
  };
}

function createRouteEntries(
  output: BuildOutput,
  pageId?: string,
): RouteEntry[] {
  return output.routes
    .filter((route) => pageId === undefined || route.pageId === pageId)
    .map((route) => ({ path: route.path }));
}

function getAppAssets(output: BuildOutput): AssetGroup {
  return (
    output.apps.default?.assets ??
    Object.values(output.apps)[0]?.assets ??
    Object.values(output.assets)[0] ??
    EMPTY_ASSETS
  );
}

function cloneAssets(assets: AssetGroup): ManifestAssets {
  return {
    js: [...assets.js],
    css: [...assets.css],
  };
}
