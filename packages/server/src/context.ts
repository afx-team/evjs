import { tryGetContext } from "hono/context-storage";
import {
  deleteCookie as honoDeleteCookie,
  getCookie as honoGetCookie,
  setCookie as honoSetCookie,
} from "hono/cookie";
import type { Env } from "hono/types";
import type { CookieOptions, Cookie as HonoCookie } from "hono/utils/cookie";

function requireContext<E extends Env = Env>() {
  const c = tryGetContext<E>();
  if (!c) {
    throw new Error(
      "Server context hooks (like headers(), request()) must be called within a request lifecycle. E.g. inside a Server Function or Route.",
    );
  }
  return c;
}

/**
 * Retrieve the current Hono context.
 * Throws an error if called outside of a request lifecycle.
 */
export function getContext<E extends Env = Env>() {
  return requireContext<E>();
}

/**
 * Access the current Web Request object globally.
 */
export function request(): Request {
  return getContext().req.raw;
}

/**
 * Access the incoming Headers of the current request globally.
 */
export function headers(): Headers {
  return request().headers;
}

/**
 * Read a cookie from the incoming request.
 * If no name is provided, returns an object with all parsed cookies.
 */
export function getCookie(name: string): string | undefined;
export function getCookie(): HonoCookie;
export function getCookie(name?: string): string | HonoCookie | undefined {
  const c = requireContext();
  return name ? honoGetCookie(c, name) : honoGetCookie(c);
}

/**
 * Set a cookie in the outgoing response.
 */
export function setCookie(
  name: string,
  value: string,
  options?: CookieOptions,
): void {
  honoSetCookie(requireContext(), name, value, options);
}

/**
 * Delete a cookie from the outgoing response.
 */
export function deleteCookie(
  name: string,
  options?: Omit<CookieOptions, "maxAge" | "expires">,
): void {
  honoDeleteCookie(requireContext(), name, options);
}

/**
 * Push a background task that shouldn't block the request response.
 * (Compatible with Cloudflare 'waitUntil' / Node detached promises).
 */
export function waitUntil(promise: Promise<unknown>): void {
  const c = getContext();

  let executionCtx: { waitUntil?: (p: Promise<unknown>) => void } | undefined;
  try {
    executionCtx = c.executionCtx as typeof executionCtx;
  } catch {
    // Hono's c.executionCtx throws an error when not running in Cloudflare/Fetch event.
  }

  if (executionCtx?.waitUntil) {
    executionCtx.waitUntil(promise);
  } else {
    // Node.js fallback: avoid unhandled rejections when no runtime waitUntil exists.
    promise.catch((err) => console.error("Unhandled waitUntil error:", err));
  }
}
