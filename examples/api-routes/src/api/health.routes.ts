/**
 * Health check route handler.
 *
 * Demonstrates a minimal single-method route handler.
 */

import { createRoute } from "@evjs/ev/server";

export const healthHandler = createRoute("/api/health", {
  GET: async () => {
    return Response.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  },
});
