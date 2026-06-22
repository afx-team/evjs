/**
 * Framework-only client runtime APIs used by evjs generated entries.
 *
 * Application code should import page hooks, navigation, and transport helpers
 * from `@evjs/client` instead.
 */

export type { PageRuntimeOptions } from "./page.js";
export { startPageRuntime } from "./page.js";
export type { PageProviderProps } from "./page-context.js";
export { PageProvider } from "./page-context.js";
export type {
  CreatePagesAppOptions,
  PageDefinition,
  PageModule,
  PagesApp,
  RootLayoutModule,
} from "./page-route.js";
export { createPagesApp } from "./page-route.js";
export type {
  ReactPageMountOptions,
  ReactPageRouteContext,
  ReactPageRuntimeOptions,
} from "./react.js";
export {
  createReactPageModule,
  mountReactPage,
} from "./react.js";
export type {
  ActivationRequest,
  AppContext,
  AppModule,
  HistoryDriver,
  HistoryDriverOptions,
  PageDriver,
  PageDriverOptions,
  SharedScope,
  SharedScopeEntry,
  Shell,
  ShellDriver,
  ShellErrorContext,
  ShellModuleRegistration,
  ShellOptions,
  ShellWarningContext,
} from "./shell.js";
export {
  createActivationRequestFromUrl,
  createHistoryDriver,
  createPageDriver,
  createShell,
  loadSharedDependency,
  registerSharedDependency,
  registerShellModule,
} from "./shell.js";
export {
  callServer,
  createServerReference,
  getFnId,
  getFnName,
  initTransportFromManifest,
} from "./transport-runtime.js";
