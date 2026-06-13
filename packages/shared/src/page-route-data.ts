export type PageSearchParams = Record<string, string | string[]>;

export function matchPageRouteParams(
  routePath: string,
  pathname: string,
): Record<string, string> {
  const routeSegments = splitPath(routePath);
  const pathSegments = splitPath(pathname);
  const params: Record<string, string> = {};

  routeSegments.forEach((segment, index) => {
    if (!segment.startsWith("$")) return;
    const name = segment.slice(1) || "_splat";
    params[name] = safeDecodeURIComponent(pathSegments[index] ?? "");
  });

  return params;
}

export function parsePageSearch(search: string): PageSearchParams {
  const query = search.startsWith("?") ? search.slice(1) : search;
  if (!query) return {};

  const params: PageSearchParams = {};
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const separator = pair.indexOf("=");
    const rawKey = separator >= 0 ? pair.slice(0, separator) : pair;
    const rawValue = separator >= 0 ? pair.slice(separator + 1) : "";
    const key = decodeQueryValue(rawKey);
    const value = decodeQueryValue(rawValue);
    if (!key) continue;

    const current = params[key];
    if (Array.isArray(current)) {
      current.push(value);
    } else if (typeof current === "string") {
      params[key] = [current, value];
    } else {
      params[key] = value;
    }
  }

  return params;
}

function splitPath(value: string): string[] {
  return value
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
}

function decodeQueryValue(value: string): string {
  return safeDecodeURIComponent(value.replace(/\+/g, " "));
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
