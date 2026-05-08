/**
 * Shared constants for the ev runtime.
 */

/** Default server function endpoint path, shared between client and server. */
export const DEFAULT_ENDPOINT = "/api/fn";

declare const __EVJS_FUNCTION_ENDPOINT__: string | undefined;

/**
 * Server function endpoint configured by the application build.
 *
 * Bundlers replace `__EVJS_FUNCTION_ENDPOINT__` at build time. When the runtime
 * package is used directly, the undeclared global falls back to the default.
 */
export function getFunctionEndpoint(): string {
  return typeof __EVJS_FUNCTION_ENDPOINT__ === "string" &&
    __EVJS_FUNCTION_ENDPOINT__
    ? __EVJS_FUNCTION_ENDPOINT__
    : DEFAULT_ENDPOINT;
}

/** Default HTTP status code for server function errors. */
export const DEFAULT_ERROR_STATUS = 500;
