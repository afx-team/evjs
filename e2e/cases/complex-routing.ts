import { createExampleTest, expect } from "../fixtures";

const test = createExampleTest("complex-routing");

test.describe("complex-routing", () => {
  test("renders home page with navigation", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByText("evjs Complex Routing Example")).toBeVisible({
      timeout: 10_000,
    });

    // Nav bar should have links
    const nav = page.locator("nav");
    await expect(nav.getByText("Home")).toBeVisible();
    await expect(nav.getByText("Posts")).toBeVisible();
    await expect(nav.getByText("Dashboard")).toBeVisible();
    await expect(nav.getByText("Search")).toBeVisible();
  });

  test("navigates to posts and displays sidebar", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await page.locator("nav").getByText("Posts").click();

    // Posts layout with sidebar
    await expect(page.getByRole("heading", { name: "Posts" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText("Select a post from the sidebar"),
    ).toBeVisible();
  });

  test("dynamic route params — post detail", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    // Navigate to posts
    await page.locator("nav").getByText("Posts").click();
    await expect(page.getByRole("heading", { name: "Posts" })).toBeVisible({
      timeout: 10_000,
    });

    // Click first post in sidebar — uses typed $postId param
    const postLink = page.locator("ul li a").first();
    const postTitle = await postLink.textContent();
    await postLink.click();

    // Post detail renders with resolved params
    await expect(page.getByRole("heading", { name: postTitle! })).toBeVisible({
      timeout: 5_000,
    });

    // Author link exists (uses typed $username param)
    await expect(page.getByText("by")).toBeVisible();
  });

  test("dynamic route params — user profile via author link", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/posts`);

    // Click first post
    await expect(page.getByRole("heading", { name: "Posts" })).toBeVisible({
      timeout: 10_000,
    });
    const postLink = page.locator("ul li a").first();
    await postLink.click();

    // Wait for post detail
    await expect(page.getByText("by")).toBeVisible({ timeout: 5_000 });

    // Click author link — navigates to /users/$username
    await page.getByText("Back to posts", { exact: false });
    const authorLink = page.locator("p").filter({ hasText: "by" }).locator("a");
    await authorLink.click();

    // User profile renders with resolved $username param
    await expect(page.getByText("Back to posts")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("search params — typed search with query", async ({ page, baseURL }) => {
    // Navigate directly with search params
    await page.goto(`${baseURL}/search?q=tutorial`);

    await expect(page.getByRole("heading", { name: "Search" })).toBeVisible({
      timeout: 10_000,
    });

    // Typed search param should be populated in input
    await expect(page.locator('input[name="q"]')).toHaveValue("tutorial");

    // Results should filter based on search param
    await expect(page.getByText('Results for "tutorial"')).toBeVisible();
  });

  test("dashboard — pathless layout with server function loader", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/dashboard`);

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
      timeout: 10_000,
    });

    // Stats section loaded via route loader (server function)
    await expect(page.getByRole("heading", { name: "All Tags" })).toBeVisible();

    // Stat cards present (numbers rendered from server data)
    const statCards = page.locator("div").filter({ hasText: /^\d+$/ });
    await expect(statCards.first()).toBeVisible();
  });

  test("redirect — /old-blog redirects to /posts", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/old-blog`);

    // Should redirect to /posts
    await expect(page.getByRole("heading", { name: "Posts" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/\/posts/);
  });
});
