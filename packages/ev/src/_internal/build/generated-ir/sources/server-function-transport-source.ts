import type { BuildPlan } from "@evjs/shared/manifest";

export const SERVER_FUNCTION_TRANSPORT_FILE =
  "./.ev/framework/server-function-transport.ts";

export function needsServerFunctionTransport(plan: BuildPlan): boolean {
  const transport = plan.runtime.transport;
  return (
    transport !== undefined &&
    (transport.baseUrl !== undefined ||
      transport.credentials !== undefined ||
      transport.headers !== undefined) &&
    plan.entries.some(
      (entry) =>
        entry.metadata?.type === "server-app" &&
        (entry.metadata.serverFunctions?.length ?? 0) > 0,
    )
  );
}

/** A dependency module initializes transport before business imports evaluate. */
export function createServerFunctionTransportSource(plan: BuildPlan): string {
  return [
    'import { initTransportFromRuntime } from "@evjs/client/internal/server-functions";',
    `initTransportFromRuntime(${JSON.stringify({ runtime: { transport: plan.runtime.transport } })});`,
    "",
  ].join("\n");
}
