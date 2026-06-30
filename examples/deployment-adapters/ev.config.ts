import { webpackAdapter } from "@evjs/bundler-webpack";
import { defineConfig } from "@evjs/ev";
import {
  edgeDeploymentAdapter,
  nodeDeploymentAdapter,
  staticDeploymentAdapter,
} from "@evjs/ev/deployment";
import { deploymentExampleAdapter } from "./deploy-adapter.mjs";

export default defineConfig({
  bundler: webpackAdapter,
  html: "./index.html",

  app: {
    entry: "./src/main.tsx",
    html: "./index.html",
    mount: "#app",
  },

  plugins: [
    deploymentExampleAdapter(),
    nodeDeploymentAdapter(),
    staticDeploymentAdapter(),
    edgeDeploymentAdapter({
      assetsBinding: "ASSETS",
    }),
  ],
});
