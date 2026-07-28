import { compareRoutePathsBySpecificity } from "@evjs/shared";

interface RoutePathOwner {
  path: string;
}

/**
 * Compare route patterns in registration order.
 *
 * Specificity is decided at the first differing segment so a static segment
 * always precedes a dynamic segment that could consume it. Parent paths stay
 * ahead of descendants, and lexical comparison makes otherwise equivalent
 * routes deterministic.
 */
export function compareRoutesBySpecificity(
  left: RoutePathOwner,
  right: RoutePathOwner,
): number {
  return compareRoutePathsBySpecificity(left.path, right.path);
}

export function sortRoutesBySpecificity<T extends RoutePathOwner>(
  routes: readonly T[],
): T[] {
  return [...routes].sort(compareRoutesBySpecificity);
}
