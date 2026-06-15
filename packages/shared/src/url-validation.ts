export interface UrlValidationBase {
  toString(): string;
}

export interface UrlObjectValidationBase extends UrlValidationBase {
  protocol: string;
}

declare const URL: {
  new (
    value: string,
    base?: string | UrlValidationBase,
  ): UrlValidationBase & {
    protocol: string;
  };
};

export type UrlStringValidationError = "empty" | "whitespace" | "invalid-url";

export interface UrlStringValidationOptions {
  baseUrl?: string | UrlValidationBase;
}

const URL_OR_PATH_VALIDATION_BASE = "http://evjs.local/";

export function getUrlStringValidationError(
  value: unknown,
  options: UrlStringValidationOptions = {},
): UrlStringValidationError | undefined {
  if (typeof value !== "string" || !value.trim()) return "empty";
  if (value.trim() !== value) return "whitespace";

  try {
    new URL(value, options.baseUrl);
  } catch {
    return "invalid-url";
  }

  return undefined;
}

export type AbsoluteHttpUrlValidationError =
  | "empty"
  | "whitespace"
  | "not-absolute-http-url";

export function getAbsoluteHttpUrlValidationError(
  value: unknown,
): AbsoluteHttpUrlValidationError | undefined {
  if (typeof value !== "string" || !value.trim()) return "empty";
  if (value.trim() !== value) return "whitespace";

  let parsed: { protocol: string };
  try {
    parsed = new URL(value);
  } catch {
    return "not-absolute-http-url";
  }

  return parsed.protocol === "http:" || parsed.protocol === "https:"
    ? undefined
    : "not-absolute-http-url";
}

export type HttpUrlOrPathValidationError =
  | "empty"
  | "whitespace"
  | "not-http-url-or-path";

export function getHttpUrlOrPathValidationError(
  value: unknown,
): HttpUrlOrPathValidationError | undefined {
  if (typeof value !== "string" || !value.trim()) return "empty";
  if (value.trim() !== value) return "whitespace";

  return canResolveToHttpUrl(value, URL_OR_PATH_VALIDATION_BASE)
    ? undefined
    : "not-http-url-or-path";
}

export type HttpUrlOrAbsolutePathnameValidationError =
  | "empty"
  | "whitespace"
  | "not-http-url-or-absolute-pathname";

export function getHttpUrlOrAbsolutePathnameValidationError(
  value: unknown,
): HttpUrlOrAbsolutePathnameValidationError | undefined {
  if (isUrlObjectValidationBase(value)) {
    return isHttpProtocol(value.protocol)
      ? undefined
      : "not-http-url-or-absolute-pathname";
  }
  if (typeof value !== "string" || !value.trim()) return "empty";
  if (value.trim() !== value) return "whitespace";
  if (value.startsWith("/")) return undefined;

  return canResolveToHttpUrl(value)
    ? undefined
    : "not-http-url-or-absolute-pathname";
}

function canResolveToHttpUrl(value: string, base?: string): boolean {
  try {
    const parsed = new URL(value, base);
    return isHttpProtocol(parsed.protocol);
  } catch {
    return false;
  }
}

function isHttpProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

function isUrlObjectValidationBase(
  value: unknown,
): value is UrlObjectValidationBase {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as UrlObjectValidationBase).toString === "function" &&
    typeof (value as UrlObjectValidationBase).protocol === "string"
  );
}
