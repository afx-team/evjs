import type { ClientRuntimeTransport } from "../shared/runtime-config.js";

export type ApiMethod =
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "head"
  | "options";

/** A shared DTO can be supplied as json; validation remains server-owned. */
export type ApiRequestOptions = Omit<RequestInit, "method" | "body"> &
  ({ json: unknown; body?: never } | { json?: never; body?: BodyInit | null });

/** Awaiting the call preserves native Fetch response and body semantics. */
export interface ApiCall extends Promise<Response> {
  /** T describes the JSON wire value; this does not validate the response. */
  json<T = unknown>(): Promise<T>;
}

export type ApiClient = Readonly<
  Record<ApiMethod, (path: string, options?: ApiRequestOptions) => ApiCall>
>;

export interface ApiClientOptions extends ClientRuntimeTransport {
  fetch?: typeof globalThis.fetch;
}
