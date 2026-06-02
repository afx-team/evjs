import { expect } from "@playwright/test";
import { createExampleTest } from "../fixtures";

const test = createExampleTest("with-sqlite");

test.describe("with-sqlite", () => {
  test("displays heading and seeded users", async ({ page, baseURL }) => {
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("__evjs/fn") && res.request().method() === "POST",
    );
    await page.goto(baseURL);
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data.result)).toBe(true);
    expect(data.result.length).toBeGreaterThanOrEqual(3);
    expect(data.result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Alice",
          email: "alice@example.com",
        }),
        expect.objectContaining({ name: "Bob", email: "bob@example.com" }),
        expect.objectContaining({
          name: "Charlie",
          email: "charlie@example.com",
        }),
      ]),
    );

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
    const createResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("__evjs/fn") && res.request().method() === "POST",
    );
    await page.click('button[type="submit"]');
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(200);
    const createData = await createResponse.json();
    expect(createData.result).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        name: uniqueName,
      }),
    );

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
