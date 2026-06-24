/**
 * Health check route handler.
 *
 * Demonstrates a minimal single-method server file route.
 */

export const GET = async () => {
  return Response.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
};
