import { createExampleTest, expect } from "../fixtures";

const test = createExampleTest("server-fns-query");

test.describe("server-fns-query", () => {
  test("loads users via query proxy", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    // Users should load via useQuery
    await expect(page.getByText("Alice")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Bob")).toBeVisible();
    await expect(page.getByText("Charlie")).toBeVisible();
  });

  test("loads posts via query proxy", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    // Posts should load via useQuery
    await expect(page.getByText("Hello Webpack")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("mutation proxy creates a user", async ({ page, baseURL }) => {
    await page.goto(baseURL);
    await expect(page.getByText("Alice")).toBeVisible({ timeout: 10_000 });

    // Fill and submit the create user form
    await page.fill('[placeholder="Name"]', "Eve");
    await page.fill('[placeholder="Email"]', "eve@example.com");
    await page.click('button:has-text("Create User")');

    // Form should clear after successful mutation
    await expect(page.locator('[placeholder="Name"]')).toHaveValue("", {
      timeout: 10_000,
    });
  });

  test("displays navigation", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByRole("link", { name: "Users" })).toBeVisible({
      timeout: 10_000,
    });
  });
});
