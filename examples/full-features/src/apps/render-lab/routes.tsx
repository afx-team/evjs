import { defineReactRoutes, page, route } from "@evjs/client";

export default defineReactRoutes([
  route("/app/dashboard", {
    id: "render-lab.dashboard",
    page: page("../../pages/Dashboard.tsx"),
    render: "ssr",
    hydrate: "load",
  }),
  route("/app/campaign", {
    id: "render-lab.campaign",
    page: page("../../pages/Campaign.tsx"),
    render: "ppr",
    hydrate: "none",
  }),
  route("/app/insights", {
    id: "render-lab.insights",
    page: page("../../pages/Insights.tsx"),
    render: "rsc",
    hydrate: "none",
  }),
  route("/app/remote", {
    id: "render-lab.remote",
  }),
]);
