export type PathPatternValidationError =
  | "empty"
  | "whitespace"
  | "missing-leading-slash"
  | "query-or-hash";

export type PathPatternListValidationError =
  | { kind: "not-array" }
  | { kind: "empty-array" }
  | {
      kind: "invalid-pattern";
      value: unknown;
      error: PathPatternValidationError;
    }
  | { kind: "duplicate-pattern"; pattern: string };

export interface PathPatternListValidationOptions {
  allowEmpty?: boolean;
}

export function getPathPatternValidationError(
  value: unknown,
): PathPatternValidationError | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return "empty";
  }
  if (/\s/.test(value)) {
    return "whitespace";
  }
  if (!value.startsWith("/")) {
    return "missing-leading-slash";
  }
  if (value.includes("?") || value.includes("#")) {
    return "query-or-hash";
  }
  return undefined;
}

export function isPathPattern(value: unknown): value is string {
  return getPathPatternValidationError(value) === undefined;
}

export function getPathPatternListValidationError(
  value: unknown,
  options: PathPatternListValidationOptions = {},
): PathPatternListValidationError | undefined {
  if (!Array.isArray(value)) return { kind: "not-array" };
  if (!options.allowEmpty && value.length === 0) {
    return { kind: "empty-array" };
  }

  const seen = new Set<string>();
  for (const item of value) {
    const error = getPathPatternValidationError(item);
    if (error !== undefined) {
      return { kind: "invalid-pattern", value: item, error };
    }
    const pattern = item as string;
    if (seen.has(pattern)) {
      return { kind: "duplicate-pattern", pattern };
    }
    seen.add(pattern);
  }

  return undefined;
}

export interface PathPatternMatch {
  pattern: string;
  exact: boolean;
  literalLength: number;
  wildcardCount: number;
}

export function pathPatternMatches(pathname: string, pattern: string): boolean {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  }

  if (!pattern.includes("*")) return pathname === pattern;

  const expression = pattern.split("*").map(escapeRegExp).join(".*");
  return new RegExp(`^${expression}$`).test(pathname);
}

export function findBestPathPatternMatch(
  pathname: string,
  patterns: Iterable<string> | undefined,
): PathPatternMatch | undefined {
  let best: PathPatternMatch | undefined;
  for (const pattern of patterns ?? []) {
    if (!pathPatternMatches(pathname, pattern)) continue;
    const match = createPathPatternMatch(pattern);
    if (isBetterPathPatternMatch(match, best)) {
      best = match;
    }
  }
  return best;
}

export function comparePathPatternMatches(
  left: PathPatternMatch,
  right: PathPatternMatch,
): number {
  if (left.exact !== right.exact) return left.exact ? 1 : -1;
  if (left.literalLength !== right.literalLength) {
    return left.literalLength - right.literalLength;
  }
  if (left.wildcardCount !== right.wildcardCount) {
    return right.wildcardCount - left.wildcardCount;
  }
  return left.pattern.length - right.pattern.length;
}

function createPathPatternMatch(pattern: string): PathPatternMatch {
  return {
    pattern,
    exact: !pattern.includes("*"),
    literalLength: pattern.replace(/\*/g, "").length,
    wildcardCount: pattern.split("*").length - 1,
  };
}

function isBetterPathPatternMatch(
  match: PathPatternMatch,
  current: PathPatternMatch | undefined,
): boolean {
  if (!current) return true;
  const comparison = comparePathPatternMatches(match, current);
  if (comparison !== 0) return comparison > 0;
  return match.pattern < current.pattern;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
