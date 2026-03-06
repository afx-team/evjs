/**
 * Client-side runtime utilities.
 */

// ── TanStack Query Integration ──
export * from "@tanstack/react-query";
export type { App, CreateAppOptions } from "./create-app";
export { createApp } from "./create-app";
export * from "./query";
export * from "./route";
export type { RequestContext, ServerTransport, TransportOptions } from "./transport";
export { configureTransport } from "./transport";
