import type { PageRouteNode } from "@evjs/shared/manifest";

export function comparePageRoutes(
  left: Pick<PageRouteNode, "path">,
  right: Pick<PageRouteNode, "path">,
): number {
  if (left.path === right.path) return 0;
  if (left.path === "/") return -1;
  if (right.path === "/") return 1;

  const leftSegments = routeSegments(left.path);
  const rightSegments = routeSegments(right.path);
  const segmentCount = Math.min(leftSegments.length, rightSegments.length);

  for (let index = 0; index < segmentCount; index++) {
    const leftSegment = leftSegments[index] ?? "";
    const rightSegment = rightSegments[index] ?? "";
    if (leftSegment === rightSegment) continue;

    const leftKind = routeSegmentKind(leftSegment);
    const rightKind = routeSegmentKind(rightSegment);
    if (leftKind !== rightKind) {
      return routeSegmentRank(leftKind) - routeSegmentRank(rightKind);
    }

    return compareRouteSegments(leftSegment, rightSegment);
  }

  return leftSegments.length - rightSegments.length;
}

export function sortPageRoutes(routes: PageRouteNode[]): PageRouteNode[] {
  return [...routes].sort(comparePageRoutes);
}

function routeSegments(routePath: string): string[] {
  return routePath.split("/").filter(Boolean);
}

type RouteSegmentKind = "static" | "dynamic" | "wildcard";

function routeSegmentKind(segment: string): RouteSegmentKind {
  if (segment === "*") return "wildcard";
  if (segment.startsWith("$") || segment.startsWith(":")) return "dynamic";
  return "static";
}

function routeSegmentRank(kind: RouteSegmentKind): number {
  switch (kind) {
    case "static":
      return 0;
    case "dynamic":
      return 1;
    case "wildcard":
      return 2;
  }
}

function compareRouteSegments(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
