import { findBestPageRoute } from "@evjs/shared";
import {
  type ClientRuntime,
  getClientRuntimeRoutes,
} from "../runtime-config.js";
import type { ActivationRequest } from "./types.js";

export function createActivationRequestFromUrl(
  runtime: ClientRuntime,
  url: string | URL,
): ActivationRequest {
  const href = url.toString();
  const pathname = getPathname(href);
  const route = findBestPageRoute(getClientRuntimeRoutes(runtime), pathname);

  return {
    url: href,
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
