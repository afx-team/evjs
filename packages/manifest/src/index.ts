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
  /** URL prefix for all assets when deployed to CDN. Default: "/". */
  assetPrefix?: string;
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

// ── Route resolution ────────────────────────────────────────────────────

/** Route metadata extracted from a createRoute() call. */
export interface ExtractedRoute {
  /** Route path (e.g. "/", "/posts/$postId"). */
  path: string;
  /** Variable name of the parent route (e.g. "rootRoute", "postsRoute"). */
  parentName?: string;
  /** Variable name this route is assigned to (e.g. "homeRoute"). */
  varName?: string;
}

/**
 * Resolve a flat list of extracted routes into de-duplicated full paths.
 *
 * Builds the parent-child hierarchy using `varName` / `parentName` and
 * walks the tree to construct full URL paths.
 *
 * Index routes (child `path: "/"` under a non-root parent) are excluded
 * since they resolve to the same URL as their parent route.
 *
 * @example
 * ```ts
 * resolveRoutes([
 *   { path: "/posts", varName: "postsRoute", parentName: "rootRoute" },
 *   { path: "/", varName: "postsIndexRoute", parentName: "postsRoute" },
 *   { path: "$postId", varName: "postDetailRoute", parentName: "postsRoute" },
 * ])
 * // => [{ path: "/posts" }, { path: "/posts/$postId" }]
 * ```
 */
export function resolveRoutes(
  routes: ExtractedRoute[],
): Array<{ path: string }> {
  // Build a lookup: varName → ExtractedRoute
  const byName = new Map<string, ExtractedRoute>();
  for (const r of routes) {
    if (r.varName) {
      byName.set(r.varName, r);
    }
  }

  /**
   * Walk up the parent chain to build the full path prefix for a route.
   * Returns the full resolved path of the given route variable.
   */
  function resolveParentPath(
    route: ExtractedRoute,
    visited = new Set<string>(),
  ): string {
    if (!route.parentName) return route.path;

    // Guard against circular parent references
    if (route.varName) {
      if (visited.has(route.varName)) return route.path;
      visited.add(route.varName);
    }

    const parent = byName.get(route.parentName);
    if (!parent) {
      // Parent not in the extracted set (e.g. rootRoute from createRootRoute)
      // — treat as top-level, no prefix.
      return route.path;
    }

    const parentPath = resolveParentPath(parent, visited);
    return joinPaths(parentPath, route.path);
  }

  const seen = new Set<string>();
  const result: Array<{ path: string }> = [];

  for (const r of routes) {
    const fullPath = resolveParentPath(r);

    // Skip index routes that resolve to the same path as their parent.
    // An index route has path "/" and a parent that is not the root.
    if (r.path === "/" && r.parentName) {
      const parent = byName.get(r.parentName);
      if (parent) {
        // This is a non-root index route — it duplicates the parent path.
        continue;
      }
    }

    if (!seen.has(fullPath)) {
      seen.add(fullPath);
      result.push({ path: fullPath });
    }
  }

  return result;
}

/** Join two path segments, normalizing double slashes. */
function joinPaths(parent: string, child: string): string {
  if (child === "/") return parent;
  if (child.startsWith("/")) return child;

  const base = parent.endsWith("/") ? parent : `${parent}/`;
  return base + child;
}

// ── ManifestCollector ───────────────────────────────────────────────────

/**
 * Collects server function registrations, route metadata, and client assets
 * throughout the compilation lifecycle, then produces the final manifests.
 *
 * This class is bundler-agnostic — it is used by bundler adapters
 * (e.g. `@evjs/bundler-webpack`) to accumulate build metadata.
 */
export class ManifestCollector {
  fns: Record<string, ServerFnEntry> = {};
  routes: ExtractedRoute[] = [];
  entry: string | undefined = undefined;
  private jsAssets: string[] = [];
  private cssAssets: string[] = [];

  addServerFn(id: string, meta: ServerFnEntry) {
    this.fns[id] = meta;
  }

  addRoutes(entries: ExtractedRoute[]) {
    this.routes.push(...entries);
  }

  setAssets(js: string[], css: string[]) {
    this.jsAssets = js;
    this.cssAssets = css;
  }

  getJsAssets(): string[] {
    return this.jsAssets;
  }

  getCssAssets(): string[] {
    return this.cssAssets;
  }

  getServerManifest(): ServerManifest {
    return {
      version: 1,
      entry: this.entry,
      fns: this.fns,
    };
  }

  getClientManifest(assetPrefix?: string): ClientManifest {
    return {
      version: 1,
      assetPrefix: assetPrefix && assetPrefix !== "/" ? assetPrefix : undefined,
      assets: { js: this.jsAssets, css: this.cssAssets },
      routes: resolveRoutes(this.routes),
    };
  }
}
