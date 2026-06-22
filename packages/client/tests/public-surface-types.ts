import type * as Client from "../src/index";
import type * as ClientTransport from "../src/transport";

export type PublicPageHookExports = [
  typeof Client.usePageParams,
  typeof Client.usePageSearch,
  typeof Client.usePageLoaderData,
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

export type PublicStandaloneCsrExports = [
  typeof Client.createApp,
  Client.App<unknown>,
  Client.CreateAppOptions<Client.AnyRoute>,
  Client.CreateAppRouterOptions<Client.AnyRoute>,
  Client.AppRouteContext,
  typeof Client.createAppRootRoute,
  typeof Client.createRoute,
  typeof Client.createRouter,
  typeof Client.createRootRoute,
  typeof Client.createRootRouteWithContext,
  Client.RegisteredRouter,
  Client.AnyRouter,
  typeof Client.Outlet,
  typeof Client.RouterProvider,
  typeof Client.useParams,
  typeof Client.useSearch,
  typeof Client.useRouter,
];

export type PublicTransportSubpathExports = [
  typeof ClientTransport.createServerReference,
  typeof ClientTransport.getFnId,
  typeof ClientTransport.getFnName,
  typeof ClientTransport.initTransport,
  ClientTransport.HeaderFactory,
  ClientTransport.RequestContext,
  ClientTransport.ServerFunction,
  ClientTransport.TransportAdapter,
  ClientTransport.TransportOptions,
];

// Public page code should use hooks instead of importing framework page props.
// @ts-expect-error PageProps is internal to the framework-managed page runtime.
export type HiddenPageProps = Client.PageProps;

// @ts-expect-error PageComponent is internal to the framework-managed page runtime.
export type HiddenPageComponent = Client.PageComponent;

// @ts-expect-error PageProvider is internal to generated page bootstrap.
export type HiddenPageProvider = typeof Client.PageProvider;

// @ts-expect-error createPagesApp is internal to generated SPA bootstrap.
export type HiddenCreatePagesApp = typeof Client.createPagesApp;

// @ts-expect-error startPageRuntime is internal to generated page bootstrap.
export type HiddenStartPageRuntime = typeof Client.startPageRuntime;

// @ts-expect-error createReactPageModule is internal to generated page bootstrap.
export type HiddenCreateReactPageModule = typeof Client.createReactPageModule;

// @ts-expect-error mountReactPage is internal to generated page bootstrap.
export type HiddenMountReactPage = typeof Client.mountReactPage;

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

// @ts-expect-error FileRoute is a router implementation detail.
export type HiddenFileRoute = Client.FileRoute;

export type HiddenPublicTransportManifestInit =
  // @ts-expect-error initTransportFromManifest is framework bootstrap-only.
  typeof ClientTransport.initTransportFromManifest;

export type HiddenPublicTransportGetServerFunction =
  // @ts-expect-error getServerFunction is internal query runtime plumbing.
  typeof ClientTransport.getServerFunction;

export type HiddenPublicTransportReset =
  // @ts-expect-error __resetForTesting is test-only.
  typeof ClientTransport.__resetForTesting;
