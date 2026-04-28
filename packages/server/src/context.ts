import { tryGetContext } from "hono/context-storage";
import {
  generateCookie,
  generateSignedCookie,
  deleteCookie as honoDeleteCookie,
  getCookie as honoGetCookie,
  getSignedCookie as honoGetSignedCookie,
  setCookie as honoSetCookie,
  setSignedCookie as honoSetSignedCookie,
} from "hono/cookie";
import type { Env } from "hono/types";
import type {
  Cookie,
  CookieOptions,
  CookiePrefixOptions,
  SignedCookie,
} from "hono/utils/cookie";

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
export function getCookie(
  name: string,
  prefixOptions?: CookiePrefixOptions,
): string | undefined;
export function getCookie(): Cookie;
export function getCookie(
  name?: string,
  prefixOptions?: CookiePrefixOptions,
): string | Cookie | undefined {
  const c = requireContext();
  if (name !== undefined) {
    return honoGetCookie(c, name, prefixOptions);
  }
  return honoGetCookie(c);
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
  options?: CookieOptions,
): string | undefined {
  return honoDeleteCookie(requireContext(), name, options);
}

/**
 * Read a signed cookie from the incoming request.
 */
export function getSignedCookie(
  secret: string | BufferSource,
  key: string,
  prefixOptions?: CookiePrefixOptions,
): Promise<string | undefined | false>;
export function getSignedCookie(
  secret: string | BufferSource,
): Promise<SignedCookie>;
export function getSignedCookie(
  secret: string | BufferSource,
  key?: string,
  prefixOptions?: CookiePrefixOptions,
): Promise<string | undefined | false | SignedCookie> {
  const c = requireContext();
  if (key !== undefined) {
    return honoGetSignedCookie(c, secret, key, prefixOptions);
  }
  return honoGetSignedCookie(c, secret);
}

/**
 * Set a signed cookie in the outgoing response.
 */
export function setSignedCookie(
  name: string,
  value: string,
  secret: string | BufferSource,
  options?: CookieOptions,
): Promise<void> {
  return honoSetSignedCookie(requireContext(), name, value, secret, options);
}

export { generateCookie, generateSignedCookie };

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
