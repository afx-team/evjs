/**
 * Routing utilities re-exported from @tanstack/react-router.
 *
 * This module provides the core primitives for building file-based
 * or code-based routing in the ev framework.
 */

// Types
export type {
  AnyRootRoute,
  AnyRoute,
  AnyRouteMatch,
  AnyRouter,
  ErrorComponentProps,
  ErrorRouteComponent,
  LinkOptions,
  LinkProps,
  NavigateOptions,
  NotFoundError,
  NotFoundRouteComponent,
  NotFoundRouteProps,
  RegisteredRouter,
  RouteComponent,
  RouteMatch,
  RouterOptions,
  RouterState,
  SearchSchemaInput,
} from "@tanstack/react-router";
export {
  CatchBoundary,
  CatchNotFound,
  createLink,
  createRootRoute,
  createRootRouteWithContext,
  createRoute,
  createRouteMask,
  createRouter,
  DefaultGlobalNotFound,
  ErrorComponent,
  getRouteApi,
  isNotFound,
  isRedirect,
  Link,
  lazyRouteComponent,
  linkOptions,
  Navigate,
  notFound,
  Outlet,
  RouterProvider,
  redirect,
  useBlocker,
  useCanGoBack,
  useLoaderData,
  useLoaderDeps,
  useLocation,
  useMatch,
  useMatchRoute,
  useNavigate,
  useParams,
  useRouteContext,
  useRouter,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
