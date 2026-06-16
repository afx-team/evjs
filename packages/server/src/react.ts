import {
  assertFrameworkManifestShape,
  type BuildOutput,
  type ServerRendererOutput,
} from "@evjs/shared/manifest";
import {
  createManifestRenderCoordinator,
  type FrameworkServerOptions,
  type ManifestServerModuleLoader,
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
import { textResponse } from "./responses.js";
import { isRecord } from "./validation.js";

export type {
  ReactRscDebugPayload,
  ReactRscFlightAdapterOptions,
  ReactServerRenderAdapterOptions,
} from "./react-renderer.js";
export {
  createReactRscFlightAdapter,
  createReactServerRenderAdapter,
} from "./react-renderer.js";

declare global {
  var __EVJS_MANIFEST__: BuildOutput | undefined;
  var __EVJS_DEV_PAGE_RENDER_PROXY_HEADER__: string | undefined;
  var __EVJS_SERVER_MODULE_LOADER__:
    | ((
        asset: string,
        renderer: ServerRendererOutput,
      ) => Promise<ServerRendererModule>)
    | undefined;
}

export interface ReactFrameworkServerOptions {
  /**
   * Framework manifest to serve. Defaults to the manifest injected by the ev
   * dev/build runtime bootstrap.
   */
  manifest?: BuildOutput;
  /**
   * Server module loader for renderer assets. Defaults to the loader injected by
   * the ev dev/build runtime bootstrap.
   */
  loadModule?: ManifestServerModuleLoader;
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
   * Options passed to the default RSC Flight adapter when the manifest declares
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

  const manifest = options.manifest ?? globalThis.__EVJS_MANIFEST__;
  if (!manifest) return undefined;
  assertReactFrameworkManifest(manifest);

  const hasRenderers = Boolean(manifest.server?.renderers);
  const rsc =
    options.rscCoordinator ?? createDefaultRscCoordinator(manifest, options);
  if (!hasRenderers && !rsc) return undefined;

  return {
    manifest,
    render: hasRenderers
      ? createManifestRenderCoordinator({
          manifest,
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

  assertOptionalObject(value.manifest, "createReactFrameworkServer() manifest");
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

function assertReactFrameworkManifest(
  value: unknown,
): asserts value is BuildOutput {
  assertFrameworkManifestShape(value, "createReactFrameworkServer() manifest");
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
  manifest: BuildOutput,
  options: ReactFrameworkServerOptions,
): FrameworkServerOptions["rsc"] | undefined {
  if (!manifest.runtime.server?.rsc && !manifest.rsc?.endpoint)
    return undefined;
  return createReactRscFlightAdapter({
    loadModule: options.loadModule ?? loadModuleFromRuntimeGlobal,
    ...options.rsc,
  });
}

async function loadModuleFromRuntimeGlobal(
  asset: string,
  renderer: ServerRendererOutput,
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
