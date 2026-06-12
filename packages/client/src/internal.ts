/**
 * Framework-only client runtime APIs used by evjs generated entries.
 *
 * Application code should import page hooks, navigation, transport, and remote
 * helpers from `@evjs/client` instead.
 */

export type { PageRuntimeOptions } from "./page.js";
export { startPageRuntime } from "./page.js";
export type {
  CreatePagesAppOptions,
  PageDefinition,
  PageModule,
  PageProviderProps,
  PagesApp,
  RootLayoutModule,
} from "./page-route.js";
export { createPagesApp, PageProvider } from "./page-route.js";
export type {
  ReactPageMountOptions,
  ReactPageRouteContext,
  ReactPageRuntimeOptions,
  RemoteReactModuleExports,
  RemoteReactProps,
  RemoteRuntimeSharedContext,
} from "./react.js";
export {
  createReactPageModule,
  createRemoteReactModule,
  createRemoteRuntimeContext,
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
  RemoteManifestLoadContext,
  RemoteSharedDependenciesWarning,
  RemoteSharedNegotiationContext,
  RemoteSharedResolution,
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
} from "./transport.js";
