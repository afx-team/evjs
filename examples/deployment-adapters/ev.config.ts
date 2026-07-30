import { webpackAdapter } from "@evjs/bundler-webpack";
import { defineConfig } from "@evjs/ev";
import {
  edgeDeploymentAdapter,
  nodeDeploymentAdapter,
  staticDeploymentAdapter,
} from "@evjs/ev/deployment";
import { deploymentExampleAdapter } from "./src/deploy-adapter.mjs";

export default defineConfig({
  bundler: webpackAdapter,
  routing: { mode: "spa" },
  plugins: [
    deploymentExampleAdapter(),
    nodeDeploymentAdapter(),
    staticDeploymentAdapter(),
    edgeDeploymentAdapter({
      assetsBinding: "ASSETS",
    }),
  ],
});
