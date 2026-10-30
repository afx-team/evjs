import {
  assertClientRuntimeTransport,
  type ClientRuntimeTransport,
} from "../shared/runtime-config.js";
import { createApiClient, createLazyApiClient } from "./client.js";
import type { ApiClient } from "./types.js";

export interface ApiRuntimeScope {
  buildId: string;
  applicationId: string;
}

declare global {
  // Hosting bootstraps register before evaluating the application modules.
  var __EVJS_APP_TRANSPORTS__:
    | Record<string, ClientRuntimeTransport>
    | undefined;
}

export function readApplicationTransport(
  scope: ApiRuntimeScope,
): ClientRuntimeTransport | undefined {
  const key = JSON.stringify([scope.buildId, scope.applicationId]);
  const registry = globalThis.__EVJS_APP_TRANSPORTS__;
  if (!registry || !Object.hasOwn(registry, key)) return undefined;
  const value = registry[key];
  assertClientRuntimeTransport(value, `application transport ${key}`);
  return value;
}

/** The generated module owns this instance, even when runtime packages are shared. */
export function createFrameworkApiClient(
  scope: ApiRuntimeScope,
  transport: ClientRuntimeTransport = {},
  resolveDefaults: (
    scope: ApiRuntimeScope,
  ) => ClientRuntimeTransport | undefined = readApplicationTransport,
): ApiClient {
  // Capture defaults during module evaluation, before consumer modules run.
  // A missing browser bootstrap must not prevent SSR from importing a Page;
  // report configuration failures only when that Page attempts an API request.
  try {
    const overrides = { ...transport, headers: new Headers(transport.headers) };
    const defaults = resolveDefaults(scope);
    const headers = new Headers(defaults?.headers);
    overrides.headers.forEach((value, key) => {
      headers.set(key, value);
    });
    return createApiClient({
      baseUrl: overrides.baseUrl ?? defaults?.baseUrl,
      credentials: overrides.credentials ?? defaults?.credentials,
      headers,
    });
  } catch (error) {
    return createLazyApiClient(() => {
      throw error;
    });
  }
}
