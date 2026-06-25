import { webpackAdapter } from "@evjs/bundler-webpack";
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  bundler: webpackAdapter,
  html: "./index.html",

  app: {
    entry: "./src/main.tsx",
    html: "./index.html",
    mount: "#app",
  },

  pages: {
    support: {
      path: "/support",
      component: "./src/pages/Support.tsx",
      html: "./index.html",
      mount: "#app",
    },
    campaign: {
      path: "/campaign",
      component: "./src/pages/Campaign.tsx",
      html: "./index.html",
      mount: "#app",
    },
    dashboard: {
      path: "/dashboard",
      component: "./src/pages/Dashboard.tsx",
      html: "./index.html",
      mount: "#app",
    },
    settlement: {
      path: "/settlement-report",
      component: "./src/pages/SettlementReport.tsx",
      html: "./index.html",
      mount: "#app",
    },
    insights: {
      path: "/insights",
      component: "./src/pages/Insights.tsx",
      html: "./index.html",
      mount: "#app",
    },
  },

  server: {
    routing: true,
  },
});
