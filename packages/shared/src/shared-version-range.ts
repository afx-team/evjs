export const SHARED_VERSION_RANGE_DESCRIPTION =
  'supported version range syntax (examples: "19", "^19.0.0", ">=18 <20", or "^18 || ^19")';

export type SharedVersionRangeValidationError =
  | "empty"
  | "whitespace"
  | "invalid-range";

const VERSION_PATTERN = /^v?\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/;

export function getSharedVersionRangeValidationError(
  value: unknown,
): SharedVersionRangeValidationError | undefined {
  if (typeof value !== "string" || !value.trim()) return "empty";
  if (value.trim() !== value) return "whitespace";
  return isSupportedSharedVersionRange(value) ? undefined : "invalid-range";
}

export function isSharedVersionRange(value: unknown): value is string {
  return getSharedVersionRangeValidationError(value) === undefined;
}

function isSupportedSharedVersionRange(value: string): boolean {
  return value.split("||").every((rangePart) => {
    const trimmedRangePart = rangePart.trim();
    if (!trimmedRangePart) return false;
    return trimmedRangePart
      .split(/\s+/)
      .every((comparator) => isSupportedSharedVersionComparator(comparator));
  });
}

function isSupportedSharedVersionComparator(comparator: string): boolean {
  if (comparator === "*") return true;

  let version = comparator;
  if (version.startsWith(">=") || version.startsWith("<=")) {
    version = version.slice(2);
  } else if (
    version.startsWith(">") ||
    version.startsWith("<") ||
    version.startsWith("^") ||
    version.startsWith("~")
  ) {
    version = version.slice(1);
  }

  return VERSION_PATTERN.test(version);
}
