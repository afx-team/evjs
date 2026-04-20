import { defineConfig, type PlaywrightTestOptions } from "@playwright/test";

type ExtTestOptions = PlaywrightTestOptions & { bundlerName?: string };

export default defineConfig<ExtTestOptions>({
  testDir: ".",
  testMatch: "cases/*.ts",
  timeout: 60_000,
  retries: 0,
  use: {
    headless: true,
  },
  projects: [
    {
      name: "webpack",
      use: {
        browserName: "chromium",
        bundlerName: "webpack",
      },
    },
    {
      name: "utoopack",
      use: {
        browserName: "chromium",
        bundlerName: "utoopack",
      },
    },
  ],
});
