import { defineConfig, type PlaywrightTestOptions } from "@playwright/test";

type ExtTestOptions = PlaywrightTestOptions & { bundlerName?: string };

export default defineConfig<ExtTestOptions>({
  testDir: ".",
  testMatch: "cases/*.ts",
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : "list",
  timeout: 60_000,
  retries: 0,
  // Example fixtures load and exercise the same built workspace packages.
  // Serialize CI bootstrap so workers cannot race on that shared module graph.
  workers: process.env.CI ? 1 : undefined,
  use: {
    headless: true,
  },
  projects: [
    {
      name: "utoopack",
      testIgnore: [
        "cases/scaffold.ts",
        "cases/render-modes.ts",
        "cases/deployment-adapters.ts",
        "cases/ssg.ts",
      ],
      use: {
        browserName: "chromium",
        bundlerName: "utoopack",
      },
    },
    {
      name: "webpack-examples",
      testMatch: [
        "cases/render-modes.ts",
        "cases/deployment-adapters.ts",
        "cases/ssg.ts",
      ],
      use: {
        browserName: "chromium",
        bundlerName: "webpack",
      },
    },
    {
      name: "utoopack-scaffold",
      testMatch: "cases/scaffold.ts",
      dependencies: ["utoopack"],
      use: {
        browserName: "chromium",
        bundlerName: "utoopack",
      },
    },
  ],
});
