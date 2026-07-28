import type { CoreRoutePattern } from "@evjs/shared/manifest";

export function formatCoreRoutePattern(pattern: CoreRoutePattern): string {
  if (pattern.segments.length === 0) return "/";
  return `/${pattern.segments
    .map((segment) => {
      if (segment.kind === "static") return segment.value;
      if (segment.kind === "param") return `$${segment.name}`;
      return "$";
    })
    .join("/")}`;
}
