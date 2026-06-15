/**
 * HTTP method utilities shared across the ev runtime.
 */

/** Supported HTTP methods for route handlers. */
export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export const HTTP_METHOD_LIST_DESCRIPTION = HTTP_METHODS.join(", ");
export const APPLICATION_JSON_CONTENT_TYPE = "application/json";
export const TEXT_HTML_CONTENT_TYPE = "text/html";
export const TEXT_PLAIN_CONTENT_TYPE = "text/plain";
export const RSC_FLIGHT_CONTENT_TYPE = "text/x-component";
export const TEXT_HTML_UTF8_CONTENT_TYPE = `${TEXT_HTML_CONTENT_TYPE}; charset=utf-8`;
export const TEXT_PLAIN_UTF8_CONTENT_TYPE = `${TEXT_PLAIN_CONTENT_TYPE}; charset=utf-8`;

/** Union type of supported HTTP methods. */
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Type guard: returns true if value is an integer HTTP error status. */
export function isHttpErrorStatus(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 400 &&
    value <= 599
  );
}

/** Type guard: returns true if value is an HTTP status that can include a body. */
export function isHttpBodyStatus(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 200 &&
    value <= 599 &&
    value !== 204 &&
    value !== 205 &&
    value !== 304
  );
}

/** Type guard: returns true if value can be passed to the Headers constructor. */
export function isHeadersInit(value: unknown): boolean {
  if (value === null) return false;
  const HeadersConstructor = (
    globalThis as {
      Headers?: new (init?: unknown) => unknown;
    }
  ).Headers;
  if (!HeadersConstructor) return false;
  try {
    new HeadersConstructor(value);
    return true;
  } catch {
    return false;
  }
}

/** Type guard: returns true if value is the application/json media type. */
export function isApplicationJsonContentType(value: unknown): value is string {
  return isContentTypeMediaType(value, APPLICATION_JSON_CONTENT_TYPE);
}

/** Format a Content-Type header value for diagnostics. */
export function formatContentTypeHeaderValue(value: string | null): string {
  return value === null ? "missing Content-Type" : `"${value}"`;
}

/** Type guard: returns true if value is the text/html media type. */
export function isTextHtmlContentType(value: unknown): value is string {
  return isContentTypeMediaType(value, TEXT_HTML_CONTENT_TYPE);
}

/** Type guard: returns true if value is the React Flight media type. */
export function isRscFlightContentType(value: unknown): value is string {
  return isContentTypeMediaType(value, RSC_FLIGHT_CONTENT_TYPE);
}

/** Type guard: returns true if value is a valid uppercase HTTP method. */
export function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value);
}

/**
 * Normalize a string to a valid HttpMethod.
 * Returns undefined if the value is not a recognized HTTP method.
 */
export function toHttpMethod(value: string): HttpMethod | undefined {
  const upper = value.toUpperCase();
  return (HTTP_METHODS as readonly string[]).includes(upper)
    ? (upper as HttpMethod)
    : undefined;
}

function isContentTypeMediaType(
  value: unknown,
  expected: string,
): value is string {
  if (typeof value !== "string") return false;
  const [mediaType] = value.split(";", 1);
  return mediaType.trim().toLowerCase() === expected;
}
