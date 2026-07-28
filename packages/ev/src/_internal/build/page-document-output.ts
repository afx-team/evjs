import type { CoreRoutePattern } from "@evjs/shared/manifest";

/**
 * Map one static semantic Page route to its canonical HTML output.
 *
 * Returns undefined for dynamic/catch-all routes because they do not identify
 * one build-time document.
 */
export function createStaticPageDocumentOutput(
  route: string | CoreRoutePattern,
): string | undefined {
  const segments =
    typeof route === "string"
      ? staticSegmentsFromPath(route)
      : staticSegmentsFromPattern(route);
  if (!segments) return undefined;
  return segments.length > 0
    ? `${segments.join("/")}/index.html`
    : "index.html";
}

function staticSegmentsFromPath(pathname: string): string[] | undefined {
  if (pathname === "/") return [];
  const segments = pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  return segments.some(
    (segment) =>
      segment.startsWith("$") ||
      segment.startsWith(":") ||
      segment.startsWith("*"),
  )
    ? undefined
    : segments;
}

function staticSegmentsFromPattern(
  pattern: CoreRoutePattern,
): string[] | undefined {
  const segments: string[] = [];
  for (const segment of pattern.segments) {
    if (segment.kind !== "static") return undefined;
    segments.push(segment.value);
  }
  return segments;
}
