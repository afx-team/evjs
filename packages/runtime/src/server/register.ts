/**
 * Minimal server function registry.
 *
 * This module is intentionally decoupled from the framework runtime
 * (Hono, RPC handler, etc.) so that the server bundle only contains
 * user-defined functions + this tiny registry.
 *
 * The framework runtime imports FROM this module to read the registry.
 */

/** A registered server function. */
export type ServerFn = (...args: unknown[]) => Promise<unknown>;

/** Internal registry mapping function IDs to implementations. */
export const registry = new Map<string, ServerFn>();

/**
 * Register a server function so it can be invoked via RPC.
 * Called automatically by the build-tools-transformed server bundles at load time.
 *
 * @param fnId - The unique ID for this function.
 * @param fn - The actual function implementation.
 */
export function registerServerFn(fnId: string, fn: ServerFn): void {
  registry.set(fnId, fn);
}
