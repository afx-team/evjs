import { ApiError } from "./error.js";
import type {
  ApiCall,
  ApiClient,
  ApiClientOptions,
  ApiMethod,
  ApiRequestOptions,
} from "./types.js";

export const API_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
] as const satisfies readonly ApiMethod[];

/** Create an HTTP client with an isolated snapshot of its transport defaults. */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const snapshot = { ...options, headers: new Headers(options.headers) };
  return createLazyApiClient(() => snapshot);
}

/** Resolve framework defaults inside the request promise, before any network I/O. */
export function createLazyApiClient(
  resolveOptions: () => ApiClientOptions,
): ApiClient {
  let snapshot: ApiClientOptions | undefined;

  function call(
    method: ApiMethod,
    path: string,
    options: ApiRequestOptions = {},
  ): ApiCall {
    let requestUrl = path;
    const response = (async () => {
      if (!snapshot) {
        const defaults = resolveOptions();
        snapshot = { ...defaults, headers: new Headers(defaults.headers) };
      }
      const { baseUrl, credentials, fetch: fetchImpl } = snapshot;
      requestUrl = resolveApiUrl(baseUrl, path);
      const { json, body, headers, ...init } = options;
      if ("json" in options && body !== undefined) {
        throw new TypeError(
          "[evjs] API request json and body are mutually exclusive.",
        );
      }
      const mergedHeaders = new Headers(snapshot.headers);
      new Headers(headers).forEach((value, name) => {
        mergedHeaders.set(name, value);
      });
      let requestBody = body;
      if ("json" in options) {
        requestBody = JSON.stringify(json);
        if (requestBody === undefined) {
          throw new TypeError(
            "[evjs] API request json must be JSON serializable.",
          );
        }
        if (!mergedHeaders.has("content-type")) {
          mergedHeaders.set("content-type", "application/json");
        }
      }
      return (fetchImpl ?? globalThis.fetch).call(globalThis, requestUrl, {
        ...init,
        method: method.toUpperCase(),
        headers: mergedHeaders,
        credentials: init.credentials ?? credentials,
        body: requestBody,
      });
    })() as ApiCall;
    response.json = async <T = unknown>(): Promise<T> => {
      const result = await response;
      const url = result.url || requestUrl;
      if (!result.ok) {
        throw new ApiError(
          `[evjs] API request failed: ${result.status} ${url}`,
          result,
          url,
        );
      }
      const contentType =
        result.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
      if (!/^application\/(?:[\w!#$&^.+-]+\+)?json$/i.test(contentType)) {
        throw new ApiError(
          `[evjs] Expected a JSON API response from ${url}; received ${contentType || "no Content-Type"}.`,
          result,
          url,
        );
      }
      return result.json() as Promise<T>;
    };
    return response;
  }

  return Object.freeze(
    Object.fromEntries(
      API_METHODS.map((method) => [
        method,
        (path: string, options?: ApiRequestOptions) =>
          call(method, path, options),
      ]),
    ),
  ) as ApiClient;
}

/** A route path is relative to the application API root, never the Page URL. */
function resolveApiUrl(baseUrl: string | undefined, path: string): string {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    [...path].some((char) => char.charCodeAt(0) <= 32)
  ) {
    throw new TypeError(
      "[evjs] API paths must start with a single / and contain no backslashes or unescaped whitespace.",
    );
  }
  const origin =
    typeof location !== "undefined" && /^https?:$/.test(location.protocol)
      ? location.origin
      : "http://evjs.local";
  const route = new URL(path, origin);
  const base = new URL(baseUrl ?? "/", origin);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new TypeError("[evjs] API baseUrl must use HTTP or HTTPS.");
  }
  // Resolve dot segments inside the application path before appending it. A
  // leading slash must not discard the gateway's deployment/version prefix.
  base.pathname = `${base.pathname.replace(/\/+$/, "")}${route.pathname}`;
  base.search = route.search || base.search;
  base.hash = "";
  return baseUrl && /^(?:[a-z][\w+.-]*:|\/\/)/i.test(baseUrl)
    ? base.href
    : `${base.pathname}${base.search}`;
}
