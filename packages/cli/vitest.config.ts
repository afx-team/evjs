import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@evjs/ev/build-tools": path.resolve(
        __dirname,
        "../ev/src/build-tools/index.ts",
      ),
      "@evjs/ev": path.resolve(__dirname, "../ev/src/index.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
