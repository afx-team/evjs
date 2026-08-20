const ABSOLUTE_URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

export interface RscFlightUrlBase {
  toString(): string;
}

export interface RscFlightRequestUrl extends RscFlightUrlBase {
  origin: string;
  searchParams: {
    get(name: string): string | null;
  };
}

interface RscFlightParsedUrl extends RscFlightRequestUrl {
  protocol: string;
  pathname: string;
  search: string;
  hash: string;
}

declare const URL: {
  new (value: string, base?: string | RscFlightUrlBase): RscFlightParsedUrl;
};

export type RscFlightClientPageUrlParamError =
  | "empty-or-whitespace"
  | "not-absolute-path-or-url"
  | "invalid-url"
  | "hash"
  | "cross-origin";

export interface RscFlightClientPageUrlParamOptions {
  explicit: boolean;
  locationHref?: string;
  requestUrl: RscFlightUrlBase | string;
}

export interface RscFlightClientPageUrlParamResult {
  value?: string;
  error?: RscFlightClientPageUrlParamError;
}

export function getRscFlightClientPageUrlParam(
  value: string,
  options: RscFlightClientPageUrlParamOptions,
): RscFlightClientPageUrlParamResult {
  if (options.explicit) {
    const inputError = getExplicitRscFlightPageUrlInputError(value);
    if (inputError) return { error: inputError };
  }

  try {
    const url = new URL(value, options.requestUrl);
    if (options.explicit && !isHttpUrlProtocol(url.protocol)) {
      return { error: "not-absolute-path-or-url" };
    }
    if (options.explicit && url.hash) return { error: "hash" };

    const expectedOrigin = getExpectedRscFlightOrigin(options);
    if (expectedOrigin && url.origin !== expectedOrigin) {
      return { error: "cross-origin" };
    }

    return { value: `${url.pathname}${url.search}` };
  } catch {
    return options.explicit ? { error: "invalid-url" } : {};
  }
}

function getExplicitRscFlightPageUrlInputError(
  value: string,
): RscFlightClientPageUrlParamError | undefined {
  if (!value || value.trim() !== value) return "empty-or-whitespace";
  if (value.startsWith("//")) return "not-absolute-path-or-url";
  if (value.startsWith("/")) return undefined;
  if (ABSOLUTE_URL_SCHEME_RE.test(value)) return undefined;
  return "not-absolute-path-or-url";
}

function isHttpUrlProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

function getExpectedRscFlightOrigin(
  options: RscFlightClientPageUrlParamOptions,
): string | undefined {
  if (!options.explicit) return undefined;

  const base = options.locationHref ?? options.requestUrl.toString();
  const url = new URL(base);
  return isHttpUrlProtocol(url.protocol) ? url.origin : undefined;
}

export type RscFlightRequestPageUrlError =
  | "not-absolute-path"
  | "invalid-path"
  | "cross-origin-or-hash";

export interface RscFlightRequestPageUrlResult {
  value?: string;
  error?: RscFlightRequestPageUrlError;
}

export function resolveRscFlightRequestPageUrl(
  requestUrl: RscFlightRequestUrl,
): RscFlightRequestPageUrlResult {
  const raw = requestUrl.searchParams.get("url");
  if (raw === null) return {};

  if (
    !raw ||
    raw.trim() !== raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//")
  ) {
    return { error: "not-absolute-path" };
  }

  let pageUrl: RscFlightParsedUrl;
  try {
    pageUrl = new URL(raw, requestUrl);
  } catch {
    return { error: "invalid-path" };
  }

  if (pageUrl.origin !== requestUrl.origin || pageUrl.hash) {
    return { error: "cross-origin-or-hash" };
  }

  return { value: pageUrl.toString() };
}
