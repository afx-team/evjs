/** Browser-safe framework entry; config and deployment code stay in Node. */

export type {
  ApiCall,
  ApiClient,
  ApiRequestOptions,
} from "@evjs/client/http-api";
export { ApiError } from "@evjs/client/http-api";
export { api } from "@evjs/ev/_internal/client/api";
