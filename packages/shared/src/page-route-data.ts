import {
  canonicalizeStaticRouteSegment,
  safeDecodeRouteSegment,
  staticRouteSegmentsEqual,
  staticRouteSegmentToRegExpSource,
} from "./route-segment.js";
import { compareRoutePathsBySpecificity } from "./route-specificity.js";

export type PageSearchParams = Record<string, string>;

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
  let best: T | undefined;

  for (const route of routes) {
    if (
      matchPageRoutePath(route.path, pathname) &&
      isBetterPageRouteMatch(route, best)
    ) {
      best = route;
    }
  }

  return best;
}

export function pageRoutePathMatches(
  routePath: string,
  pathname: string,
): boolean {
  return matchPageRoutePath(routePath, pathname);
}

/** Compile the canonical Page route syntax to an anchored URL matcher. */
export function pageRoutePathToRegExp(routePath: string): RegExp {
  const segments = splitPath(normalizeRoutePathname(routePath));
  if (segments.length === 0) return /^\/?$/;

  const hasTerminalSplat = isWildcardRouteSegment(segments.at(-1) ?? "");
  const fixedSegments = hasTerminalSplat ? segments.slice(0, -1) : segments;
  const prefix = fixedSegments
    .map((segment) =>
      isDynamicRouteSegment(segment)
        ? "[^/]+"
        : staticRouteSegmentToRegExpSource(segment),
    )
    .join("/");

  if (hasTerminalSplat) {
    return prefix
      ? new RegExp(`^/${prefix}(?:/[^/]+)*/?$`)
      : /^(?:\/[^/]+)*\/?$/;
  }
  return new RegExp(`^/${prefix}/?$`);
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
  const pathSegments = splitRequestPath(pathname);
  const params: Record<string, string> = {};
  if (!pathSegments) return params;

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
      safeDecodeRouteSegment(pathSegments[index] ?? ""),
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
  return safeDecodeRouteSegment(wildcardSegments.join("/"));
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

function matchPageRoutePath(routePath: string, pathname: string): boolean {
  const routeSegments = splitPath(routePath);
  const pathSegments = splitRequestPath(pathname);
  if (!pathSegments) return false;
  const prefixWildcard = isWildcardRouteSegment(routeSegments.at(-1) ?? "");
  const segmentsToMatch = prefixWildcard
    ? routeSegments.slice(0, -1)
    : routeSegments;

  if (!prefixWildcard && segmentsToMatch.length !== pathSegments.length) {
    return false;
  }
  if (prefixWildcard && segmentsToMatch.length > pathSegments.length) {
    return false;
  }

  for (let index = 0; index < segmentsToMatch.length; index++) {
    const routeSegment = segmentsToMatch[index] ?? "";
    const pathSegment = pathSegments[index] ?? "";
    if (!routeSegmentMatches(routeSegment, pathSegment)) return false;
  }

  return true;
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
  return staticRouteSegmentsEqual(left, right);
}

function isBetterPageRouteMatch<T extends { path: string; id?: string }>(
  route: T,
  current: T | undefined,
): boolean {
  if (!current) return true;
  const specificity = compareRoutePathsBySpecificity(route.path, current.path);
  if (specificity !== 0) return specificity < 0;
  if (route.path !== current.path) return route.path < current.path;
  return (route.id ?? "") < (current.id ?? "");
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
  return isDynamicRouteSegment(segment)
    ? ":param"
    : canonicalizeStaticRouteSegment(segment);
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

    defineSearchParam(params, key, value);
  }

  return params;
}

function defineSearchParam(
  params: PageSearchParams,
  key: string,
  value: string,
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

/** Split a request pathname without erasing empty URL segments. */
function splitRequestPath(pathname: string): string[] | undefined {
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (withLeadingSlash === "/") return [];

  const body = withLeadingSlash.slice(1).replace(/\/$/, "");
  const segments = body.split("/");
  return segments.some((segment) => segment === "") ? undefined : segments;
}

function decodeQueryValue(value: string): string {
  return safeDecodeRouteSegment(value.replace(/\+/g, " "));
}
