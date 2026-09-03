import { type MiddlewareChain, requestLogger } from "@evjs/ev/api";
import responseMetadata from "./response-metadata";

export default [
  requestLogger({ includeSearch: true }),
  responseMetadata,
] satisfies MiddlewareChain;
