import { createExampleTest, expect } from "../fixtures";

const test = createExampleTest("trpc-server-fns");

test.describe("trpc-server-fns", () => {
  test("displays heading and sections", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByText("@evjs + tRPC")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText("Combining Zero-Config Server Functions"),
    ).toBeVisible();
  });

  test("tRPC section loads data", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    // Wait for tRPC section heading
    await expect(page.getByText("1. tRPC Call")).toBeVisible({
      timeout: 10_000,
    });

    // The tRPC response should eventually replace "Loading..." in the pre block.
    // Use a longer timeout since tRPC bootstraps a full request pipeline.
    const preElement = page.locator("pre");
    await expect(preElement).toBeVisible({ timeout: 15_000 });
  });

  test("server time section renders", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByText("2. Direct Server Function")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Server Time:")).toBeVisible();
  });

  test("refresh button is visible", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    const refreshButton = page.getByText("Refresh All");
    await expect(refreshButton).toBeVisible({ timeout: 10_000 });
  });
});
