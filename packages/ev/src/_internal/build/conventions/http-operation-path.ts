import {
  getPathPatternValidationError,
  getServerRouteParamSegmentValidationError,
} from "@evjs/shared";

/** Resolve a method path relative to its domain directory without evaluating source. */
export function resolveHttpOperationPath(base: string, suffix = "/"): string {
  if (!suffix.startsWith("/")) {
    throw new Error('[evjs] HTTP operation path must start with "/".');
  }
  const pathname =
    `${base === "/" ? "" : base}${suffix === "/" ? "" : suffix}` || "/";
  const segments = pathname.split("/").slice(1);
  if (
    getPathPatternValidationError(pathname) ||
    getServerRouteParamSegmentValidationError(pathname) ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        /[\\*]/.test(segment),
    )
  ) {
    if (pathname === "/") return pathname;
    throw new Error(`[evjs] Invalid HTTP operation path "${pathname}".`);
  }
  return pathname;
}
