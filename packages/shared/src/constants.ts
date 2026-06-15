/**
 * Shared constants for the ev runtime.
 */

/** Default framework server base path. */
export const DEFAULT_SERVER_BASE_PATH = "/__evjs";

/** Default server function endpoint path, shared between client and server. */
export const DEFAULT_ENDPOINT = `${DEFAULT_SERVER_BASE_PATH}/fn`;

declare const __EVJS_FUNCTION_ENDPOINT__: string | undefined;
declare const process: {
  env: {
    EVJS_FUNCTION_ENDPOINT?: string;
  };
};

/**
 * Server function endpoint configured by the application build.
 *
 * Bundlers replace `__EVJS_FUNCTION_ENDPOINT__` at build time. When the runtime
 * package is used directly, the undeclared global falls back to the default.
 */
export function getFunctionEndpoint(): string {
  try {
    const processEndpoint = process.env.EVJS_FUNCTION_ENDPOINT;
    if (processEndpoint) return processEndpoint;
  } catch {
    // `process` is not available in some direct browser/edge runtime usage.
  }

  return typeof __EVJS_FUNCTION_ENDPOINT__ === "string" &&
    __EVJS_FUNCTION_ENDPOINT__
    ? __EVJS_FUNCTION_ENDPOINT__
    : DEFAULT_ENDPOINT;
}

/** Default HTTP status code for server function errors. */
export const DEFAULT_ERROR_STATUS = 500;
