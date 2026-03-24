/**
 * Health check route handler.
 *
 * Demonstrates a minimal single-method route handler.
 */

import { createRouteHandler } from "@evjs/server";

export const healthHandler = createRouteHandler("/api/health", {
  GET: async () => {
    return Response.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  },
});
