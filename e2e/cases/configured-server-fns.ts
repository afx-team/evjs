import { createExampleTest, expect } from "../fixtures";

const test = createExampleTest("configured-server-fns");

test.describe("configured-server-fns", () => {
  test("loads and displays users via query proxy", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL);

    // Wait for loading to finish
    await expect(page.getByText("Loading users")).not.toBeVisible({
      timeout: 10_000,
    });

    // Verify users fetched via query proxy
    await expect(page.getByText("Alice")).toBeVisible();
    await expect(page.getByText("Bob")).toBeVisible();
    await expect(page.getByText("Charlie")).toBeVisible();
  });

  test("creates a new user via mutation proxy", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    // Wait for initial load
    await expect(page.getByText("Alice")).toBeVisible({ timeout: 10_000 });

    // Fill and submit the create user form
    await page.fill('[placeholder="Name"]', "Eve");
    await page.fill('[placeholder="Email"]', "eve@example.com");
    await page.click('button:has-text("Create")');

    // Form should clear after successful mutation
    await expect(page.locator('[placeholder="Name"]')).toHaveValue("", {
      timeout: 10_000,
    });
  });

  test("displays correct heading", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(
      page.getByText("Configured Server Functions"),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("shows ev.config.ts notice", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(
      page.getByText("ev.config.ts"),
    ).toBeVisible({ timeout: 10_000 });
  });
});
