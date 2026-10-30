import {
  canonicalizeStaticRouteSegment,
  staticRouteSegmentsEqual,
} from "../../routing/segment.js";
import type { CoreRoutePattern, CoreRouteSegment } from "./core.js";

/** Stable runtime path shape used to enforce terminal Route uniqueness. */
export function coreRoutePatternShape(pattern: CoreRoutePattern): string {
  return JSON.stringify(
    pattern.segments.map((segment) => {
      if (segment.kind === "static") {
        return ["static", canonicalizeStaticRouteSegment(segment.value)];
      }
      if (segment.kind === "param") return ["param"];
      return ["splat"];
    }),
  );
}

/** Compare two Route patterns without collapsing dynamic parameter names. */
export function coreRoutePatternsEqual(
  left: CoreRoutePattern,
  right: CoreRoutePattern,
): boolean {
  return (
    left.segments.length === right.segments.length &&
    left.segments.every((segment, index) =>
      coreRouteSegmentsEqual(segment, right.segments[index]),
    )
  );
}

/** Test whether `prefix` is the exact semantic prefix of `pattern`. */
export function isCoreRoutePatternPrefix(
  prefix: CoreRoutePattern,
  pattern: CoreRoutePattern,
): boolean {
  return (
    prefix.segments.length <= pattern.segments.length &&
    prefix.segments.every((segment, index) =>
      coreRouteSegmentsEqual(segment, pattern.segments[index]),
    )
  );
}

function coreRouteSegmentsEqual(
  left: CoreRouteSegment,
  right: CoreRouteSegment | undefined,
): boolean {
  if (!right || left.kind !== right.kind) return false;
  if (left.kind === "static" && right.kind === "static") {
    return staticRouteSegmentsEqual(left.value, right.value);
  }
  return (
    left.kind !== "static" &&
    right.kind !== "static" &&
    left.name === right.name
  );
}
