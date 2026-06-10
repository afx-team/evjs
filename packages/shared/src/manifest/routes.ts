import type { RenderMode } from "./index.js";

export interface RouteRenderingPage {
  path?: string;
  render?: RenderMode | string;
}

export interface RouteDerivedPage {
  path?: string;
  routeId?: string;
}

export interface RouteRenderingRoute {
  path: string;
  appId?: string;
  pageId?: string;
}

export interface RouteRenderingSource {
  apps?: Record<string, unknown>;
  pages?: Record<string, RouteRenderingPage>;
  routes?: RouteRenderingRoute[];
}

export type ClientRouteTarget =
  | {
      kind: "page";
      pageId: string;
    }
  | {
      kind: "app";
      appId: string;
    };

export interface ClientRouteMatch {
  path: string;
  target: ClientRouteTarget;
}

export function isServerRenderedPage(
  page: RouteRenderingPage | undefined,
): boolean {
  return Boolean(page && page.render !== "csr");
}

export function isRouteDerivedPage(
  page: RouteDerivedPage | undefined,
): boolean {
  return Boolean(page?.routeId && !page.path);
}

export function getServerRenderedPagePaths(
  source: RouteRenderingSource,
): string[] {
  return compactUnique(
    Object.values(source.pages ?? {}).flatMap((page) =>
      page.path && isServerRenderedPage(page) ? [page.path] : [],
    ),
  );
}

export function getServerRenderedRoutePaths(
  source: RouteRenderingSource,
): string[] {
  return compactUnique(
    (source.routes ?? []).flatMap((route) => {
      const page = route.pageId ? source.pages?.[route.pageId] : undefined;
      return isServerRenderedPage(page) ? [route.path] : [];
    }),
  );
}

export function getServerRenderedPaths(source: RouteRenderingSource): string[] {
  return compactUnique([
    ...getServerRenderedPagePaths(source),
    ...getServerRenderedRoutePaths(source),
  ]);
}

export function getClientRouteMatches(
  source: RouteRenderingSource,
): ClientRouteMatch[] {
  return (source.routes ?? []).flatMap((route) => {
    const target = getClientRouteTarget(source, route);
    return target ? [{ path: route.path, target }] : [];
  });
}

export function getClientRouteTarget(
  source: RouteRenderingSource,
  route: RouteRenderingRoute,
): ClientRouteTarget | undefined {
  const page = route.pageId ? source.pages?.[route.pageId] : undefined;
  if (isServerRenderedPage(page)) return undefined;

  if (route.pageId && page) {
    return {
      kind: "page",
      pageId: route.pageId,
    };
  }

  if (route.appId && hasApp(source, route.appId)) {
    return {
      kind: "app",
      appId: route.appId,
    };
  }

  return undefined;
}

function hasApp(source: RouteRenderingSource, appId: string): boolean {
  return source.apps ? Boolean(source.apps[appId]) : true;
}

function compactUnique(values: Array<string | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}
