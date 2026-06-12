import type { BuildOutput, ServerRendererOutput } from "@evjs/shared/manifest";
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
  const manifest = options.manifest ?? globalThis.__EVJS_MANIFEST__;
  if (!manifest) return undefined;

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
      return new Response(
        "[evjs] Server renderer module loader is not configured.",
        { status: 501 },
      );
    },
  };
}
