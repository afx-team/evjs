import path from "node:path";
import { isReservedServerRouteParamName } from "@evjs/shared";
import {
  findRouteSegmentConventionViolation,
  isRouteGroupSegment,
  isRouteSourceModuleFile,
  normalizeRouteConventionPath,
  type RouteSegmentConventionViolation,
} from "./route-conventions.js";

export const SERVER_ROUTE_ENTRY_BASENAME = "api";
/** Fixed root for the canonical server request-route file convention. */
export const CANONICAL_SERVER_ROUTE_ROOT = "./src/apis";
export const SERVER_ROUTE_ENTRY_LABEL = "api.ts, api.tsx, api.js, or api.jsx";

export interface ServerRouteAnchorConvention {
  segments: string[];
}

/**
 * Parse one positive Server Route anchor.
 *
 * The containing directory owns the URL and middleware scope. Every other
 * source module in the tree remains ordinary colocated application code.
 */
export function parseServerRouteAnchorFile(
  routeRel: string,
): ServerRouteAnchorConvention | undefined {
  const normalizedRouteRel = normalizeRouteConventionPath(routeRel);
  const basename = path.posix.basename(normalizedRouteRel);
  if (!isRouteSourceModuleFile(basename)) return undefined;

  const extension = path.posix.extname(normalizedRouteRel);
  const withoutExtension = normalizedRouteRel.slice(0, -extension.length);
  const segments = withoutExtension.split("/").filter(Boolean);
  if (segments.at(-1) !== SERVER_ROUTE_ENTRY_BASENAME) return undefined;
  return { segments: segments.slice(0, -1) };
}

/** Validate the directory segments that own one Server Route anchor. */
export function findServerRouteSegmentConventionViolation(
  segments: string[],
): RouteSegmentConventionViolation | undefined {
  return findRouteSegmentConventionViolation(segments, {
    allowCasePreservingStatic: false,
    allowCatchAll: false,
    isReservedParamName: isReservedServerRouteParamName,
  });
}

/** Derive the request path from a validated Server Route directory. */
export function serverRoutePathFromSegments(segments: string[]): string {
  const pathSegments = segments
    .filter((segment) => !isRouteGroupSegment(segment))
    .map((segment) =>
      segment.startsWith("$") ? `:${segment.slice(1)}` : segment,
    );
  return pathSegments.length === 0 ? "/" : `/${pathSegments.join("/")}`;
}
