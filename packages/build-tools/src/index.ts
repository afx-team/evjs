/**
 * Bundler-agnostic build utilities for the ev framework.
 */

export { generateServerEntry } from "./entry.js";
export type { GenerateHtmlOptions, HtmlAsset } from "./html.js";
export { generateHtml } from "./html.js";
export type { ExtractedRoute } from "./routes.js";
export { extractRoutes, resolveRoutes } from "./routes.js";
export type { TransformResult } from "./transforms/index.js";
export { transformServerFile } from "./transforms/index.js";
export type { ServerEntryConfig, TransformOptions } from "./types.js";
export {
  detectUseServer,
  hashString,
  makeFnId,
  makeModuleId,
  parseModuleRef,
} from "./utils.js";
