import type * as Client from "../src/index";

export type PublicPageHookExports = [
  typeof Client.usePageParams,
  typeof Client.usePageSearch,
  typeof Client.usePageLoaderData,
];

// Public page code should use hooks instead of importing framework page props.
// @ts-expect-error PageProps is internal to the framework-managed page runtime.
export type HiddenPageProps = Client.PageProps;

// @ts-expect-error PageComponent is internal to the framework-managed page runtime.
export type HiddenPageComponent = Client.PageComponent;

// Router construction stays behind the framework-managed page runtime.
// @ts-expect-error createApp is internal to generated SPA bootstrap.
export type HiddenCreateApp = typeof Client.createApp;

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
