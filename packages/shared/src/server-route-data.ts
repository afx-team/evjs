export type ServerRouteParamNameValidationError = "empty" | "reserved";
export type ServerRouteParamSegmentValidationErrorKind =
  | ServerRouteParamNameValidationError
  | "duplicate";

export interface ServerRouteParamSegmentValidationError {
  segment: string;
  name: string;
  error: ServerRouteParamSegmentValidationErrorKind;
}

const RESERVED_SERVER_ROUTE_PARAM_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export function serverRoutePathShapeFromPath(routePath: string): string {
  return routePath
    .split("/")
    .map((segment) => (segment.startsWith(":") ? ":param" : segment))
    .join("/");
}

export function getServerRouteParamNameValidationError(
  name: unknown,
): ServerRouteParamNameValidationError | undefined {
  if (typeof name !== "string" || !name.trim()) return "empty";
  if (isReservedServerRouteParamName(name)) return "reserved";
  return undefined;
}

export function getServerRouteParamSegmentValidationError(
  routePath: string,
): ServerRouteParamSegmentValidationError | undefined {
  const seenNames = new Set<string>();
  for (const segment of routePath.split("/")) {
    const name = getServerRouteParamName(segment);
    if (name === undefined) continue;

    const error = getServerRouteParamNameValidationError(name);
    if (error) return { segment, name, error };
    if (seenNames.has(name)) return { segment, name, error: "duplicate" };
    seenNames.add(name);
  }
  return undefined;
}

export function isReservedServerRouteParamName(name: string): boolean {
  return RESERVED_SERVER_ROUTE_PARAM_NAMES.has(name);
}

function getServerRouteParamName(segment: string): string | undefined {
  if (!segment.startsWith(":")) return undefined;

  const patternStart = segment.indexOf("{", 1);
  const rawName = segment.slice(
    1,
    patternStart === -1 ? undefined : patternStart,
  );
  return rawName.endsWith("?") ? rawName.slice(0, -1) : rawName;
}
