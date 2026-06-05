import type { BuildOutput, RemoteManifest } from "@evjs/shared/manifest";
import type { ActivationRequest } from "./types.js";

export function findRemoteIdForPath(
  remotes: BuildOutput["remotes"],
  pathname: string | undefined,
): string | undefined {
  if (!pathname) return undefined;

  for (const [id, remote] of Object.entries(remotes ?? {})) {
    if (matchesAnyPattern(pathname, remote.activeWhen)) {
      return id;
    }
  }

  return undefined;
}

export function createActivationRequestFromUrl(
  manifest: BuildOutput,
  url: string | URL,
): ActivationRequest {
  const href = url.toString();
  const pathname = getPathname(href);
  const route = manifest.routes.find((candidate) =>
    routePathMatches(candidate.path, pathname),
  );

  return {
    url: href,
    appId: route?.appId,
    pageId: route?.pageId,
  };
}

export function resolveRemoteEntryId(
  manifest: RemoteManifest,
  request: ActivationRequest,
  pathname: string | undefined,
): string {
  if (request.remoteEntryId) {
    if (manifest.entries[request.remoteEntryId]) return request.remoteEntryId;
    throw new Error(
      `[evjs] Remote entry "${request.remoteEntryId}" is not in remote "${manifest.name}".`,
    );
  }

  if (pathname) {
    for (const [id, entry] of Object.entries(manifest.entries)) {
      if (matchesAnyPattern(pathname, entry.activeWhen)) return id;
    }
  }

  if (manifest.entries.default) return "default";

  const firstEntryId = Object.keys(manifest.entries)[0];
  if (firstEntryId) return firstEntryId;

  throw new Error(`[evjs] Remote "${manifest.name}" has no entries.`);
}

export function getRequestPathname(
  request: ActivationRequest,
): string | undefined {
  if (!request.url) return undefined;
  if (request.url instanceof URL) return request.url.pathname;

  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url.startsWith("/")
      ? request.url.split(/[?#]/, 1)[0]
      : undefined;
  }
}

export function matchesAnyPattern(
  pathname: string,
  patterns: string[] | undefined,
): boolean {
  return (
    patterns?.some((pattern) => matchesPattern(pathname, pattern)) ?? false
  );
}

export function resolveRemoteHref(baseUrl: string, href: string): string {
  return new URL(href, ensureTrailingSlash(baseUrl)).toString();
}

function routePathMatches(routePath: string, pathname: string): boolean {
  const routeSegments = splitPath(routePath);
  const pathSegments = splitPath(pathname);
  if (routeSegments.length !== pathSegments.length) {
    if (routePath.endsWith("/*")) {
      const prefix = routePath.slice(0, -2);
      return pathname === prefix || pathname.startsWith(`${prefix}/`);
    }
    return false;
  }

  return routeSegments.every((segment, index) => {
    const value = pathSegments[index];
    return (
      segment === value ||
      segment.startsWith("$") ||
      segment.startsWith(":") ||
      segment === "*"
    );
  });
}

function splitPath(pathname: string): string[] {
  return normalizePathname(pathname).split("/").filter(Boolean);
}

function normalizePathname(pathname: string): string {
  if (!pathname.startsWith("/")) return normalizePathname(`/${pathname}`);
  if (pathname.length === 1) return pathname;
  return pathname.replace(/\/+$/, "");
}

function getPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.startsWith("/") ? url.split(/[?#]/, 1)[0] : "/";
  }
}

function matchesPattern(pathname: string, pattern: string): boolean {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  }

  if (!pattern.includes("*")) return pathname === pattern;

  const expression = pattern.split("*").map(escapeRegExp).join(".*");
  return new RegExp(`^${expression}$`).test(pathname);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
