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
  extractClientRoutes,
  extractClientRoutesFromAst,
  extractServerRoutes,
  resolveRoutes,
} from "./routes.js";
export { extractServerFunctionExports } from "./server-fns.js";
export type { TransformResult } from "./transforms/index.js";
export { transformServerFile } from "./transforms/index.js";
export type {
  RouteModuleInfo,
  ServerEntryConfig,
  TransformOptions,
} from "./types.js";
export {
  detectUseServer,
  hashServerFunction,
  makeFnId,
  makeModuleId,
  parseModuleRef,
} from "./utils.js";
