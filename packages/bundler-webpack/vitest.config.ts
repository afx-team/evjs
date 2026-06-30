import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@evjs/ev/_internal/build": path.resolve(
        __dirname,
        "../ev/src/_internal/build/index.ts",
      ),
      "@evjs/ev/_internal/manifest": path.resolve(
        __dirname,
        "../ev/src/_internal/manifest/index.ts",
      ),
      "@evjs/ev/config": path.resolve(__dirname, "../ev/src/config/index.ts"),
      "@evjs/ev/plugin": path.resolve(__dirname, "../ev/src/plugin/index.ts"),
      "@evjs/ev": path.resolve(__dirname, "../ev/src/index.ts"),
      "@evjs/shared/manifest": path.resolve(
        __dirname,
        "../shared/src/manifest/index.ts",
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
