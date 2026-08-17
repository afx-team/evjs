import { type MiddlewareChain, requestLogger } from "@evjs/ev/server-context";
import responseMetadata from "./response-metadata";

export default [
  requestLogger({ includeSearch: true }),
  responseMetadata,
] satisfies MiddlewareChain;
