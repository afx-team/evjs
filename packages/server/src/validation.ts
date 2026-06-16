export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function formatUnknownError(error: unknown): string {
  return sanitizeDiagnosticText(
    error instanceof Error ? error.message : String(error),
  );
}

export function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/file:\/\/\/[^\s"'<>)]*/g, "[redacted-file-url]")
    .replace(
      /(?:\/(?:Users|home|private|tmp)\/[^\s"'<>)]*)/g,
      "[redacted-path]",
    )
    .replace(/[A-Za-z]:\\[^\s"'<>)]*/g, "[redacted-path]");
}
