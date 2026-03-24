import { createExampleTest, expect } from "../fixtures";

const test = createExampleTest("basic-server-routes");

test.describe("basic-server-routes", () => {
  test("displays the correct heading", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.locator("h1")).toHaveText("Route Handlers Example");
    await expect(page.getByText("REST endpoints powered by route()")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("loads and displays posts from REST endpoint", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL);

    // Wait for the initial loading text to disappear
    await expect(page.getByText("Loading posts from GET /api/posts…")).not.toBeVisible({
      timeout: 10_000,
    });

    // Verify posts fetched from server (id 1 and 2 are hardcoded in the example)
    await expect(page.getByText("Hello World")).toBeVisible();
    await expect(page.getByText("Route handlers bring REST APIs to evjs.")).toBeVisible();
  });

  test("creates and deletes a post via REST endpoints", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL);

    // Wait for initial load
    await expect(page.getByText("Hello World")).toBeVisible({ timeout: 10_000 });

    // Fill the create post form
    await page.fill('[placeholder="Title"]', "E2E Test Post");
    await page.fill('[placeholder="Body"]', "This is a post created by Playwright");
    await page.click('button:has-text("Create Post")');

    // Verify new post appears
    await expect(page.getByText("E2E Test Post")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("This is a post created by Playwright")).toBeVisible();

    // Delete the newly created post
    // The newly created post is the last one in the list, so we target its delete button
    const newPostListItem = page.locator('li', { hasText: 'E2E Test Post' });
    await newPostListItem.locator('button:has-text("Delete")').click();

    // Verify it is removed
    await expect(page.getByText("E2E Test Post")).not.toBeVisible({ timeout: 5_000 });
  });

  test("fetches health check", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await page.click('button:has-text("GET /api/health")');

    // Wait for the pre tag containing JSON to appear and verify its contents
    const pre = page.locator("pre");
    await expect(pre).toBeVisible({ timeout: 5_000 });
    const text = await pre.textContent();
    expect(text).toContain('"status": "ok"');
  });
});
