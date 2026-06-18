export {
  createHistoryDriver,
  createPageDriver,
} from "./shell/drivers.js";
export {
  loadSharedDependency,
  registerSharedDependency,
  registerShellModule,
} from "./shell/registry.js";
export { createActivationRequestFromUrl } from "./shell/routing.js";
export { createShell } from "./shell/runtime.js";
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
} from "./shell/types.js";
