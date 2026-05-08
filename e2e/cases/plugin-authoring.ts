import { expect } from "@playwright/test";
import { createExampleTest } from "../fixtures";

const test = createExampleTest("plugin-authoring");

test.describe("plugin-authoring", () => {
  test("renders home page with plugin content", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByText("Plugin Example")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("evjs plugin system")).toBeVisible();
  });

  test("uses server endpoint configured by plugin config hook", async ({
    page,
    baseURL,
  }) => {
    const rpcResponsePromise = page.waitForResponse((res) => {
      const url = new URL(res.url());
      return url.pathname === "/api/rpc" && res.request().method() === "POST";
    });

    await page.goto(baseURL);

    const rpcResponse = await rpcResponsePromise;
    expect(rpcResponse.status()).toBe(200);
    const payload = await rpcResponse.json();
    expect(payload.result).toEqual({
      message: "Plugin endpoint configured by config hook",
      nodeEnv: "production",
    });

    await expect(
      page.getByText(
        "Server function: Plugin endpoint configured by config hook",
      ),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Client mode: production")).toBeVisible();
    await expect(page.getByText("Server mode: production")).toBeVisible();

    const defaultEndpointResponse = await page.request.post(
      `${baseURL}/api/fn`,
      {
        data: { fnId: "missing", args: [] },
      },
    );
    expect(defaultEndpointResponse.status()).toBe(404);
  });

  test("HTML contains comment injected by transformHtml plugin", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL);

    // Wait for page to render
    await expect(page.getByText("Plugin Example")).toBeVisible({
      timeout: 10_000,
    });

    // The transformHtml hook injects a comment node into <head>
    // Verify it by reading the raw HTML source
    const html = await page.content();
    expect(html).toContain("Built with evjs");
    expect(html).toMatch(/Built with evjs \| \d+ asset\(s\)/);
  });

  test("page has correct title from template", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page).toHaveTitle("ev — Plugin Example");
  });

  test("JS assets are injected and functional", async ({ page, baseURL }) => {
    // The page itself rendering React content proves that JS assets
    // were properly injected by generateHtml
    await page.goto(baseURL);

    await expect(page.getByText("Plugin Example")).toBeVisible({
      timeout: 10_000,
    });

    // Verify the React app mounted into the #app div
    const appDiv = page.locator("#app");
    await expect(appDiv).not.toBeEmpty();
  });
});
