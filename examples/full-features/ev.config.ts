import { webpackAdapter } from "@evjs/bundler-webpack";
import {
  defineConfig,
  edgeDeploymentAdapter,
  nodeDeploymentAdapter,
  staticDeploymentAdapter,
} from "@evjs/ev";
import { fullFeaturesDeployAdapter } from "./deploy-adapter.mjs";

export default defineConfig({
  bundler: webpackAdapter,
  html: "./index.html",

  apps: {
    default: {
      entry: "./src/main.tsx",
      html: "./index.html",
      mount: "#app",
    },
  },

  pages: {
    support: {
      path: "/support",
      component: "./src/pages/Support.tsx",
      html: "./index.html",
      render: "csr",
      mount: "#app",
    },
    campaign: {
      path: "/campaign",
      component: "./src/pages/Campaign.tsx",
      html: "./index.html",
      render: "ppr",
      hydrate: "visible",
      mount: "#app",
      ppr: {
        regions: {
          offer: {
            component: "./src/pages/OfferRegion.tsx",
            cache: { revalidate: 30 },
            hydrate: "none",
          },
        },
      },
    },
    dashboard: {
      path: "/dashboard",
      component: "./src/pages/Dashboard.tsx",
      html: "./index.html",
      render: "ssr",
      hydrate: "load",
      mount: "#app",
    },
    insights: {
      path: "/insights",
      component: "./src/pages/Insights.tsx",
      html: "./index.html",
      render: "rsc",
      hydrate: "none",
      mount: "#app",
    },
    remote: {
      component: "./src/pages/RemoteApp.tsx",
      html: "./index.html",
      render: "csr",
      mount: "#app",
    },
  },

  server: {
    entry: "./src/server.ts",
  },

  remotes: {
    crm: {
      manifest:
        process.env.FULL_FEATURES_REMOTE_MANIFEST ??
        "https://assets.example.com/crm/evjs-remote.json",
      activeWhen: ["/crm/*"],
    },
  },

  plugins: [
    fullFeaturesDeployAdapter(),
    nodeDeploymentAdapter(),
    staticDeploymentAdapter(),
    edgeDeploymentAdapter({
      assetsBinding: "ASSETS",
    }),
  ],
});
