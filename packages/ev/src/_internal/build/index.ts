/**
 * Bundler-agnostic build utilities for the ev framework.
 */

export type {
  RscReferenceAnalysis,
  TransformRscClientFileOptions,
} from "./analysis/rsc-refs.js";
export {
  detectUseClient,
  extractRscReferences,
  transformRscClientFile,
} from "./analysis/rsc-refs.js";
export { extractServerFunctionExports } from "./analysis/server-fns.js";
export {
  CLIENT_TARGET_MINIMUM,
  createClientBrowserslistTarget,
} from "./bundler/client-compatibility.js";
export {
  type BundlerAdapter,
  type BundlerBuildCapability,
  type BundlerBuildContext,
  type BundlerBuildFacts,
  type BundlerBuildFactsDisposition,
  type BundlerCapabilities,
  type BundlerCapability,
  type BundlerCapabilityGap,
  type BundlerDevContext,
  type BundlerDevController,
  type BundlerEmittedFiles,
  preflightBundlerDev,
  resolveBundlerClientEntryAssets,
  resolveBundlerServerEntryAssets,
} from "./bundler/contracts.js";
export { assertBundlerEmittedFiles } from "./bundler/output-files.js";
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
export type { LoadConfigFileOptions } from "./config-loading/config-module.js";
export { loadConfigFile } from "./config-loading/config-module.js";
export {
  type ClientDevMiddlewareCertificateFactory,
  type ClientDevMiddlewareHttpsConfig,
  type ClientDevMiddlewareServerHandle,
  type ClientDevMiddlewareTlsCredentials,
  reserveClientDevMiddlewareUpstreamPort,
  resolveClientDevMiddlewareTlsCredentials,
  type StartClientDevMiddlewareServerOptions,
  startClientDevMiddlewareServer,
} from "./dev/client-middleware-server.js";
export type {
  DiscoverPageRoutesOptions,
  PageComponentExportAnalysis,
  PageComponentExportKind,
  PageRouteDiscovery,
  PageRouteDiscoveryDiagnostic,
} from "./discovery/page-routes.js";
export {
  analyzePageComponentExports,
  discoverPageRoutes,
} from "./discovery/page-routes.js";
export type {
  DiscoverServerConventionsOptions,
  ServerConventionDiagnostic,
  ServerConventionDiscovery,
} from "./discovery/server-conventions.js";
export { discoverServerConventions } from "./discovery/server-conventions.js";
export type {
  DiscoverServerRoutesOptions,
  ServerRouteDiscovery,
  ServerRouteDiscoveryDiagnostic,
} from "./discovery/server-routes.js";
export { discoverServerRoutes } from "./discovery/server-routes.js";
export type {
  GeneratedIRImage,
  GeneratedIRImageFile,
  PreparedFrameworkIR,
  PrepareFrameworkIROptions,
} from "./generated-ir/generated-contributions.js";
export {
  applyHtmlTagContributions,
  GENERATED_IR_DIR,
  GENERATED_IR_MANIFEST,
  materializeFrameworkIR,
  prepareFrameworkIR,
  publishFrameworkIR,
} from "./generated-ir/generated-contributions.js";
export type {
  CreateCoreGraphOptions,
  Diagnostic,
  GraphAnalysisResult,
  GraphConfig,
} from "./graph/index.js";
export { createCoreGraph } from "./graph/index.js";
export { resolveBuildOutputPaths } from "./output/build-output-paths.js";
export type { GenerateHtmlOptions, HtmlAsset } from "./output/html/html.js";
export { generateHtml, validateHtmlTemplate } from "./output/html/html.js";
export type { BuildHtmlOptions } from "./output/html/html-transform.js";
export { buildHtml } from "./output/html/html-transform.js";
export type { ResolvedBuildOutputPaths } from "./output/output-path-safety.js";
export {
  assertSafeBuildOutputPaths,
  assertSafeBuildOwnedOutputPath,
  assertSafeBundlerCleanOutputPath,
} from "./output/output-path-safety.js";
export {
  removeOwnedOutputFile,
  writeOwnedOutputFile,
} from "./output/owned-file-output.js";
export {
  assertPortableRelativeArtifactPath,
  assertPortableRelativeBrowserArtifactPath,
  canonicalPortableArtifactPathKey,
  portableArtifactPathsConflict,
} from "./output/portable-artifact-path.js";
export type {
  BuildPlanConfig,
  CreateBuildPlanOptions,
} from "./plan/index.js";
export { createBuildPlan, diffBuildPlan } from "./plan/index.js";
export { createPluginConfigView } from "./plugins/lifecycle.js";
export type {
  PluginSettingsRegistry,
  PluginSettingsResolutionSession,
  ResolvedPluginSettingsState,
} from "./plugins/settings.js";
export {
  applyPluginSettings,
  collectPluginSettingsRegistry,
  createPluginSettingsResolutionSession,
  resolvePluginSettingsState,
} from "./plugins/settings.js";
export type { TransformResult } from "./transforms/index.js";
export { transformServerFile } from "./transforms/index.js";
export type { GeneratePageRouteTypesOptions } from "./typegen/page-route-types.js";
export { generatePageRouteTypes } from "./typegen/page-route-types.js";
export type {
  GeneratePluginTypesOptions,
  SyncPluginTypesOptions,
} from "./typegen/plugin-types.js";
export {
  generatePluginTypes,
  syncPluginTypes,
} from "./typegen/plugin-types.js";
export type {
  RouteModuleInfo,
  TransformOptions,
} from "./types.js";
export { SERVER_FUNCTION_TRANSFORM_RUNTIME } from "./types.js";
