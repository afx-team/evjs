const INVALID_PORTABLE_PATH_CHARACTERS = /[<>:"|?*]/u;
const CONTROL_CHARACTER = /\p{Cc}/u;
const SURROGATE_CODE_POINT = /\p{Cs}/u;
const WINDOWS_RESERVED_PATH_SEGMENT =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const AMBIGUOUS_BROWSER_PATH_CHARACTER = /[#%]/u;

/**
 * Validate a relative physical artifact path that must behave consistently on
 * every supported host. URL-valued browser assets intentionally use a
 * different contract and must not be passed to this helper.
 */
export function assertPortableRelativeArtifactPath(
  value: unknown,
  field: string,
  kind = "relative artifact path",
): string {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    throw portableArtifactPathError(field, kind);
  }
  if (value.includes("\\")) {
    throw portableArtifactPathError(field, kind);
  }

  const segments = value.split("/");
  for (const segment of segments) {
    const normalizedSegment = segment.normalize("NFC");
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment.endsWith(".") ||
      segment.endsWith(" ") ||
      CONTROL_CHARACTER.test(segment) ||
      SURROGATE_CODE_POINT.test(segment) ||
      INVALID_PORTABLE_PATH_CHARACTERS.test(segment) ||
      WINDOWS_RESERVED_PATH_SEGMENT.test(normalizedSegment) ||
      hasNonPortableUnicodeCaseOrCompatibility(normalizedSegment)
    ) {
      throw portableArtifactPathError(field, kind);
    }
  }
  return value;
}

/**
 * Validate a physical artifact path that is also projected into a browser URL.
 * `#` and `%` have URL-level meaning and cannot be round-tripped from a raw
 * manifest path without an explicit encoding contract.
 */
export function assertPortableRelativeBrowserArtifactPath(
  value: unknown,
  field: string,
): string {
  const fileName = assertPortableRelativeArtifactPath(
    value,
    field,
    "browser artifact path",
  );
  if (AMBIGUOUS_BROWSER_PATH_CHARACTER.test(fileName)) {
    throw new Error(
      `[evjs] ${field} must not contain "#" or "%" because physical browser artifact paths are projected into URLs without an independent URL identity.`,
    );
  }
  return fileName;
}

/** Key used by case-insensitive, Unicode-normalizing file systems. */
export function canonicalPortableArtifactPathKey(value: string): string {
  return value.normalize("NFC").toLowerCase().normalize("NFC");
}

/**
 * Whether two physical file reservations collide or require one file to be an
 * ancestor directory of the other on a portable file system.
 */
export function portableArtifactPathsConflict(
  left: string,
  right: string,
): boolean {
  const leftKey = canonicalPortableArtifactPathKey(left);
  const rightKey = canonicalPortableArtifactPathKey(right);
  return (
    leftKey === rightKey ||
    leftKey.startsWith(`${rightKey}/`) ||
    rightKey.startsWith(`${leftKey}/`)
  );
}

function portableArtifactPathError(field: string, kind: string): Error {
  return new Error(
    `[evjs] ${field} must be a non-empty portable ${kind} using forward slashes, without empty, "." or ".." path segments, control or surrogate characters, non-ASCII case variants or compatibility-normalized characters, Windows reserved names, invalid <>:"|?* characters, or trailing spaces and dots.`,
  );
}

function hasNonPortableUnicodeCaseOrCompatibility(segment: string): boolean {
  if (segment.normalize("NFKC") !== segment) return true;
  for (const codePoint of segment) {
    if (
      (codePoint.codePointAt(0) ?? 0) > 0x7f &&
      codePoint.toLowerCase() !== codePoint.toUpperCase()
    ) {
      return true;
    }
  }
  return false;
}
