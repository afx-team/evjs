import { createExampleTest, expect } from "../fixtures";

const test = createExampleTest("basic-fns-ecma");

test.describe("basic-fns-ecma", () => {
  test("displays correct heading", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByText("ECMA Runtime Example")).toBeVisible();
  });

  test("loads and displays messages from server function", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL);

    // Verify messages fetched from server
    await expect(
      page.getByText("Hello from the ECMA runtime!"),
    ).toBeVisible();
    await expect(
      page.getByText("This server runs on any Fetch-compatible runtime."),
    ).toBeVisible();
  });

  test("posts a new message via server function", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL);

    // Wait for initial load
    await expect(
      page.getByText("Hello from the ECMA runtime!"),
    ).toBeVisible({ timeout: 10_000 });

    // Post a new message
    await page.fill('[placeholder="Message"]', "Test message from e2e");
    await page.click('button:has-text("Send")');

    // Verify the form clears
    await expect(page.locator('[placeholder="Message"]')).toHaveValue("");

    // Verify the new message appears
    await expect(
      page.getByText("Test message from e2e"),
    ).toBeVisible({ timeout: 5_000 });
  });
});
