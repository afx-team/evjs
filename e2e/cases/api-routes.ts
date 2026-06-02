import { expect } from "@playwright/test";
import { createExampleTest } from "../fixtures";

const test = createExampleTest("api-routes");

test.describe("api-routes", () => {
  test("displays the correct heading", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.locator("h1")).toHaveText("Route Handlers Example");
    await expect(
      page.getByText("REST endpoints powered by createRoute()"),
    ).toBeVisible({
      timeout: 10_000,
    });
  });

  test("loads and displays posts from REST endpoint", async ({
    page,
    baseURL,
  }) => {
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/posts") && res.request().method() === "GET",
    );
    await page.goto(baseURL);
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const posts = await response.json();
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThanOrEqual(2);

    // Wait for the initial loading text to disappear
    await expect(
      page.getByText("Loading posts from GET /api/posts…"),
    ).not.toBeVisible({
      timeout: 10_000,
    });

    // Verify posts fetched from server (id 1 and 2 are hardcoded in the example)
    await expect(page.getByText("Hello World")).toBeVisible();
    await expect(
      page.getByText("Route handlers bring REST APIs to evjs."),
    ).toBeVisible();
  });

  test("creates and deletes a post via REST endpoints", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL);

    // Wait for initial load
    await expect(page.getByText("Hello World")).toBeVisible({
      timeout: 10_000,
    });

    // Fill the create post form
    await page.fill('[placeholder="Title"]', "E2E Test Post");
    await page.fill(
      '[placeholder="Body"]',
      "This is a post created by Playwright",
    );
    const createResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/posts") && res.request().method() === "POST",
    );
    await page.click('button:has-text("Create Post")');
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    const createdPost = await createResponse.json();
    expect(createdPost.title).toBe("E2E Test Post");
    expect(createdPost.body).toBe("This is a post created by Playwright");

    // Verify new post appears
    await expect(page.getByText("E2E Test Post")).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByText("This is a post created by Playwright"),
    ).toBeVisible();

    // Delete the newly created post
    // The newly created post is the last one in the list, so we target its delete button
    const newPostListItem = page.locator("li", { hasText: "E2E Test Post" });
    const deleteResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/posts/") &&
        res.request().method() === "DELETE",
    );
    await newPostListItem.locator('button:has-text("Delete")').click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.status()).toBe(204);

    // Verify it is removed
    await expect(page.getByText("E2E Test Post")).not.toBeVisible({
      timeout: 5_000,
    });
  });

  test("fetches health check", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    const healthResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/health") && res.request().method() === "GET",
    );
    await page.click('button:has-text("GET /api/health")');
    const healthResponse = await healthResponsePromise;
    expect(healthResponse.status()).toBe(200);
    const healthData = await healthResponse.json();
    expect(healthData.status).toBe("ok");
    expect(healthData.uptime).toEqual(expect.any(Number));
    expect(healthData.timestamp).toEqual(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );

    // Wait for the pre tag containing JSON to appear and verify its contents
    const pre = page.locator("pre").first();
    await expect(pre).toBeVisible({ timeout: 5_000 });
    const text = await pre.textContent();
    expect(JSON.parse(text ?? "{}")).toEqual(
      expect.objectContaining({
        status: "ok",
        uptime: expect.any(Number),
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    );
  });

  test("calls server function", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    const fnResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("__evjs/fn") && res.request().method() === "POST",
    );
    await page.click('button:has-text("Call sayHello(\\"World\\")")');
    const fnResponse = await fnResponsePromise;
    expect(fnResponse.status()).toBe(200);
    const fnData = await fnResponse.json();
    expect(fnData.result).toBe("Hello, World! This is from a server function.");

    // Wait for the server function response to appear
    await expect(
      page.getByText("Hello, World! This is from a server function."),
    ).toBeVisible({ timeout: 5_000 });
  });
});
