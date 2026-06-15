import {
  comparePathPatternMatches,
  findBestPageRoute,
  findBestPathPatternMatch,
  type PathPatternMatch,
} from "@evjs/shared";
import type { BuildOutput, RemoteManifest } from "@evjs/shared/manifest";
import type { ActivationRequest } from "./types.js";

export function findRemoteIdForPath(
  remotes: BuildOutput["remotes"],
  pathname: string | undefined,
): string | undefined {
  if (!pathname) return undefined;

  let best: { id: string; match: PathPatternMatch } | undefined;
  for (const [id, remote] of Object.entries(remotes ?? {})) {
    const match = findBestPathPatternMatch(pathname, remote.activeWhen);
    if (match && isBetterIdMatch(id, match, best)) {
      best = { id, match };
    }
  }

  return best?.id;
}

export function createActivationRequestFromUrl(
  manifest: BuildOutput,
  url: string | URL,
): ActivationRequest {
  const href = url.toString();
  const pathname = getPathname(href);
  const remoteId = findRemoteIdForPath(manifest.remotes, pathname);
  if (remoteId) {
    return {
      url: href,
      remoteId,
    };
  }

  const route = findBestPageRoute(manifest.routes, pathname);

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
    let best: { id: string; match: PathPatternMatch } | undefined;
    for (const [id, entry] of Object.entries(manifest.entries)) {
      const match = findBestPathPatternMatch(pathname, entry.activeWhen);
      if (match && isBetterIdMatch(id, match, best)) {
        best = { id, match };
      }
    }
    if (best) return best.id;
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
  return Boolean(findBestPathPatternMatch(pathname, patterns));
}

export function resolveRemoteHref(baseUrl: string, href: string): string {
  return new URL(href, ensureTrailingSlash(baseUrl)).toString();
}

function getPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.startsWith("/") ? url.split(/[?#]/, 1)[0] : "/";
  }
}

function isBetterIdMatch(
  id: string,
  match: PathPatternMatch,
  current: { id: string; match: PathPatternMatch } | undefined,
): boolean {
  if (!current) return true;
  const comparison = comparePathPatternMatches(match, current.match);
  if (comparison !== 0) return comparison > 0;
  return id < current.id;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
