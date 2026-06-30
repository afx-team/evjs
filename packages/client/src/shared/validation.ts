export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function formatErrorDetail(error: unknown): string {
  return error instanceof Error && error.message ? `: ${error.message}` : ".";
}
