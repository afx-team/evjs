import { expect } from "@playwright/test";
import { createExampleTest } from "../fixtures";

const test = createExampleTest("ssr", { serveMode: "ssr" });

test.describe("ssr", () => {
  test("serves server-rendered HTML for the root route", async ({
    request,
    baseURL,
  }) => {
    const response = await request.get(baseURL, {
      headers: {
        Accept: "text/html",
        "x-evjs-e2e": "SSR request header",
      },
    });
    const html = await response.text();

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
    expect(html).toContain("<h1>SSR Example</h1>");
    expect(html).toContain("Home rendered on the server");
    expect(html).toContain('id="app"');
    expect(html).toMatch(/<script[^>]+src="\/[^"]+\.js"/);
    expect(html).toContain("Count <!-- -->0");
    expect(html).toContain("SSR request header");
    expect(html).toContain("__evjsQueryClient");
  });

  test("hydrates the server-rendered document", async ({ page, baseURL }) => {
    const serverFunctionRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/fn")) {
        serverFunctionRequests.push(request.url());
      }
    });

    await page.goto(baseURL);

    await expect(
      page.getByRole("heading", { name: "SSR Example" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Home rendered on the server" }),
    ).toBeVisible();
    await expect(page.getByTestId("loader-data")).toHaveText("SSR data loaded");
    expect(serverFunctionRequests).toEqual([]);

    const counter = page.getByTestId("counter");
    await expect(counter).toHaveText("Count 0");
    await counter.click();
    await expect(counter).toHaveText("Count 1");
  });

  test("serves direct deep links through the SSR document fallback", async ({
    request,
    page,
    baseURL,
  }) => {
    const response = await request.get(`${baseURL}/about`, {
      headers: { Accept: "text/html" },
    });
    const html = await response.text();

    expect(response.status()).toBe(200);
    expect(html).toContain("About rendered on the server");

    await page.goto(`${baseURL}/about`);
    await expect(
      page.getByRole("heading", { name: "About rendered on the server" }),
    ).toBeVisible();

    const counter = page.getByTestId("counter");
    await expect(counter).toHaveText("Count 0");
    await counter.click();
    await expect(counter).toHaveText("Count 1");
  });

  test("keeps API and asset requests out of the document fallback", async ({
    request,
    baseURL,
  }) => {
    const apiResponse = await request.get(`${baseURL}/api/health`);
    expect(apiResponse.status()).toBe(200);
    expect(await apiResponse.json()).toEqual({
      status: "ok",
      renderer: "ssr",
    });

    const documentResponse = await request.get(baseURL, {
      headers: { Accept: "text/html" },
    });
    const documentHtml = await documentResponse.text();
    const scriptSrc = documentHtml.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
    expect(scriptSrc).toBeTruthy();

    const scriptResponse = await request.get(
      new URL(scriptSrc ?? "/", baseURL).toString(),
    );
    expect(scriptResponse.status()).toBe(200);
    expect(scriptResponse.headers()["content-type"]).toContain("javascript");

    const missingAsset = await request.get(`${baseURL}/missing.js`, {
      headers: { Accept: "text/html" },
    });
    expect(missingAsset.status()).toBe(404);
    expect(await missingAsset.text()).toBe("Not Found");
  });

  test("navigates on the client after hydration", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await page.getByRole("link", { name: "About" }).click();

    await expect(page).toHaveURL(`${baseURL}/about`);
    await expect(
      page.getByRole("heading", { name: "About rendered on the server" }),
    ).toBeVisible();
  });
});
