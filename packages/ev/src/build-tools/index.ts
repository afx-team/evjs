/**
 * Bundler-agnostic build utilities for the ev framework.
 */

export type {
  LoadConfigFileOptions,
  TranspileTypeScriptConfigOptions,
} from "./config-module.js";
export { loadConfigFile, transpileTypeScriptConfig } from "./config-module.js";
export type {
  Diagnostic,
  GraphAnalysisResult,
  GraphConfig,
} from "./graph/index.js";
export { createAppGraph } from "./graph/index.js";
export type { GenerateHtmlOptions, HtmlAsset } from "./html.js";
export { generateHtml } from "./html.js";
export type { GeneratePageRouteTypesOptions } from "./page-route-types.js";
export { generatePageRouteTypes } from "./page-route-types.js";
export type {
  DiscoverPageRoutesOptions,
  PageRouteDiscovery,
  PageRouteDiscoveryDiagnostic,
} from "./page-routes.js";
export { discoverPageRoutes } from "./page-routes.js";
export type {
  BuildPlanConfig,
  CreateBuildPlanOptions,
} from "./plan/index.js";
export { createBuildPlan, diffBuildPlan } from "./plan/index.js";
export type { ExtractedRoute } from "./routes.js";
export { resolveRoutes } from "./routes.js";
export type {
  RscReferenceAnalysis,
  TransformRscClientFileOptions,
} from "./rsc-refs.js";
export {
  detectUseClient,
  extractRscReferences,
  transformRscClientFile,
} from "./rsc-refs.js";
export type {
  DiscoverServerConventionsOptions,
  ServerConventionDiagnostic,
  ServerConventionDiscovery,
} from "./server-conventions.js";
export {
  applyRouteScopedMiddlewares,
  discoverServerConventions,
} from "./server-conventions.js";
export { extractServerFunctionExports } from "./server-fns.js";
export type {
  DiscoverServerRoutesOptions,
  ServerRouteDiscovery,
  ServerRouteDiscoveryDiagnostic,
} from "./server-routes.js";
export { discoverServerRoutes } from "./server-routes.js";
export type { TransformResult } from "./transforms/index.js";
export { transformServerFile } from "./transforms/index.js";
export type {
  RouteModuleInfo,
  TransformOptions,
} from "./types.js";
