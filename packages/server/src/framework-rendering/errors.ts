import { textResponse } from "../shared/responses.js";
import { formatUnknownError } from "../shared/validation.js";

const INTERNAL_SERVER_ERROR_MESSAGE = "Internal server error";

export function createFrameworkErrorResponse(
  source: string,
  error: unknown,
): Response {
  return textResponse(reportFrameworkError(source, error), 500);
}

export function reportFrameworkError(source: string, error: unknown): string {
  if (shouldExposeFrameworkErrorDetails()) {
    return `[evjs] ${source}: ${formatUnknownError(error)}`;
  }

  console.error(`[evjs] ${source}:`, error);
  return INTERNAL_SERVER_ERROR_MESSAGE;
}

function shouldExposeFrameworkErrorDetails(): boolean {
  if (typeof process === "undefined") return false;
  return (
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  );
}
