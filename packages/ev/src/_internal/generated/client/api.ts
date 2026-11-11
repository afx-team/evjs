import { createFrameworkApiClient } from "@evjs/client/internal/http-api";

/** Replaced by the application-owned module for framework browser builds. */
export const apiRuntimeScope = Object.freeze({
  buildId: "unbound",
  applicationId: "unbound",
});

export const api = createFrameworkApiClient(apiRuntimeScope, {}, () => {
  throw new Error(
    "[evjs] api is available in framework browser builds. Use createApiClient() from @evjs/client/http-api for standalone HTTP requests.",
  );
});
