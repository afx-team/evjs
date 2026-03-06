/**
 * @evjs/manifest
 *
 * Shared manifest schemas for the ev framework build system.
 *
 * Each environment emits its own manifest file:
 *   - dist/server/manifest.json → ServerManifest
 *   - dist/client/manifest.json → ClientManifest (future)
 */

// ─── Shared ──────────────────────────────────────────────

/** Base manifest fields shared by all environment manifests. */
interface ManifestBase {
  /** Schema version — bump on breaking changes. */
  version: 1;
}

// ─── Server Manifest (dist/server/manifest.json) ─────────

/** A registered server function entry. */
export interface ServerFnEntry {
  /** Webpack module identifier (hash-based, no source paths exposed). */
  moduleId: string;
  /** Exported function name. */
  export: string;
}

/** A React Server Component entry (future — reserved). */
export interface RscEntry {
  /** Webpack module ID. */
  moduleId: string;
  /** Exported component name. */
  export: string;
}

/**
 * Server manifest — emitted to `dist/server/manifest.json`.
 *
 * Contains everything needed to boot and serve the server bundle:
 * entry filename, registered server functions, and future RSC/SSR metadata.
 */
export interface ServerManifest extends ManifestBase {
  /** Server bundle entry filename (e.g. "index.js" or "index.a1b2c3d4.js"). */
  entry: string;
  /** Registered server functions (fnId → module + export). */
  fns: Record<string, ServerFnEntry>;
  /** React Server Components (future — reserved). */
  rsc?: Record<string, RscEntry>;
}

// ─── Client Manifest (dist/client/manifest.json) ─────────

/** Per-page asset entry for MPA support (future — reserved). */
export interface PageEntry {
  /** JavaScript bundle paths for this page. */
  js: string[];
  /** CSS bundle paths for this page. */
  css: string[];
}

/**
 * Client manifest — emitted to `dist/client/manifest.json` (future).
 *
 * Contains everything needed for SSR HTML injection and asset preloading.
 */
export interface ClientManifest extends ManifestBase {
  /** JavaScript bundle paths for HTML injection. */
  js: string[];
  /** CSS bundle paths for HTML injection. */
  css: string[];
  /** Per-page assets for MPA support (future — reserved). */
  pages?: Record<string, PageEntry>;
}

// ─── Legacy alias ────────────────────────────────────────

/**
 * @deprecated Use `ServerManifest` or `ClientManifest` directly.
 * Kept for backward compatibility during migration.
 */
export type EvManifest = ServerManifest;
