/**
 * @evjs/shared — types and utilities shared by @evjs/client and @evjs/server.
 */

export type { Codec } from "./codec.js";
export { jsonCodec } from "./codec.js";
export {
  DEFAULT_CONTENT_TYPE,
  DEFAULT_ENDPOINT,
  DEFAULT_ERROR_STATUS,
} from "./constants.js";
export { ServerError, ServerFunctionError } from "./errors.js";
