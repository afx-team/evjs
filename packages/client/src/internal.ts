/**
 * Framework-only client runtime APIs used by evjs generated entries.
 *
 * Application code should import page hooks, navigation, and transport helpers
 * from `@evjs/client` instead.
 */

export type { PageRuntimeOptions } from "./framework/page/page.js";
export { startPageRuntime } from "./framework/page/page.js";
export type { PageProviderProps } from "./framework/page/page-context.js";
export { PageProvider } from "./framework/page/page-context.js";
export type {
  CreatePagesAppOptions,
  PageDefinition,
  PageModule,
  PagesApp,
  RootLayoutModule,
} from "./framework/page/page-route.js";
export { createPagesApp } from "./framework/page/page-route.js";
export type {
  ActivationRequest,
  AppContext,
  AppModule,
  HistoryDriver,
  HistoryDriverOptions,
  PageDriver,
  PageDriverOptions,
  Shell,
  ShellDriver,
  ShellErrorContext,
  ShellModuleRegistration,
  ShellOptions,
  ShellWarningContext,
} from "./framework/shell/index.js";
export {
  createActivationRequestFromUrl,
  createHistoryDriver,
  createPageDriver,
  createShell,
  registerShellModule,
} from "./framework/shell/index.js";
export type {
  ReactPageMountOptions,
  ReactPageRouteContext,
  ReactPageRuntimeOptions,
} from "./rsc/react.js";
export {
  createReactPageModule,
  mountReactPage,
} from "./rsc/react.js";
export {
  callServer,
  createServerReference,
  getFnId,
  getFnName,
  initTransportFromRuntime,
} from "./server-functions/transport-runtime.js";
