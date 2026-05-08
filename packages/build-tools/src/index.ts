/**
 * Bundler-agnostic build utilities for the ev framework.
 */

export type { GenerateHtmlOptions, HtmlAsset } from "./html.js";
export { generateHtml } from "./html.js";
export type {
  ExtractedRoute,
  ExtractedServerRoute,
  RouteAnalysis,
} from "./routes.js";
export {
  analyzeRoutes,
  detectServerRouteExports,
  extractRoutes,
  extractServerRoutes,
  resolveRoutes,
} from "./routes.js";
export type { TransformResult } from "./transforms/index.js";
export { transformServerFile } from "./transforms/index.js";
export type {
  RouteModuleInfo,
  ServerEntryConfig,
  TransformOptions,
} from "./types.js";
export {
  detectUseServer,
  hashString,
  makeFnId,
  makeModuleId,
  parseModuleRef,
} from "./utils.js";
