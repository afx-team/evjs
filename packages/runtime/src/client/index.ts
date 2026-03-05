/**
 * Client-side runtime utilities.
 */

// ── TanStack Query Integration ──
// biome-ignore lint/performance/noBarrelFile: This is a library entry point
export * from "@tanstack/react-query";
export type { App, CreateAppOptions } from "./create-app";
export { createApp } from "./create-app";
export * from "./query";
export * from "./route";
export type { RpcOptions } from "./rpc";
export { __ev_rpc, configureRpc } from "./rpc";
