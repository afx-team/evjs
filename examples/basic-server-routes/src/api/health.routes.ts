/**
 * Health check route handler.
 *
 * Demonstrates a minimal single-method route handler.
 */

import { Hono } from "hono";

export const healthApp = new Hono().get("/api/health", (c) => {
  return c.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});
