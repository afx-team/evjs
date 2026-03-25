import { createCsrExampleTest, expect } from "../fixtures";

const test = createCsrExampleTest("basic-csr");

test.describe("basic-csr", () => {
  test("renders home page", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByText("Welcome Home!")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText("A basic client-side rendered app"),
    ).toBeVisible();
  });

  test("navigates to About page", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await page.click("text=About");
    await expect(page.getByRole("heading", { name: "About" })).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByText("Code-based routing with TanStack Router"),
    ).toBeVisible();
  });

  test("navigates to Posts and displays post list", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL);

    await page.click("text=Posts");
    await expect(page.getByText("First Post")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Second Post")).toBeVisible();
    await expect(page.getByText("Third Post")).toBeVisible();
  });

  test("navigates to a post detail via dynamic route", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL);

    await page.click("text=Posts");
    await expect(page.getByText("First Post")).toBeVisible({ timeout: 5_000 });

    await page.click("text=First Post");
    await expect(page.getByText("Hello world!")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("displays navigation links", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByRole("link", { name: "Home" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("link", { name: "About" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Posts" })).toBeVisible();
  });
});
