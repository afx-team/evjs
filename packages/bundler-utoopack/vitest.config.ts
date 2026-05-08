import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@evjs/build-tools": path.resolve(
        __dirname,
        "../build-tools/src/index.ts",
      ),
      "@evjs/manifest": path.resolve(__dirname, "../manifest/src/index.ts"),
    },
  },
});
