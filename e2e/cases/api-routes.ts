import { expect } from "@playwright/test";
import { createExampleTest } from "../fixtures";

const test = createExampleTest("api-routes", {
  transport: { headers: { "X-Source": "application" }, credentials: "omit" },
  plugins: [
    {
      id: "e2e-transport-probe",
      emitIR(ctx) {
        const probe = ctx.emit.module({
          id: "startup-call",
          scope: { kind: "application" },
          source: `
import { sayHello } from "@/apis/demo.server";
import { initTransport } from "@evjs/ev/transport";
const probe = (globalThis as { __evjsTransportProbe?: { baseUrl: string; override: boolean } }).__evjsTransportProbe;
if (probe) {
  if (probe.override) initTransport({ baseUrl: probe.baseUrl, headers: { "X-Source": "user" }, credentials: "same-origin", silent: true });
  void sayHello("startup");
}
`,
        });
        ctx.slot("client.entry").add({
          id: "startup-call-import",
          module: probe,
          position: "before-main-imports",
        });
      },
    },
  ],
});

interface TransportProbeGlobals {
  __evjsTransportProbe?: { baseUrl: string; override: boolean };
}

test.describe("api-routes", () => {
  for (const override of [false, true]) {
    test(
      override
        ? "keeps explicit transport overrides for top-level server functions"
        : "applies application transport before top-level server functions",
      async ({ page, context, baseURL }) => {
        await context.addCookies([
          { name: "transport-probe", value: "present", url: baseURL },
        ]);
        await page.addInitScript(
          ({ baseUrl, override }) => {
            globalThis.__EVJS_TRANSPORT__ = {
              baseUrl,
              credentials: "include",
              headers: {
                "x-source": "deployment",
                "x-webgw-appid": "test-app",
              },
            };
            (globalThis as TransportProbeGlobals).__evjsTransportProbe = {
              baseUrl,
              override,
            };
          },
          { baseUrl: baseURL, override },
        );
        const responsePromise = page.waitForResponse(
          (response) => new URL(response.url()).pathname === "/__evjs/fn",
        );
        await page.goto(baseURL);
        const response = await responsePromise;
        expect(response.ok()).toBe(true);
        const headers = await response.request().allHeaders();
        expect(headers["x-source"]).toBe(override ? "user" : "application");
        expect(headers["x-webgw-appid"]).toBe(
          override ? undefined : "test-app",
        );
        if (override) {
          expect(headers.cookie).toContain("transport-probe=present");
        } else {
          expect(headers.cookie).toBeUndefined();
        }
        await expect(response.json()).resolves.toMatchObject({
          result: "Hello, startup! This is from a server function.",
        });
      },
    );
  }

  test("displays the correct heading", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.locator("h1")).toHaveText("Route Handlers Example");
    await expect(
      page.getByText("REST endpoints anchored by api.ts under src/apis"),
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

  test("applies explicitly composed API middleware", async ({
    request,
    apiURL,
  }) => {
    const response = await request.get(`${apiURL}/api/health`);
    expect(response.status()).toBe(200);
    expect(response.headers()["x-api-policy"]).toBe("applied");

    const blockedResponse = await request.get(`${apiURL}/api/health`, {
      headers: { "x-block-api": "true" },
    });
    expect(blockedResponse.status()).toBe(403);
    await expect(blockedResponse.json()).resolves.toEqual({
      error: "blocked by API middleware",
    });
  });

  test("isolates method middleware and applies only global policies to automatic OPTIONS and 405", async ({
    request,
    apiURL,
  }) => {
    const created = await request.post(`${apiURL}/api/posts`, {
      data: { title: "Method middleware", body: "Validated only for POST" },
    });
    expect(created.status()).toBe(201);
    expect(created.headers()["x-post-validated"]).toBe("true");
    expect(created.headers()["x-api-policy"]).toBe("applied");
    expect(created.headers()["x-example-server"]).toBe("api-routes");
    const { id } = await created.json();
    await request.delete(`${apiURL}/api/posts/${id}`);

    const invalid = await request.post(`${apiURL}/api/posts`, { data: {} });
    expect(invalid.status()).toBe(400);
    expect(invalid.headers()["x-api-policy"]).toBe("applied");

    for (const [method, status] of [
      ["GET", 200],
      ["HEAD", 200],
      ["OPTIONS", 204],
      ["PATCH", 405],
    ] as const) {
      const response = await request.fetch(`${apiURL}/api/posts`, { method });
      expect(response.status()).toBe(status);
      expect(response.headers()["x-api-policy"]).toBe(
        method === "GET" || method === "HEAD" ? "applied" : undefined,
      );
      expect(response.headers()["x-example-server"]).toBe("api-routes");
      expect(response.headers()["x-post-validated"]).toBeUndefined();
      if (method === "HEAD") expect(await response.text()).toBe("");
    }

    const blocked = await request.patch(`${apiURL}/api/posts`, {
      headers: { "x-block-api": "true" },
    });
    expect(blocked.status()).toBe(405);

    const options = await request.fetch(`${apiURL}/api/posts`, {
      method: "OPTIONS",
      headers: { "x-block-api": "true" },
    });
    expect(options.status()).toBe(204);
    expect(options.headers()["x-api-policy"]).toBeUndefined();
  });

  test("runs an explicit HEAD handler instead of GET", async ({
    request,
    apiURL,
  }) => {
    const response = await request.head(`${apiURL}/api/health`);
    expect(response.status()).toBe(204);
    expect(response.headers()["x-health-probe"]).toBe("head");
    expect(response.headers()["x-api-policy"]).toBe("applied");
    expect(await response.text()).toBe("");

    const blocked = await request.head(`${apiURL}/api/health`, {
      headers: { "x-block-api": "true" },
    });
    expect(blocked.status()).toBe(403);
    expect(await blocked.text()).toBe("");
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
