import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@evjs/ev/_internal/build": path.resolve(
        __dirname,
        "../ev/src/_internal/build/index.ts",
      ),
      "@evjs/shared/manifest": path.resolve(
        __dirname,
        "../shared/src/manifest/index.ts",
      ),
    },
  },
});
