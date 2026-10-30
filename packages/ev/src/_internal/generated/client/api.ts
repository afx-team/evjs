import { createFrameworkApiClient } from "@evjs/client/internal/http-api";

/** Replaced by the application-owned module for framework browser builds. */
export const api = createFrameworkApiClient(
  { buildId: "unbound", applicationId: "unbound" },
  {},
  () => {
    throw new Error(
      "[evjs] api is available in framework browser builds. Use createApiClient() from @evjs/client/http-api for standalone HTTP requests.",
    );
  },
);
