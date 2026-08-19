import {
  assertPortableRelativeArtifactPath,
  assertPortableRelativeBrowserArtifactPath,
  canonicalPortableArtifactPathKey,
  portableArtifactPathsConflict,
} from "@evjs/shared/manifest";

const WINDOWS_RESERVED_PATH_SEGMENT =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export const FRAMEWORK_DEPLOYMENT_METADATA_FILE_NAME =
  "deployment-metadata.json";

/**
 * Validate a framework-owned artifact path before it becomes a physical file.
 * Forward slashes are the only separators so the same path has one identity on
 * every supported host.
 */
export { assertPortableRelativeArtifactPath };

/** Validate a portable physical file that is also used as a browser URL. */
export { assertPortableRelativeBrowserArtifactPath };

/** Validate a portable artifact leaf name rather than a nested relative path. */
export function assertPortableArtifactFileName(
  value: unknown,
  field: string,
): string {
  const fileName = assertPortableRelativeArtifactPath(
    value,
    field,
    "file name",
  );
  if (fileName.includes("/")) {
    throw portableArtifactPathError(field, "file name");
  }
  return fileName;
}

/** Convert an arbitrary semantic id into one portable physical path segment. */
export function sanitizePortableArtifactPathSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const segment = sanitized || "generated";
  return WINDOWS_RESERVED_PATH_SEGMENT.test(segment) ? `${segment}_` : segment;
}

/** Key used by case-insensitive, Unicode-normalizing file systems. */
export { canonicalPortableArtifactPathKey };

/**
 * Whether two file reservations overlap after portable path normalization.
 * A file cannot also be an ancestor directory of another file, so `assets`
 * conflicts with both `ASSETS` and `assets/main.js`.
 */
export { portableArtifactPathsConflict };

/** Reserve the first portable candidate whose cross-platform key is unused. */
export function reserveUniquePortableArtifactPath(
  usedKeys: Set<string>,
  candidateForAttempt: (attempt: number) => string,
  field: string,
): string {
  for (let attempt = 0; ; attempt += 1) {
    const candidate = assertPortableRelativeArtifactPath(
      candidateForAttempt(attempt),
      field,
    );
    const key = canonicalPortableArtifactPathKey(candidate);
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    return candidate;
  }
}

function portableArtifactPathError(field: string, kind: string): Error {
  return new Error(
    `[evjs] ${field} must be a non-empty portable ${kind} using forward slashes, without empty, "." or ".." path segments, control characters, Windows reserved names, invalid <>:"|?* characters, or trailing spaces and dots.`,
  );
}
