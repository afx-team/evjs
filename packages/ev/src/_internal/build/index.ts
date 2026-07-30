/**
 * Bundler-agnostic build utilities for the ev framework.
 */

export { resolveBuildOutputPaths } from "./build-output-paths.js";
export {
  type BundlerAdapter,
  type BundlerBuildCapability,
  type BundlerBuildContext,
  type BundlerBuildFacts,
  type BundlerCapabilities,
  type BundlerCapability,
  type BundlerCapabilityGap,
  type BundlerDevCapability,
  type BundlerDevContext,
  type BundlerDevController,
  type BundlerDevUpdateOptions,
  type BundlerEmittedFiles,
  hasServerGeneratedRuntimeChange,
  isArtifactOnlyBuildPlanUpdate,
  isEmptyBuildPlanUpdate,
  resolveBundlerClientEntryAssets,
} from "./bundler.js";
export { assertBundlerEmittedFiles } from "./bundler-output-files.js";
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
  type InspectPageRoute,
  type InspectRouteFile,
  inspectFrameworkBuild,
  type PreparedFrameworkBuild,
  type PrepareFrameworkBuildOptions,
  prepareFrameworkBuild,
} from "./commands.js";
export type { LoadConfigFileOptions } from "./config-module.js";
export { loadConfigFile } from "./config-module.js";
export {
  applyHtmlTagContributions,
  GENERATED_IR_DIR,
  GENERATED_IR_MANIFEST,
  materializeFrameworkIR,
} from "./generated-contributions.js";
export type {
  CreateCoreGraphOptions,
  Diagnostic,
  GraphAnalysisResult,
  GraphConfig,
} from "./graph/index.js";
export { createCoreGraph } from "./graph/index.js";
export type { GenerateHtmlOptions, HtmlAsset } from "./html.js";
export { generateHtml, validateHtmlTemplate } from "./html.js";
export type { BuildHtmlOptions } from "./html-transform.js";
export { buildHtml } from "./html-transform.js";
export type { ResolvedBuildOutputPaths } from "./output-path-safety.js";
export {
  assertSafeBuildOutputPaths,
  assertSafeBuildOwnedOutputPath,
  assertSafeBundlerCleanOutputPath,
} from "./output-path-safety.js";
export {
  removeOwnedOutputFile,
  writeOwnedOutputFile,
} from "./owned-file-output.js";
export type { GeneratePageRouteTypesOptions } from "./page-route-types.js";
export { generatePageRouteTypes } from "./page-route-types.js";
export type {
  DiscoverPageRoutesOptions,
  PageComponentExportAnalysis,
  PageComponentExportKind,
  PageRouteDiscovery,
  PageRouteDiscoveryDiagnostic,
} from "./page-routes.js";
export {
  analyzePageComponentExports,
  discoverPageRoutes,
} from "./page-routes.js";
export type {
  BuildPlanConfig,
  CreateBuildPlanOptions,
} from "./plan/index.js";
export { createBuildPlan, diffBuildPlan } from "./plan/index.js";
export {
  assertPortableRelativeArtifactPath,
  assertPortableRelativeBrowserArtifactPath,
  canonicalPortableArtifactPathKey,
  portableArtifactPathsConflict,
} from "./portable-artifact-path.js";
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
