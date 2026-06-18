import { findBestPageRoute } from "@evjs/shared";
import type { BuildOutput } from "@evjs/shared/manifest";
import type { ActivationRequest } from "./types.js";

export function createActivationRequestFromUrl(
  manifest: BuildOutput,
  url: string | URL,
): ActivationRequest {
  const href = url.toString();
  const pathname = getPathname(href);
  const route = findBestPageRoute(manifest.routes, pathname);

  return {
    url: href,
    appId: route?.appId,
    pageId: route?.pageId,
  };
}

function getPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.startsWith("/") ? url.split(/[?#]/, 1)[0] : "/";
  }
}
