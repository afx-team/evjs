export const GET = async () =>
  Response.json({
    ok: true,
    route: "merchant-ops-health",
    services: {
      payments: "green",
      risk: "watch",
      settlements: "green",
    },
    checkedAt: "2026-06-03T09:31:00.000Z",
  });
