import { staticRouteSegmentsEqual } from "./segment.js";

/**
 * Compare canonical client or server route paths in registration order.
 *
 * Specificity is decided at the first semantically different segment: static
 * segments precede dynamic segments, which precede terminal wildcards. Dynamic
 * parameter names do not affect specificity, so comparison continues to later
 * segments. A parent path precedes its descendants, and lexical comparison
 * resolves equivalent shapes.
 */
export function compareRoutePathsBySpecificity(
  leftPath: string,
  rightPath: string,
): number {
  const leftSegments = splitRoutePath(leftPath);
  const rightSegments = splitRoutePath(rightPath);
  const segmentCount = Math.min(leftSegments.length, rightSegments.length);

  for (let index = 0; index < segmentCount; index += 1) {
    const leftSegment = leftSegments[index] ?? "";
    const rightSegment = rightSegments[index] ?? "";
    if (leftSegment === rightSegment) continue;

    const rankDifference =
      getRouteSegmentRank(leftSegment) - getRouteSegmentRank(rightSegment);
    if (rankDifference !== 0) return rankDifference;
    if (isDynamicRouteSegment(leftSegment)) continue;
    if (staticRouteSegmentsEqual(leftSegment, rightSegment)) continue;
    return leftSegment < rightSegment ? -1 : 1;
  }

  const lengthDifference = leftSegments.length - rightSegments.length;
  if (lengthDifference !== 0) return lengthDifference;
  if (leftPath === rightPath) return 0;
  return leftPath < rightPath ? -1 : 1;
}

function splitRoutePath(routePath: string): string[] {
  return routePath.split("/").filter(Boolean);
}

function getRouteSegmentRank(segment: string): number {
  if (segment === "$") return 2;
  if (isDynamicRouteSegment(segment)) return 1;
  return 0;
}

function isDynamicRouteSegment(segment: string): boolean {
  return (
    segment !== "$" && (segment.startsWith("$") || segment.startsWith(":"))
  );
}
