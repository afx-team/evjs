import { createRoute } from "@evjs/server";

export const healthRoute = createRoute("/api/full-features/health", {
  GET: async () =>
    Response.json({
      ok: true,
      route: "full-features-health",
    }),
});
