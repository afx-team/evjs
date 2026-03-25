import { createExampleTest, expect } from "../fixtures";

const test = createExampleTest("sqlite-server-fns");

test.describe("sqlite-server-fns", () => {
  test("displays heading and seeded users", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByText("SQLite Server Functions")).toBeVisible({
      timeout: 10_000,
    });

    // Seeded users — use exact cell text to avoid matching emails
    await expect(
      page.getByRole("cell", { name: "Alice", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("cell", { name: "Bob", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "Charlie", exact: true }),
    ).toBeVisible();
  });

  test("users table has correct column headers", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(
      page.getByRole("cell", { name: "Alice", exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    // Verify table headers
    await expect(page.getByRole("columnheader", { name: "ID" })).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Name" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Email" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Created" }),
    ).toBeVisible();
  });

  test("creates a new user via server function", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    // Wait for initial load
    await expect(
      page.getByRole("cell", { name: "Alice", exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    // Use unique name per run to avoid conflicts with persistent DB
    const uniqueName = `User ${Date.now()}`;
    await page.fill('[placeholder="Name"]', uniqueName);
    await page.fill('[placeholder="Email"]', `e2e-${Date.now()}@example.com`);
    await page.click('button[type="submit"]');

    // Verify new user appears
    await expect(
      page.getByRole("cell", { name: uniqueName, exact: true }).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("shows Users heading", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible({
      timeout: 10_000,
    });
  });
});
