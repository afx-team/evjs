/**
 * Router-free React page runtime used by framework-generated MPA and remote
 * entries.
 */

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
export { registerShellModule } from "./shell.js";
