import { createExampleTest, expect } from "../fixtures";

const test = createExampleTest("server-fns-query");

test.describe("server-fns-query", () => {
  // ── Basic query & mutation ──

  test("loads users via query proxy", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByText("Alice")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Bob")).toBeVisible();
    await expect(page.getByText("Charlie")).toBeVisible();
  });

  test("loads posts via query proxy", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByText("Hello evjs")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("mutation proxy creates a user and invalidates cache", async ({
    page,
    baseURL,
  }) => {
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

    // New user should appear (cache was invalidated)
    await expect(page.getByText("Eve")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("eve@example.com")).toBeVisible();
  });

  test("displays navigation with all links", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByRole("link", { name: "Users" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("link", { name: "Search" })).toBeVisible();
    await expect(page.getByRole("link", { name: "User #1" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "User #999 (error)" }),
    ).toBeVisible();
  });

  // ── Multi-arg server function ──

  test("search page renders with default results", async ({
    page,
    baseURL,
  }) => {
    // Navigate via client-side link to avoid nested path chunk issues
    await page.goto(baseURL);
    await expect(page.getByText("Alice")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("link", { name: "Search" }).click();

    await expect(page.getByText("Search Users (multi-arg)")).toBeVisible({
      timeout: 10_000,
    });

    // Empty search returns all users (count may vary due to mutation tests)
    await expect(page.locator("#search-results")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.locator("#search-results").getByText("Alice"),
    ).toBeVisible();
    await expect(
      page.locator("#search-results").getByText("Bob"),
    ).toBeVisible();
  });

  test("search filters users by name (multi-arg)", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL);
    await expect(page.getByText("Alice")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("link", { name: "Search" }).click();

    await expect(page.getByText("Search Users (multi-arg)")).toBeVisible({
      timeout: 10_000,
    });

    // Type a name to filter — multi-arg function call (name, email)
    await page.fill("#search-name", "Ali");

    // Wait for filtered results — should show Alice, not Bob/Charlie
    await expect(
      page.locator("#search-results").getByText("Alice"),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator("#search-results").getByText("Bob"),
    ).not.toBeVisible();
  });

  // ── Error handling (ServerError → ServerFunctionError) ──

  test("user detail page loads a valid user", async ({ page, baseURL }) => {
    // Navigate via client-side link to avoid nested path issue
    await page.goto(baseURL);
    await expect(page.getByText("Alice")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("link", { name: "User #1" }).click();

    await expect(page.locator("#user-detail")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#user-name")).toHaveText("Name: Alice");
    await expect(page.locator("#user-email")).toHaveText(
      "Email: alice@example.com",
    );
  });

  test("user detail shows ServerFunctionError for invalid user", async ({
    page,
    baseURL,
  }) => {
    // Navigate via client-side link
    await page.goto(baseURL);
    await expect(page.getByText("Alice")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("link", { name: "User #999 (error)" }).click();

    await expect(page.locator("#user-error")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#error-message")).toContainText(
      "User not found",
    );
    await expect(page.locator("#error-type")).toContainText(
      "ServerFunctionError",
    );
    await expect(page.locator("#error-type")).toContainText("status: 404");
  });

  // ── Route loader with queryOptions ──

  test("route loader prefetches data (no loading spinner)", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL);

    // The loader uses queryOptions() to prefetch — users should render
    // immediately without showing "Loading data from server…"
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Loading data from server")).not.toBeVisible();
  });
});
