import { expect } from "@playwright/test";
import { createExampleTest } from "../fixtures";

const test = createExampleTest("with-trpc");

test.describe("with-trpc", () => {
  test("displays heading and sections", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByText("@evjs + tRPC")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText("Combining Zero-Config Server Functions"),
    ).toBeVisible();
  });

  test("tRPC section loads data", async ({ page, baseURL }) => {
    const trpcPromise = page.waitForResponse(
      (res) =>
        res.url().includes("__evjs/fn") && res.request().method() === "POST",
    );
    await page.goto(baseURL);
    const trpcResponse = await trpcPromise;
    expect(trpcResponse.status()).toBe(200);
    expect(await trpcResponse.json()).toEqual(
      expect.objectContaining({ result: expect.anything() }),
    );

    // Wait for tRPC section heading
    await expect(page.getByText("1. tRPC Call")).toBeVisible({
      timeout: 10_000,
    });

    // The tRPC response should eventually replace "Loading..." in the pre block.
    // Use a longer timeout since tRPC bootstraps a full request pipeline.
    const preElement = page.locator("pre");
    await expect(preElement).toBeVisible({ timeout: 15_000 });
    await expect(preElement).toContainText(
      "Hello from tRPC! (called via Server Function proxy)",
    );
    expect(JSON.parse((await preElement.textContent()) ?? "{}")).toEqual({
      message: "Hello from tRPC! (called via Server Function proxy)",
    });
  });

  test("server time section renders", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByText("2. Direct Server Function")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("p", { hasText: "Server Time:" })).toContainText(
      /\d{4}-\d{2}-\d{2}T/,
    );
  });

  test("refresh button refetches server data", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.locator("pre")).toContainText(
      "Hello from tRPC! (called via Server Function proxy)",
      { timeout: 15_000 },
    );
    const refreshPromise = page.waitForResponse(
      (res) =>
        res.url().includes("__evjs/fn") && res.request().method() === "POST",
    );
    const refreshButton = page.getByText("Refresh All");
    await refreshButton.click();
    const refreshResponse = await refreshPromise;
    expect(refreshResponse.status()).toBe(200);
    await expect(page.locator("pre")).toContainText(
      "Hello from tRPC! (called via Server Function proxy)",
    );
  });
});
