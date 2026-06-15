import type * as Client from "../src/index";

export type PublicPageHookExports = [
  typeof Client.usePageParams,
  typeof Client.usePageSearch,
  typeof Client.usePageLoaderData,
];

export type PublicRemoteExports = [
  typeof Client.RemoteApp,
  typeof Client.useRemoteHost,
  typeof Client.useRemoteContext,
  typeof Client.startRemoteAppRuntime,
  typeof Client.createRemoteAppManifest,
  typeof Client.resolveRemoteAppManifestUrl,
  typeof Client.formatRemoteSharedNegotiation,
  typeof Client.getRemoteSharedVersion,
  Client.RemoteAppActivationRequest,
  Client.RemoteAppContext,
  Client.RemoteAppHookOptions,
  Client.RemoteAppHookResult,
  Client.RemoteAppManifestLoadContext,
  Client.RemoteAppModule,
  Client.RemoteAppProps,
  Client.RemoteAppReactProps,
  Client.RemoteAppRuntimeController,
  Client.RemoteAppRuntimeErrorContext,
  Client.RemoteAppRuntimeHooks,
  Client.RemoteAppRuntimeOptions,
  Client.RemoteAppSharedNegotiation,
  Client.RemoteAppSharedResolution,
  Client.RemoteAppSharedScope,
  Client.RemoteAppSharedScopeEntry,
  Client.RemoteAppState,
  Client.RemoteAppStatus,
  Client.RemoteAppTargetOptions,
  Client.RemoteRuntimeContext,
];

export type PublicRscExports = [
  typeof Client.createReactRscModel,
  typeof Client.fetchRscFlight,
  typeof Client.fetchRscDebugPayload,
  typeof Client.loadRscDebugPage,
  typeof Client.mountRscDebugPayload,
  typeof Client.mountReactRscPage,
  typeof Client.startReactRscPageRuntime,
  typeof Client.unmountReactRscPage,
  Client.RscDebugPayload,
  Client.RscDebugPayloadMountOptions,
  Client.RscFlightFetchOptions,
  Client.ReactRscModelOptions,
  Client.ReactRscMountOptions,
  Client.ReactRscRuntimeBootstrap,
];

// Public page code should use hooks instead of importing framework page props.
// @ts-expect-error PageProps is internal to the framework-managed page runtime.
export type HiddenPageProps = Client.PageProps;

// @ts-expect-error PageComponent is internal to the framework-managed page runtime.
export type HiddenPageComponent = Client.PageComponent;

// @ts-expect-error PageProvider is internal to generated page bootstrap.
export type HiddenPageProvider = typeof Client.PageProvider;

// Router construction stays behind the framework-managed page runtime.
// @ts-expect-error createApp is internal to generated SPA bootstrap.
export type HiddenCreateApp = typeof Client.createApp;

// @ts-expect-error createPagesApp is internal to generated SPA bootstrap.
export type HiddenCreatePagesApp = typeof Client.createPagesApp;

// @ts-expect-error startPageRuntime is internal to generated page bootstrap.
export type HiddenStartPageRuntime = typeof Client.startPageRuntime;

// @ts-expect-error createReactPageModule is internal to generated page bootstrap.
export type HiddenCreateReactPageModule = typeof Client.createReactPageModule;

// @ts-expect-error mountReactPage is internal to generated page bootstrap.
export type HiddenMountReactPage = typeof Client.mountReactPage;

// @ts-expect-error RemoteReactModuleExports is internal to generated remote bootstrap.
export type HiddenRemoteReactModuleExports = Client.RemoteReactModuleExports;

export type HiddenCreateRemoteReactModule =
  // @ts-expect-error createRemoteReactModule is internal to generated remote bootstrap.
  typeof Client.createRemoteReactModule;

export type HiddenCreateRemoteRuntimeContext =
  // @ts-expect-error createRemoteRuntimeContext is internal to generated remote bootstrap.
  typeof Client.createRemoteRuntimeContext;

// @ts-expect-error createShell is internal to generated shell bootstrap.
export type HiddenCreateShell = typeof Client.createShell;

// @ts-expect-error registerShellModule is internal to generated shell bootstrap.
export type HiddenRegisterShellModule = typeof Client.registerShellModule;

export type HiddenRegisterSharedDependency =
  // @ts-expect-error registerSharedDependency is internal to generated shell bootstrap.
  typeof Client.registerSharedDependency;

// @ts-expect-error loadSharedDependency is internal to generated shell bootstrap.
export type HiddenLoadSharedDependency = typeof Client.loadSharedDependency;

// @ts-expect-error createServerReference is internal to generated server-function stubs.
export type HiddenCreateServerReference = typeof Client.createServerReference;

// @ts-expect-error callServer is internal to generated server-function stubs.
export type HiddenCallServer = typeof Client.callServer;

export type HiddenInitTransportFromManifest =
  // @ts-expect-error initTransportFromManifest is internal to generated bootstrap.
  typeof Client.initTransportFromManifest;

export type HiddenGetRscFetchResponseContentType =
  // @ts-expect-error getRscFetchResponseContentType is an internal runtime helper.
  typeof Client.getRscFetchResponseContentType;

// @ts-expect-error createRoute is internal to generated SPA routing.
export type HiddenCreateRoute = typeof Client.createRoute;

// @ts-expect-error createRouter is internal to generated SPA routing.
export type HiddenCreateRouter = typeof Client.createRouter;

// @ts-expect-error createRootRoute is internal to generated SPA routing.
export type HiddenCreateRootRoute = typeof Client.createRootRoute;

// @ts-expect-error createAppRootRoute is internal to generated SPA routing.
export type HiddenCreateAppRootRoute = typeof Client.createAppRootRoute;

// @ts-expect-error RegisteredRouter is a router implementation detail.
export type HiddenRegisteredRouter = Client.RegisteredRouter;

// @ts-expect-error AnyRouter is a router implementation detail.
export type HiddenAnyRouter = Client.AnyRouter;

// @ts-expect-error FileRoute is a router implementation detail.
export type HiddenFileRoute = Client.FileRoute;

// @ts-expect-error Outlet is internal to the framework-owned route tree.
export type HiddenOutlet = typeof Client.Outlet;

// @ts-expect-error useParams is replaced by usePageParams for page code.
export type HiddenUseParams = typeof Client.useParams;

// @ts-expect-error useSearch is replaced by usePageSearch for page code.
export type HiddenUseSearch = typeof Client.useSearch;
