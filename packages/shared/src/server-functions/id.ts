const SERVER_FUNCTION_ID_MESSAGE =
  "must be a non-empty string without leading or trailing whitespace.";

const SERVER_FUNCTION_EXPORT_NAME_MESSAGE =
  "must be a non-empty string without leading or trailing whitespace.";

export function isServerFunctionId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.trim() === value
  );
}

export function isServerFunctionExportName(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.trim() === value
  );
}

export function assertServerFunctionId(
  value: unknown,
  apiName: string,
): asserts value is string {
  if (!isServerFunctionId(value)) {
    throw new Error(`[evjs] ${apiName} fnId ${SERVER_FUNCTION_ID_MESSAGE}`);
  }
}

export function assertServerFunctionExportName(
  value: unknown,
  apiName: string,
): asserts value is string {
  if (!isServerFunctionExportName(value)) {
    throw new Error(
      `[evjs] ${apiName} exportName ${SERVER_FUNCTION_EXPORT_NAME_MESSAGE}`,
    );
  }
}

export function getRequestFnId(value: unknown): string {
  return typeof value === "string" ? value : "";
}
