import { webpackAdapter } from "@evjs/bundler-webpack";
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  bundler: webpackAdapter,
  server: false,
  remote: {
    name: "crm",
    baseUrl:
      process.env.FULL_FEATURES_REMOTE_BASE_URL ??
      "https://assets.example.com/crm/",
    shared: {
      "remote-react": {
        shareKey: "react",
        requiredVersion: ">=19 <20",
        singleton: true,
        eager: true,
      },
    },
    entries: {
      customers: {
        app: "./src/remote.ts",
        activeWhen: ["/crm/*"],
        mount: "#remote-root",
      },
    },
  },
});
