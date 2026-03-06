/**
 * @evjs/manifest
 *
 * Shared manifest schema for the ev framework build system.
 * This package defines the structure of `manifest.json` emitted
 * by @evjs/webpack-plugin and consumed by @evjs/runtime.
 */

// ─── Server Functions (Stage 2: AJAX RPC) ────────────────

/** A registered server function entry. */
export interface ServerFnEntry {
  /** Webpack module identifier (hash-based, no source paths exposed). */
  moduleId: string;
  /** Exported function name. */
  export: string;
}

// ─── SSR (Stage 3 — reserved) ────────────────────────────

/** Server-side rendering configuration. */
export interface SsrEntry {
  /** Path to the server entry bundle. */
  serverEntry: string;
  /** Path to the client entry bundle. */
  clientEntry: string;
}

/** Client assets for HTML injection during SSR. */
export interface AssetsEntry {
  /** JavaScript bundle paths. */
  js: string[];
  /** CSS bundle paths. */
  css: string[];
}

// ─── React Server Components (future — reserved) ────────

/** A React Server Component entry. */
export interface RscEntry {
  /** Webpack module ID. */
  moduleId: string;
  /** Exported component name. */
  export: string;
}

/**
 * The ev build manifest.
 *
 * Version 1 supports:
 * - `server.fns`: AJAX RPC server functions.
 * - `server.entry`: Server bundle entry filename.
 *
 * Future versions will add:
 * - `ssr`: Server-side rendering entry points.
 * - `assets`: Client JS/CSS assets for HTML injection.
 * - `serverComponents`: React Server Components.
 */
export interface EvManifest {
  /** Schema version — bump on breaking changes. */
  version: 1;
  /** Server build outputs. */
  server: {
    /** Server function registry (Stage 2). */
    fns: Record<string, ServerFnEntry>;
    /** Server bundle entry filename (e.g. "index.js" or "index.abc123.js"). */
    entry: string;
  };
  /** SSR configuration (Stage 3 — reserved). */
  ssr?: SsrEntry;
  /** Client assets (Stage 3 — reserved). */
  assets?: AssetsEntry;
  /** React Server Components (future — reserved). */
  serverComponents?: Record<string, RscEntry>;
}
