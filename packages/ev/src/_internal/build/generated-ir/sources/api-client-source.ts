import type { BuildPlan, CoreGraph } from "@evjs/shared/manifest";

export const API_CLIENT_MODULE = "@evjs/ev/_internal/client/api";
export const API_CLIENT_FILE = "./.ev/framework/api-client.ts";

/** Runtime binding only: HTTP handlers and DTOs are never imported or scanned. */
export function createApiClientSource(
  graph: CoreGraph,
  plan: BuildPlan,
): string {
  const applications = Object.keys(graph.applications);
  return [
    'import { createFrameworkApiClient } from "@evjs/client/internal/http-api";',
    'import { resolveApiTransport } from "@evjs/ev/_internal/client/api-transport";',
    `export const api = createFrameworkApiClient(${JSON.stringify({ buildId: plan.buildId, applicationId: applications[0] ?? "app" })}, ${JSON.stringify(plan.runtime.transport ?? {})}, resolveApiTransport);`,
    "",
  ].join("\n");
}
