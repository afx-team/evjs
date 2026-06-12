import { expect } from "@playwright/test";
import { createExampleTest } from "../fixtures";

const test = createExampleTest("basic");

test.describe("basic", () => {
  test("loads and displays users from server function", async ({
    page,
    baseURL,
  }) => {
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
        { id: "1", name: "Alice", email: "alice@example.com" },
        { id: "2", name: "Bob", email: "bob@example.com" },
        { id: "3", name: "Charlie", email: "charlie@example.com" },
      ]),
    );

    // Wait for loading to finish
    await expect(page.getByText("Loading users")).not.toBeVisible({
      timeout: 10_000,
    });

    // Verify users fetched from server
    await expect(page.getByText("Alice")).toBeVisible();
    await expect(page.getByText("Bob")).toBeVisible();
    await expect(page.getByText("Charlie")).toBeVisible();
  });

  test("creates a new user via server function", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    // Wait for initial load
    await expect(page.getByText("Alice")).toBeVisible({ timeout: 10_000 });

    // Fill the create user form
    await page.fill('[placeholder="Name"]', "Dave");
    await page.fill('[placeholder="Email"]', "dave@example.com");
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
        id: expect.stringMatching(/^\d+$/),
        name: "Dave",
        email: "dave@example.com",
      }),
    );

    // Verify new user appears
    await expect(page.getByText("Dave")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("dave@example.com")).toBeVisible();
  });

  test("displays correct heading", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible({
      timeout: 10_000,
    });
  });
});
