/**
 * Health check route handler.
 *
 * Demonstrates a dedicated HEAD probe alongside a JSON GET handler.
 */

import { withMiddlewares } from "@evjs/ev/api";
import { apiPolicies } from "../policies";

export const GET = withMiddlewares(async () => {
  return Response.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}, apiPolicies);

export const HEAD = withMiddlewares(
  () =>
    new Response(null, { status: 204, headers: { "x-health-probe": "head" } }),
  apiPolicies,
);
