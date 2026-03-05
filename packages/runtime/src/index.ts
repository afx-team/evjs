/**
 * @evjs/runtime
 *
 * Core runtime for the ev framework, providing isomorphic utilities
 * for client-side routing, state management, and server-side RPC handling.
 */

// biome-ignore lint/performance/noBarrelFile: This is a library entry point
export * as client from "./client/index";
export * as server from "./server/index";
