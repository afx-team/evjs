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
      // biome-ignore lint/suspicious/noExplicitAny: custom fixture properties
      use: {
        browserName: "chromium",
        bundlerName: "webpack",
      } as any,
    },
    {
      name: "utoopack",
      // biome-ignore lint/suspicious/noExplicitAny: custom fixture properties
      use: {
        browserName: "chromium",
        bundlerName: "utoopack",
      } as any,
    },
  ],
});
