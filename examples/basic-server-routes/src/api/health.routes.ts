/**
 * Health check route handler.
 *
 * Demonstrates a minimal single-method route handler.
 */

import { route } from "@evjs/server";

export const healthHandler = route("/api/health", {
  GET: async () => {
    return Response.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  },
});
