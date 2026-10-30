const CONCRETE_RUNTIME_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/;

export interface ConcreteRuntimePathSegmentValidationError {
  segment: string;
}

/**
 * Validate the segments shared by absolute runtime base paths and relative
 * runtime endpoints. Leading-slash ownership stays with the caller.
 */
export function getConcreteRuntimePathSegmentValidationError(
  value: string,
): ConcreteRuntimePathSegmentValidationError | undefined {
  const path = value.startsWith("/") ? value.slice(1) : value;
  for (const segment of path.split("/")) {
    if (
      segment &&
      segment !== "." &&
      segment !== ".." &&
      CONCRETE_RUNTIME_PATH_SEGMENT_PATTERN.test(segment)
    ) {
      continue;
    }
    return { segment };
  }
  return undefined;
}

export function formatConcreteRuntimePathSegmentValidationError(
  error: ConcreteRuntimePathSegmentValidationError,
): string {
  const received = error.segment
    ? JSON.stringify(error.segment)
    : "an empty segment";
  return `must use non-empty ASCII URL-safe segments containing only letters, digits, ".", "_", "~", or "-"; received ${received}.`;
}
