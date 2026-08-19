import path from "node:path";

export const ROUTE_SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;

const ROUTE_SOURCE_EXTENSION_SET = new Set<string>(ROUTE_SOURCE_EXTENSIONS);
const CASE_PRESERVING_STATIC_ROUTE_SEGMENT_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const LOWERCASE_STATIC_ROUTE_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._~-]*$/;
const DYNAMIC_ROUTE_PARAM_PATTERN = /^\$[A-Za-z_][A-Za-z0-9_]*$/;
const CATCH_ALL_ROUTE_PARAM_PATTERN = /^\$\.\.\.[A-Za-z_][A-Za-z0-9_]*$/;

export interface RouteSegmentConventionOptions {
  allowCasePreservingStatic?: boolean;
  allowCatchAll?: boolean;
  isReservedParamName?: (name: string) => boolean;
}

export interface InvalidRouteSegment {
  kind:
    | "catch-all"
    | "duplicate-catch-all"
    | "duplicate-dynamic"
    | "dynamic"
    | "non-terminal-catch-all"
    | "reserved-catch-all"
    | "reserved-dynamic"
    | "static";
  segment: string;
}

export type RouteSegmentConventionViolation =
  | { kind: "route-group"; segment: string }
  | { kind: "bracket"; segment: string }
  | { kind: "unsupported-dynamic"; segment: string }
  | InvalidRouteSegment;

/** Whether a file can participate in a source route convention. */
export function isRouteSourceModuleFile(file: string): boolean {
  if (file.endsWith(".d.ts")) return false;
  if (/\.(client|server)\.[jt]sx?$/.test(file)) return false;
  if (/\.(test|spec|story|stories)\.[cm]?[jt]sx?$/.test(file)) return false;
  return ROUTE_SOURCE_EXTENSION_SET.has(path.extname(file));
}

export function normalizeRouteConventionPath(routeRel: string): string {
  return routeRel.replaceAll("\\", "/");
}

export function isRouteGroupSegment(segment: string): boolean {
  return /^\([^)]+\)$/.test(segment);
}

export function isCatchAllRouteSegment(segment: string): boolean {
  return segment.startsWith("$...");
}

/**
 * Validate route directory segments without selecting Page or Server policy.
 *
 * Callers own reserved parameter names and whether catch-all or uppercase
 * static segments belong to their route model.
 */
export function findRouteSegmentConventionViolation(
  segments: string[],
  options: RouteSegmentConventionOptions = {},
): RouteSegmentConventionViolation | undefined {
  const routeGroupSegment = findMalformedRouteGroupSegment(segments);
  if (routeGroupSegment) {
    return { kind: "route-group", segment: routeGroupSegment };
  }

  const bracketSegment = findBracketRouteSegment(segments);
  if (bracketSegment) return { kind: "bracket", segment: bracketSegment };

  const unsupportedDynamicSegment = findUnsupportedDynamicRouteSegment(
    segments,
    options,
  );
  if (unsupportedDynamicSegment) {
    return {
      kind: "unsupported-dynamic",
      segment: unsupportedDynamicSegment,
    };
  }

  return findInvalidRouteSegment(segments, options);
}

function findMalformedRouteGroupSegment(
  segments: string[],
): string | undefined {
  return segments.find(
    (segment) =>
      (segment.startsWith("(") || segment.endsWith(")")) &&
      !isRouteGroupSegment(segment),
  );
}

function findBracketRouteSegment(segments: string[]): string | undefined {
  return segments.find(
    (segment) => segment.startsWith("[") || segment.endsWith("]"),
  );
}

function findUnsupportedDynamicRouteSegment(
  segments: string[],
  options: RouteSegmentConventionOptions,
): string | undefined {
  const allowCatchAll = options.allowCatchAll !== false;
  return segments.find(
    (segment) =>
      segment.startsWith("$") &&
      (segment === "$" ||
        (!allowCatchAll && isCatchAllRouteSegment(segment)) ||
        segment.endsWith("?")),
  );
}

function findInvalidRouteSegment(
  segments: string[],
  options: RouteSegmentConventionOptions,
): InvalidRouteSegment | undefined {
  const dynamicNames = new Set<string>();
  const staticSegmentPattern =
    options.allowCasePreservingStatic === false
      ? LOWERCASE_STATIC_ROUTE_SEGMENT_PATTERN
      : CASE_PRESERVING_STATIC_ROUTE_SEGMENT_PATTERN;
  let lastRouteSegmentIndex = -1;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (!isRouteGroupSegment(segments[index])) {
      lastRouteSegmentIndex = index;
      break;
    }
  }

  let hasCatchAll = false;
  for (const [index, segment] of segments.entries()) {
    if (isRouteGroupSegment(segment)) continue;

    if (isCatchAllRouteSegment(segment)) {
      if (options.allowCatchAll === false) {
        return { kind: "catch-all", segment };
      }
      if (!CATCH_ALL_ROUTE_PARAM_PATTERN.test(segment)) {
        return { kind: "catch-all", segment };
      }
      const name = getCatchAllRouteParamName(segment);
      if (options.isReservedParamName?.(name)) {
        return { kind: "reserved-catch-all", segment };
      }
      if (index !== lastRouteSegmentIndex) {
        return { kind: "non-terminal-catch-all", segment };
      }
      if (hasCatchAll) return { kind: "duplicate-catch-all", segment };
      hasCatchAll = true;
      continue;
    }

    if (segment.startsWith("$")) {
      if (!DYNAMIC_ROUTE_PARAM_PATTERN.test(segment)) {
        return { kind: "dynamic", segment };
      }
      const name = segment.slice(1);
      if (options.isReservedParamName?.(name)) {
        return { kind: "reserved-dynamic", segment };
      }
      if (dynamicNames.has(name)) return { kind: "duplicate-dynamic", segment };
      dynamicNames.add(name);
      continue;
    }

    if (!staticSegmentPattern.test(segment)) {
      return { kind: "static", segment };
    }
  }

  return undefined;
}

function getCatchAllRouteParamName(segment: string): string {
  return segment.slice("$...".length);
}
