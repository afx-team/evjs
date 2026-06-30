import { textResponse } from "../shared/responses.js";
import { isRecord } from "../shared/validation.js";
import {
  assertFrameworkRuntime,
  createFrameworkRenderCoordinator,
  type FrameworkRuntime,
  type FrameworkServerModuleLoader,
  type FrameworkServerOptions,
  type FrameworkServerRenderer,
  type ServerModuleRenderHandler,
  type ServerRenderCoordinator,
  type ServerRendererModule,
  type ServerRenderHandler,
} from "./framework.js";
import {
  createReactRscFlightAdapter,
  createReactServerRenderAdapter,
  type ReactRscFlightAdapterOptions,
  type ReactServerRenderAdapterOptions,
} from "./react-renderer.js";

export type {
  PageProviderProps,
  ReactRscDebugPayload,
  ReactRscFlightAdapterOptions,
  ReactServerRenderAdapterOptions,
} from "./react-renderer.js";
export {
  createReactRscFlightAdapter,
  createReactServerRenderAdapter,
} from "./react-renderer.js";

declare global {
  var __EVJS_FRAMEWORK_RUNTIME__: FrameworkRuntime | undefined;
  var __EVJS_DEV_PAGE_RENDER_PROXY_HEADER__: string | undefined;
  var __EVJS_SERVER_MODULE_LOADER__:
    | ((
        asset: string,
        renderer: FrameworkServerRenderer,
      ) => Promise<ServerRendererModule>)
    | undefined;
}

export interface ReactFrameworkServerOptions {
  /**
   * Framework runtime metadata. Defaults to the runtime injected by the ev
   * dev/build runtime bootstrap.
   */
  runtime?: FrameworkRuntime;
  /**
   * Server module loader for renderer assets. Defaults to the loader injected by
   * the ev dev/build runtime bootstrap.
   */
  loadModule?: FrameworkServerModuleLoader;
  /**
   * Override the module renderer. By default, evjs renders default-exported
   * React components with the built-in server React renderer.
   */
  renderModule?: ServerModuleRenderHandler;
  /**
   * Options passed to the default React server render adapter.
   */
  react?: ReactServerRenderAdapterOptions;
  /**
   * Options passed to the default RSC Flight adapter when the runtime declares
   * an RSC endpoint and no custom `rscCoordinator` is provided.
   */
  rsc?: ReactRscFlightAdapterOptions;
  /**
   * Fallback render handler used when no framework renderer matches a request.
   */
  fallback?: ServerRenderHandler | ServerRenderCoordinator;
  /**
   * Advanced RSC Flight coordinator override. Most apps should use `rsc`
   * instead; this replaces the default React RSC adapter entirely.
   */
  rscCoordinator?: FrameworkServerOptions["rsc"];
}

export function createReactFrameworkServer(
  options: ReactFrameworkServerOptions = {},
): FrameworkServerOptions | undefined {
  assertReactFrameworkServerOptions(options);

  const runtime = options.runtime ?? globalThis.__EVJS_FRAMEWORK_RUNTIME__;
  if (!runtime) return undefined;

  const hasRenderers = Boolean(runtime.server.renderers);
  const rsc =
    options.rscCoordinator ?? createDefaultRscCoordinator(runtime, options);
  if (!hasRenderers && !rsc) return undefined;

  return {
    runtime,
    render: hasRenderers
      ? createFrameworkRenderCoordinator({
          runtime,
          loadModule: options.loadModule ?? loadModuleFromRuntimeGlobal,
          renderModule:
            options.renderModule ??
            createReactServerRenderAdapter(options.react),
          fallback: options.fallback,
        })
      : undefined,
    allowPageRenderRequest: createDevPageRenderGuard(),
    rsc,
  };
}

function assertReactFrameworkServerOptions(
  value: unknown,
): asserts value is ReactFrameworkServerOptions {
  if (!isRecord(value)) {
    throw new Error(
      "[evjs] createReactFrameworkServer() options must be an object.",
    );
  }

  if (value.runtime !== undefined) {
    assertFrameworkRuntime(
      value.runtime,
      "createReactFrameworkServer() runtime",
    );
  }
  assertOptionalFunction(
    value.loadModule,
    "createReactFrameworkServer() loadModule",
  );
  assertOptionalFunction(
    value.renderModule,
    "createReactFrameworkServer() renderModule",
  );
  assertOptionalObject(value.react, "createReactFrameworkServer() react");
  assertOptionalObject(value.rsc, "createReactFrameworkServer() rsc");
  assertOptionalRenderCoordinator(
    value.fallback,
    "createReactFrameworkServer() fallback",
  );
  assertOptionalRscCoordinator(
    value.rscCoordinator,
    "createReactFrameworkServer() rscCoordinator",
  );
}

function assertOptionalObject(value: unknown, source: string): void {
  if (value !== undefined && !isRecord(value)) {
    throw new Error(`[evjs] ${source} must be an object.`);
  }
}

function assertOptionalFunction(value: unknown, source: string): void {
  if (value !== undefined && typeof value !== "function") {
    throw new Error(`[evjs] ${source} must be a function.`);
  }
}

function assertOptionalRenderCoordinator(value: unknown, source: string): void {
  if (value === undefined || typeof value === "function") return;
  if (isRecord(value) && typeof value.render === "function") return;
  throw new Error(
    `[evjs] ${source} must be a render function or coordinator object.`,
  );
}

function assertOptionalRscCoordinator(value: unknown, source: string): void {
  if (value === undefined || typeof value === "function") return;
  if (isRecord(value) && typeof value.renderFlight === "function") return;
  throw new Error(
    `[evjs] ${source} must be an RSC Flight function or coordinator object.`,
  );
}

function createDevPageRenderGuard():
  | FrameworkServerOptions["allowPageRenderRequest"]
  | undefined {
  const headerName = globalThis.__EVJS_DEV_PAGE_RENDER_PROXY_HEADER__;
  if (!headerName) return undefined;

  return (request) => request.headers.get(headerName) === "1";
}

function createDefaultRscCoordinator(
  runtime: FrameworkRuntime,
  options: ReactFrameworkServerOptions,
): FrameworkServerOptions["rsc"] | undefined {
  if (!runtime.runtime.server.rsc) return undefined;
  return createReactRscFlightAdapter({
    loadModule: options.loadModule ?? loadModuleFromRuntimeGlobal,
    ...options.rsc,
  });
}

async function loadModuleFromRuntimeGlobal(
  asset: string,
  renderer: FrameworkServerRenderer,
): Promise<ServerRendererModule> {
  const loader = globalThis.__EVJS_SERVER_MODULE_LOADER__;
  if (loader) return loader(asset, renderer);

  return {
    render() {
      return textResponse(
        "[evjs] Server renderer module loader is not configured.",
        501,
      );
    },
  };
}
