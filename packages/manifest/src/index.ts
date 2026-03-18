/**
 * @evjs/manifest
 *
 * Shared manifest schemas for the ev framework build system.
 *
 * A single unified manifest is emitted to `dist/manifest.json`,
 * containing both server and client build metadata.
 */

/** Base manifest fields shared by all environment manifests. */
interface ManifestBase {
  /** Schema version — bump on breaking changes. */
  version: 1;
}

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

/** Server section of the manifest. */
export interface ServerManifestSection {
  /** Server bundle entry filename (e.g. "main.js" or "main.a1b2c3d4.js"). */
  entry: string;
  /** Registered server functions (fnId → module + export). */
  fns: Record<string, ServerFnEntry>;
  /** React Server Components (future — reserved). */
  rsc?: Record<string, RscEntry>;
}

/** Per-page asset entry for MPA support (future — reserved). */
export interface PageEntry {
  /** JavaScript bundle paths for this page. */
  js: string[];
  /** CSS bundle paths for this page. */
  css: string[];
}

/** Client section of the manifest. */
export interface ClientManifestSection {
  /** JavaScript bundle paths for HTML injection. */
  js: string[];
  /** CSS bundle paths for HTML injection. */
  css: string[];
  /** Per-page assets for MPA support (future — reserved). */
  pages?: Record<string, PageEntry>;
}

/**
 * Unified manifest — emitted to `dist/manifest.json`.
 *
 * Contains both server and client build metadata in a single file.
 */
export interface Manifest extends ManifestBase {
  /** Server build metadata (entry, server functions, RSC). */
  server: ServerManifestSection;
  /** Client build metadata (bundles, CSS, pages). Optional until client manifest is implemented. */
  client?: ClientManifestSection;
}

/**
 * @deprecated Use `Manifest` instead. Kept for backward compatibility.
 */
export type ServerManifest = ManifestBase & ServerManifestSection;

/**
 * @deprecated Use `Manifest` instead. Kept for backward compatibility.
 */
export type ClientManifest = ManifestBase & ClientManifestSection;
