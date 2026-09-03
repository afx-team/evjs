import { type MiddlewareChain, requestLogger } from "@evjs/ev/middleware";
import responseMetadata from "./response-metadata";

export default [
  requestLogger({ includeSearch: true }),
  responseMetadata,
] satisfies MiddlewareChain;
