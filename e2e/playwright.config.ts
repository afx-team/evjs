import { defineConfig } from "@playwright/test";

export default defineConfig({
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
      } as any,
    },
    {
      name: "utoopack",
      use: {
        browserName: "chromium",
        bundlerName: "utoopack",
      } as any,
    },
  ],
});
