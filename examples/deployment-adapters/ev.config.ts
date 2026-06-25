import { webpackAdapter } from "@evjs/bundler-webpack";
import {
  defineConfig,
  edgeDeploymentAdapter,
  nodeDeploymentAdapter,
  staticDeploymentAdapter,
} from "@evjs/ev";
import { deploymentExampleAdapter } from "./deploy-adapter.mjs";

export default defineConfig({
  bundler: webpackAdapter,
  html: "./index.html",

  app: {
    entry: "./src/main.tsx",
    html: "./index.html",
    mount: "#app",
  },

  server: {
    routing: true,
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
