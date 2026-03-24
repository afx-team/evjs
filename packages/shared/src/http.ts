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

/** Union type of supported HTTP methods. */
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Type guard: returns true if value is a valid HTTP method. */
export function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value.toUpperCase());
}
