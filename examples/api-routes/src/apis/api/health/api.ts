/**
 * Health check route handler.
 *
 * Demonstrates a dedicated HEAD probe alongside a JSON GET handler.
 */

export const GET = async () => {
  return Response.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
};

export const HEAD = () =>
  new Response(null, { status: 204, headers: { "x-health-probe": "head" } });
