/**
 * @evjs/shared — types and utilities shared by @evjs/client and @evjs/server.
 */

export {
  DEFAULT_ENDPOINT,
  DEFAULT_ERROR_STATUS,
} from "./constants.js";
export { ServerError, ServerFunctionError } from "./errors.js";
export type { HttpMethod } from "./http.js";
export { HTTP_METHODS, isHttpMethod } from "./http.js";
