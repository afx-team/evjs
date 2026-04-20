/**
 * Minimal server function registry.
 *
 * This module is intentionally decoupled from the framework runtime
 * (Hono, server function handler, etc.) so that the server bundle only contains
 * user-defined functions + this tiny registry.
 *
 * The framework runtime imports FROM this module to read the registry.
 */

/** A registered server function. */
export type ServerFn = (...args: unknown[]) => Promise<unknown>;

/** Internal registry mapping function IDs to implementations. */
export const registry = new Map<string, ServerFn>();

/**
 * Register a server function so it can be invoked via the transport.
 * Called automatically by the build-tools-transformed server bundles at load time.
 *
 * Follows the React Server Components convention (fn first, id second).
 *
 * @param fn - The actual function implementation.
 * @param fnId - The unique ID for this function.
 * @param _exportName - The export name (reserved for future use).
 */
export function registerServerReference(
  fn: ServerFn,
  fnId: string,
  _exportName?: string,
): void {
  registry.set(fnId, fn);
}

/**
 * Reset the server function registry. **Test-only** — not available in production builds.
 * @internal
 */
export function __resetForTesting(): void {
  registry.clear();
}
