export const BUILD_IDENTIFIER_DESCRIPTION =
  "letters, numbers, underscores, or hyphens";

const BUILD_IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function isBuildIdentifier(value: unknown): value is string {
  return typeof value === "string" && BUILD_IDENTIFIER_PATTERN.test(value);
}
