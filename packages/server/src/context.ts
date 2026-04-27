import { tryGetContext } from "hono/context-storage";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
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

function resolveWaitUntil(c: ReturnType<typeof requireContext>) {
  let executionCtx:
    | { waitUntil?: (promise: Promise<unknown>) => void }
    | undefined;
  try {
    executionCtx = c.executionCtx as typeof executionCtx;
  } catch {
    // Hono's c.executionCtx throws an error when not running in Cloudflare/Fetch event.
  }

  if (executionCtx?.waitUntil) {
    return (p: Promise<unknown>) => executionCtx.waitUntil?.(p);
  }

  return (p: Promise<unknown>) => {
    // Node.js fallback: avoid unhandled rejections when no runtime waitUntil exists.
    p.catch((err) => console.error("Unhandled waitUntil error:", err));
  };
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
 * Access the incoming Cookies of the current request globally.
 */
export function cookies() {
  const c = requireContext();

  return {
    /** Get a cookie by name */
    get(name: string): string | undefined {
      return getCookie(c, name);
    },
    /** Get all parsed cookies */
    getAll(): HonoCookie {
      return getCookie(c);
    },
    /** Check if a cookie exists */
    has(name: string): boolean {
      return getCookie(c, name) !== undefined;
    },
    /** Set a cookie in the HTTP response */
    set(name: string, value: string, options?: CookieOptions): void {
      setCookie(c, name, value, options);
    },
    /** Delete a cookie from the client */
    delete(
      name: string,
      options?: Omit<CookieOptions, "maxAge" | "expires">,
    ): void {
      deleteCookie(c, name, options);
    },
  };
}

/**
 * Push a background task that shouldn't block the request response.
 * (Compatible with Cloudflare 'waitUntil' / Node detached promises).
 */
export function waitUntil(promise: Promise<unknown>): void {
  resolveWaitUntil(getContext())(promise);
}
