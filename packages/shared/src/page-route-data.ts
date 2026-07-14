export type PageSearchParams = Record<string, string | string[]>;

export type PageRouteParamNameValidationError = "empty" | "reserved";
export type PageRouteParamSegmentValidationErrorKind =
  | PageRouteParamNameValidationError
  | "duplicate"
  | "duplicate-wildcard"
  | "star-wildcard";

export interface PageRouteParamSegmentValidationError {
  segment: string;
  name: string;
  error: PageRouteParamSegmentValidationErrorKind;
}

const RESERVED_PAGE_ROUTE_PARAM_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "_splat",
]);

export function findBestPageRoute<T extends { path: string; id?: string }>(
  routes: Iterable<T>,
  pathname: string,
): T | undefined {
  let best: { route: T; match: PageRoutePathMatch } | undefined;

  for (const route of routes) {
    const match = matchPageRoutePath(route.path, pathname);
    if (match && isBetterPageRouteMatch(route, match, best)) {
      best = { route, match };
    }
  }

  return best?.route;
}

export function pageRoutePathMatches(
  routePath: string,
  pathname: string,
): boolean {
  return Boolean(matchPageRoutePath(routePath, pathname));
}

export function pageRoutePathShapeFromPath(routePath: string): string {
  const segments = splitPath(routePath);
  if (segments.length === 0) return "/";
  return `/${segments.map(normalizeRouteShapeSegment).join("/")}`;
}

export function normalizeRoutePathname(pathname: string): string {
  if (!pathname.startsWith("/")) return normalizeRoutePathname(`/${pathname}`);
  if (pathname.length === 1) return pathname;
  return pathname.replace(/\/+$/, "");
}

export function matchPageRouteParams(
  routePath: string,
  pathname: string,
): Record<string, string> {
  const routeSegments = splitPath(routePath);
  const pathSegments = splitPath(pathname);
  const params: Record<string, string> = {};

  routeSegments.forEach((segment, index) => {
    if (isWildcardRouteSegment(segment)) {
      if (Object.hasOwn(params, "_splat")) return;
      defineRouteParam(
        params,
        "_splat",
        collectWildcardParam(index, routeSegments, pathSegments),
      );
      return;
    }
    const name = getDynamicRouteParamName(segment);
    if (!name || isReservedPageRouteParamName(name)) return;
    defineRouteParam(
      params,
      name,
      safeDecodeURIComponent(pathSegments[index] ?? ""),
    );
  });

  return params;
}

export function getPageRouteParamNameValidationError(
  name: unknown,
): PageRouteParamNameValidationError | undefined {
  if (typeof name !== "string" || !name.trim()) return "empty";
  if (isReservedPageRouteParamName(name)) return "reserved";
  return undefined;
}

export function getPageRouteParamSegmentValidationError(
  routePath: string,
): PageRouteParamSegmentValidationError | undefined {
  const seenNames = new Set<string>();
  let seenWildcard = false;
  for (const segment of splitPath(routePath)) {
    if (isWildcardRouteSegment(segment)) {
      if (seenWildcard) {
        return { segment, name: "_splat", error: "duplicate-wildcard" };
      }
      seenWildcard = true;
      continue;
    }
    if (segment === "*") {
      return { segment, name: "_splat", error: "star-wildcard" };
    }

    const name = getDynamicRouteParamName(segment);
    if (name === undefined) continue;

    const error = getPageRouteParamNameValidationError(name);
    if (error) return { segment, name, error };
    if (seenNames.has(name)) return { segment, name, error: "duplicate" };
    seenNames.add(name);
  }
  return undefined;
}

export function isReservedPageRouteParamName(name: string): boolean {
  return RESERVED_PAGE_ROUTE_PARAM_NAMES.has(name);
}

function getDynamicRouteParamName(segment: string): string | undefined {
  if (isWildcardRouteSegment(segment)) return undefined;
  if (segment.startsWith("$") || segment.startsWith(":")) {
    return segment.slice(1);
  }
  return undefined;
}

function collectWildcardParam(
  index: number,
  routeSegments: string[],
  pathSegments: string[],
): string {
  const wildcardSegments =
    index === routeSegments.length - 1
      ? pathSegments.slice(index)
      : [pathSegments[index] ?? ""];
  return safeDecodeURIComponent(wildcardSegments.join("/"));
}

function defineRouteParam(
  params: Record<string, string>,
  name: string,
  value: string,
): void {
  Object.defineProperty(params, name, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

interface PageRoutePathMatch {
  exact: boolean;
  staticSegments: number;
  dynamicSegments: number;
  wildcardSegments: number;
  segmentCount: number;
  routePath: string;
}

function matchPageRoutePath(
  routePath: string,
  pathname: string,
): PageRoutePathMatch | undefined {
  const normalizedRoutePath = normalizeRoutePathname(routePath);
  const normalizedPathname = normalizeRoutePathname(pathname);
  const routeSegments = splitPath(normalizedRoutePath);
  const pathSegments = splitPath(normalizedPathname);
  const prefixWildcard = isWildcardRouteSegment(routeSegments.at(-1) ?? "");
  const segmentsToMatch = prefixWildcard
    ? routeSegments.slice(0, -1)
    : routeSegments;

  if (!prefixWildcard && segmentsToMatch.length !== pathSegments.length) {
    return undefined;
  }
  if (prefixWildcard && segmentsToMatch.length > pathSegments.length) {
    return undefined;
  }

  for (let index = 0; index < segmentsToMatch.length; index++) {
    const routeSegment = segmentsToMatch[index] ?? "";
    const pathSegment = pathSegments[index] ?? "";
    if (!routeSegmentMatches(routeSegment, pathSegment)) return undefined;
  }

  return {
    exact:
      routeSegments.length === pathSegments.length &&
      routeSegments.every((segment, index) =>
        routeSegmentEquals(segment, pathSegments[index] ?? ""),
      ),
    staticSegments: segmentsToMatch.filter(isStaticRouteSegment).length,
    dynamicSegments: segmentsToMatch.filter(isDynamicRouteSegment).length,
    wildcardSegments:
      segmentsToMatch.filter(isWildcardRouteSegment).length +
      (prefixWildcard ? 1 : 0),
    segmentCount: routeSegments.length,
    routePath: normalizedRoutePath,
  };
}

function routeSegmentMatches(
  routeSegment: string,
  pathSegment: string,
): boolean {
  return (
    routeSegmentEquals(routeSegment, pathSegment) ||
    isDynamicRouteSegment(routeSegment) ||
    isWildcardRouteSegment(routeSegment)
  );
}

function routeSegmentEquals(left: string, right: string): boolean {
  return safeDecodeURIComponent(left) === safeDecodeURIComponent(right);
}

function isBetterPageRouteMatch<T extends { path: string; id?: string }>(
  route: T,
  match: PageRoutePathMatch,
  current: { route: T; match: PageRoutePathMatch } | undefined,
): boolean {
  if (!current) return true;
  const comparison = comparePageRouteMatches(match, current.match);
  if (comparison !== 0) return comparison > 0;
  if (route.path !== current.route.path) return route.path < current.route.path;
  return (route.id ?? "") < (current.route.id ?? "");
}

function comparePageRouteMatches(
  left: PageRoutePathMatch,
  right: PageRoutePathMatch,
): number {
  if (left.exact !== right.exact) return left.exact ? 1 : -1;
  if (left.staticSegments !== right.staticSegments) {
    return left.staticSegments - right.staticSegments;
  }
  if (left.wildcardSegments !== right.wildcardSegments) {
    return right.wildcardSegments - left.wildcardSegments;
  }
  if (left.dynamicSegments !== right.dynamicSegments) {
    return right.dynamicSegments - left.dynamicSegments;
  }
  if (left.segmentCount !== right.segmentCount) {
    return left.segmentCount - right.segmentCount;
  }
  return left.routePath.length - right.routePath.length;
}

function isStaticRouteSegment(segment: string): boolean {
  return !isDynamicRouteSegment(segment) && !isWildcardRouteSegment(segment);
}

function isDynamicRouteSegment(segment: string): boolean {
  if (isWildcardRouteSegment(segment)) return false;
  return segment.startsWith("$") || segment.startsWith(":");
}

function isWildcardRouteSegment(segment: string): boolean {
  return segment === "$";
}

function normalizeRouteShapeSegment(segment: string): string {
  if (isWildcardRouteSegment(segment)) return segment;
  return isDynamicRouteSegment(segment) ? ":param" : segment;
}

export function parsePageSearch(search: string): PageSearchParams {
  const query = search.startsWith("?") ? search.slice(1) : search;
  if (!query) return {};

  const params: PageSearchParams = {};
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const separator = pair.indexOf("=");
    const rawKey = separator >= 0 ? pair.slice(0, separator) : pair;
    const rawValue = separator >= 0 ? pair.slice(separator + 1) : "";
    const key = decodeQueryValue(rawKey);
    const value = decodeQueryValue(rawValue);
    if (!key) continue;

    const current = params[key];
    if (Array.isArray(current)) {
      current.push(value);
    } else if (typeof current === "string") {
      defineSearchParam(params, key, [current, value]);
    } else {
      defineSearchParam(params, key, value);
    }
  }

  return params;
}

function defineSearchParam(
  params: PageSearchParams,
  key: string,
  value: string | string[],
): void {
  Object.defineProperty(params, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function splitPath(value: string): string[] {
  return normalizeRoutePathname(value).split("/").filter(Boolean);
}

function decodeQueryValue(value: string): string {
  return safeDecodeURIComponent(value.replace(/\+/g, " "));
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
