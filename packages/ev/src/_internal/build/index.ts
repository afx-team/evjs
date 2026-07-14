/**
 * Bundler-agnostic build utilities for the ev framework.
 */

export type {
  BundlerAdapter,
  BundlerBuildContext,
  BundlerBuildFacts,
  BundlerDevContext,
  BundlerDevController,
} from "./bundler.js";
export {
  type BuildOptions,
  build,
  type DevOptions,
  dev,
  type InspectBuildEntry,
  type InspectDiagnostic,
  type InspectFrameworkBuildOptions,
  type InspectFrameworkBuildResult,
  type InspectHtmlDocument,
  type InspectPageOutput,
  type InspectPageRoute,
  type InspectRouteFile,
  type InspectServerFunction,
  type InspectServerRoute,
  inspectFrameworkBuild,
  type PreparedFrameworkBuild,
  type PrepareFrameworkBuildOptions,
  prepareFrameworkBuild,
} from "./commands.js";
export type {
  LoadConfigFileOptions,
  TranspileTypeScriptConfigOptions,
} from "./config-module.js";
export { loadConfigFile, transpileTypeScriptConfig } from "./config-module.js";
export {
  applyHtmlTagContributions,
  GENERATED_IR_DIR,
  GENERATED_IR_MANIFEST,
  materializeFrameworkIR,
} from "./generated-contributions.js";
export type {
  CreateAppGraphOptions,
  Diagnostic,
  GraphAnalysisResult,
  GraphConfig,
} from "./graph/index.js";
export { createAppGraph } from "./graph/index.js";
export type { GenerateHtmlOptions, HtmlAsset } from "./html.js";
export { generateHtml, validateHtmlTemplate } from "./html.js";
export type { BuildHtmlOptions } from "./html-transform.js";
export { buildHtml } from "./html-transform.js";
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
export { SERVER_FUNCTION_TRANSFORM_RUNTIME } from "./types.js";
