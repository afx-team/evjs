/**
 * @evjs/ev — minimal config authoring entry for evjs.
 */

export type {
  ApiCall,
  ApiClient,
  ApiRequestOptions,
} from "@evjs/client/http-api";
export { ApiError } from "@evjs/client/http-api";
export { api } from "./_internal/generated/client/api.js";
export type {
  Config,
  PageFileConfig,
  PageMetadata,
} from "./config/index.js";
export { defineConfig, definePageConfig } from "./config/index.js";
