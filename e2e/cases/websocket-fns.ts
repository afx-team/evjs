import { createWebSocketExampleTest, expect } from "../fixtures-ws";

const test = createWebSocketExampleTest();

test.describe("websocket-fns", () => {
  test("loads and displays users via WebSocket", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    // Wait for loading to finish
    await expect(page.getByText("Loading users")).not.toBeVisible({
      timeout: 10_000,
    });

    // Verify users fetched from server via WebSocket
    await expect(page.getByText("Alice")).toBeVisible();
    await expect(page.getByText("Bob")).toBeVisible();
    await expect(page.getByText("Charlie")).toBeVisible();
  });

  test("creates a new user via WebSocket", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    // Wait for initial load
    await expect(page.getByText("Alice")).toBeVisible({ timeout: 10_000 });

    // Fill the create user form
    await page.fill('[placeholder="Name"]', "Dave");
    await page.fill('[placeholder="Email"]', "dave@example.com");
    await page.click('button[type="submit"]');

    // Verify new user appears
    await expect(page.getByText("Dave")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("dave@example.com")).toBeVisible();
  });

  test("displays correct heading", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(
      page.getByText("Users (fetched via WebSocket server functions)"),
    ).toBeVisible({ timeout: 10_000 });
  });
});
