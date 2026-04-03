/**
 * @evjs/manifest
 *
 * Shared manifest schemas for the ev framework build system.
 *
 * Two separate manifests are emitted during fullstack builds:
 *   - `dist/server/manifest.json` — server build metadata
 *   - `dist/client/manifest.json` — client build metadata
 *
 * For CSR-only builds (`server: false`), only the client manifest
 * is emitted to `dist/manifest.json` (flat output).
 */

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
 * Contains server bundle entry, registered server functions, and RSC metadata.
 */
export interface ServerManifest {
  /** Schema version — bump on breaking changes. */
  version: 1;
  /** Server bundle entry filename (e.g. "main.js" or "main.a1b2c3d4.js"). Omitted when no server bundle exists. */
  entry?: string;
  /** Registered server functions (fnId → module + export). */
  fns: Record<string, ServerFnEntry>;
  /** React Server Components (future — reserved). */
  rsc?: Record<string, RscEntry>;
}

/** A discovered client route. */
export interface RouteEntry {
  /** Route path (e.g. "/", "/posts/$postId", "*"). */
  path: string;
}

/**
 * Client manifest — emitted to `dist/client/manifest.json` (fullstack)
 * or `dist/manifest.json` (CSR-only, `server: false`).
 *
 * Contains client bundle assets and discovered routes.
 */
export interface ClientManifest {
  /** Schema version — bump on breaking changes. */
  version: 1;
  /** Bundle asset paths for HTML injection. */
  assets: {
    /** JavaScript bundle paths. */
    js: string[];
    /** CSS bundle paths. */
    css: string[];
  };
  /** Discovered client routes. */
  routes?: RouteEntry[];
}
