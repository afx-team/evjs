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
  use: {
    headless: true,
  },
  projects: [
    {
      name: "utoopack",
      testIgnore: ["cases/scaffold.ts", "cases/full-features.ts"],
      use: {
        browserName: "chromium",
        bundlerName: "utoopack",
      },
    },
    {
      name: "webpack-full-features",
      testMatch: "cases/full-features.ts",
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
