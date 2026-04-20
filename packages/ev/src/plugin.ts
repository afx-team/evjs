import type { ClientManifest, ServerManifest } from "@evjs/manifest";
import type { ResolvedEvConfig } from "./config.js";

/**
 * Minimal DOM element / document interface for plugin HTML manipulation.
 *
 * This is a bundler-agnostic subset of the standard DOM API. The concrete
 * implementation is provided by the underlying parser (`domparser-rs`), but
 * plugins only depend on this interface.
 */
export interface EvDocument {
  // ── Querying ──────────────────────────────────────────────────────────
  querySelector(selectors: string): EvDocument | null;
  querySelectorAll(selectors: string): EvDocument[];
  getElementById(id: string): EvDocument | null;
  getElementsByTagName(tagName: string): EvDocument[];
  getElementsByClassName(classNames: string): EvDocument[];

  // ── Attributes ────────────────────────────────────────────────────────
  getAttribute(name: string): string | null;
  getAttributeNames(): string[];
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;

  // ── Tree mutation ─────────────────────────────────────────────────────
  appendChild(newChild: EvDocument): EvDocument;
  removeChild(child: EvDocument): EvDocument;
  insertBefore(newNode: EvDocument, refNode?: EvDocument | null): EvDocument;
  replaceChild(newChild: EvDocument, oldChild: EvDocument): EvDocument;
  append(newChild: EvDocument): void;
  prepend(newChild: EvDocument): void;
  before(newSibling: EvDocument): void;
  after(newSibling: EvDocument): void;
  remove(): void;
  replaceWith(newNode: EvDocument): void;

  // ── Content insertion ─────────────────────────────────────────────────
  insertAdjacentHTML(position: string, html: string): void;
  insertAdjacentText(position: string, text: string): void;
  insertAdjacentElement(position: string, element: EvDocument): void;

  // ── Creation (document-level) ─────────────────────────────────────────
  createElement(tagName: string): EvDocument;
  createTextNode(data: string): EvDocument;
  createComment(data: string): EvDocument;

  // ── Properties ────────────────────────────────────────────────────────
  readonly tagName: string | null;
  id: string;
  className: string;
  innerHTML: string;
  readonly outerHTML: string;
  textContent: string;

  // ── Traversal ─────────────────────────────────────────────────────────
  readonly parentNode: EvDocument | null;
  readonly parentElement: EvDocument | null;
  readonly firstChild: EvDocument | null;
  readonly lastChild: EvDocument | null;
  readonly firstElementChild: EvDocument | null;
  readonly lastElementChild: EvDocument | null;
  readonly previousSibling: EvDocument | null;
  readonly nextSibling: EvDocument | null;
  readonly previousElementSibling: EvDocument | null;
  readonly nextElementSibling: EvDocument | null;
  readonly children: EvDocument[];
  readonly childNodes: EvDocument[];
  readonly childElementCount: number;
  hasChildNodes(): boolean;
  contains(otherNode: EvDocument): boolean;

  // ── Document-level accessors ──────────────────────────────────────────
  readonly head: EvDocument | null;
  readonly body: EvDocument | null;
  readonly title: string;
  readonly documentElement: EvDocument | null;

  // ── Cloning ───────────────────────────────────────────────────────────
  cloneNode(deep?: boolean): EvDocument;
}

/**
 * Context passed to plugin bundler hooks.
 */
export interface EvBundlerCtx {
  /** The current mode. */
  mode: "development" | "production";
  /** The fully resolved framework config. */
  config: ResolvedEvConfig<any>;
}

/**
 * An evjs plugin.
 */
export interface EvPlugin<TBundlerCfg = unknown> {
  /** Plugin name for debugging and logging. */
  name: string;

  /**
   * Initialize the plugin and return lifecycle hooks.
   *
   * Receives the fully resolved config and build context. All returned
   * hooks share state through closure.
   */
  setup?: (
    ctx: EvPluginContext<TBundlerCfg>,
  ) => EvPluginHooks<TBundlerCfg> | undefined | Promise<EvPluginHooks<TBundlerCfg> | undefined>;
}

/**
 * Context passed to plugin setup().
 */
export interface EvPluginContext<TBundlerCfg = unknown> {
  /** Current mode. */
  mode: "development" | "production";
  /** The fully resolved framework config. */
  config: ResolvedEvConfig<TBundlerCfg>;
}

/**
 * Lifecycle hooks returned from plugin setup().
 */
export interface EvPluginHooks<TBundlerCfg = unknown> {
  /** Called before compilation begins. */
  buildStart?: () => void | Promise<void>;

  /**
   * Modify the underlying bundler configuration directly.
   *
   * The config type is `unknown` by default. Use the typed helper exported
   * by each bundler adapter for type safety (e.g., `webpack()` from
   * `@evjs/bundler-webpack`).
   */
  bundlerConfig?: (config: TBundlerCfg, ctx: EvBundlerCtx) => void;

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
    doc: EvDocument,
    result: EvBuildResult,
  ) => void | Promise<void>;
}

/**
 * Build result passed to the buildEnd hook.
 */
export interface EvBuildResult {
  /** The client manifest (assets, routes). */
  clientManifest: ClientManifest;
  /** The server manifest (entry, fns). Undefined if server is disabled. */
  serverManifest?: ServerManifest;
  /** True if this is a rebuild triggered by file change (dev watch mode only). */
  isRebuild: boolean;
}
