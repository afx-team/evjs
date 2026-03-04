// Route creation
export {
  createRootRoute,
  createRootRouteWithContext,
  createRoute,
  createRouteMask,
} from "@tanstack/react-router";

// Router
export { createRouter } from "@tanstack/react-router";

// Components
export {
  Outlet,
  Link,
  Navigate,
  CatchBoundary,
  ErrorComponent,
  CatchNotFound,
  DefaultGlobalNotFound,
} from "@tanstack/react-router";

// Link helpers
export { linkOptions, createLink } from "@tanstack/react-router";

// Hooks
export {
  useRouter,
  useRouterState,
  useMatch,
  useParams,
  useSearch,
  useNavigate,
  useLoaderData,
  useLoaderDeps,
  useRouteContext,
  useLocation,
  useMatchRoute,
  useBlocker,
  useCanGoBack,
} from "@tanstack/react-router";

// Router provider
export { RouterProvider } from "@tanstack/react-router";

// Utilities
export {
  redirect,
  isRedirect,
  notFound,
  isNotFound,
  getRouteApi,
  lazyRouteComponent,
} from "@tanstack/react-router";

// Types
export type {
  AnyRoute,
  AnyRootRoute,
  RouteComponent,
  ErrorRouteComponent,
  NotFoundRouteComponent,
  ErrorComponentProps,
  NotFoundRouteProps,
  AnyRouter,
  RegisteredRouter,
  RouterOptions,
  RouterState,
  LinkOptions,
  LinkProps,
  NavigateOptions,
  SearchSchemaInput,
  RouteMatch,
  AnyRouteMatch,
  NotFoundError,
} from "@tanstack/react-router";
