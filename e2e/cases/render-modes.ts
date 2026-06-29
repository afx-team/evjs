import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { createExampleTest } from "../fixtures";

const exampleDir = path.resolve(
  import.meta.dirname,
  "../..",
  "examples",
  "render-modes",
);

const test = createExampleTest("render-modes");

interface RenderModesPublicPage {
  document?: unknown;
  module?: unknown;
  path?: string;
  routeId?: string;
  ppr?: {
    delivery?: string;
    regions: Record<string, { id?: string; cache?: unknown }>;
  };
  [key: string]: unknown;
}

test.describe("render-modes", () => {
  test("runs the merchant operations console with server function and REST route", async ({
    page,
    baseURL,
  }) => {
    const rpcResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/__evjs/fn" && response.request().method() === "POST"
      );
    });

    await page.goto(baseURL);

    const rpcResponse = await rpcResponsePromise;
    expect(rpcResponse.status()).toBe(200);
    await expectRenderMode(page, "csr", "CSR App");

    await expect(
      page.getByRole("heading", { name: "Acme Pay Control Center" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("gmv")).toHaveText("$262.5k");
    await expect(page.getByTestId("approval-rate")).toHaveText("97.8%");
    await expect(page.getByTestId("risk-queue")).toHaveText("2 active");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await expect(
      page.getByText("Atlas Foods payout requires manual review"),
    ).toBeVisible();
    await expect(page.getByTestId("health-route")).toHaveText(
      "merchant-ops-health",
    );
    await expect(page.getByTestId("risk-service")).toHaveText(
      "Risk service: watch",
    );
  });

  test("mounts a framework-managed CSR component page", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/support`);
    await expectRenderMode(page, "csr", "CSR");
    await expectBackLink(page);

    await expect(
      page.getByRole("heading", { name: "Support Queue" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Chargeback evidence requested")).toBeVisible();
    await expect(page.getByText("Northstar Outdoor")).toBeVisible();
    await expect(page.getByRole("cell", { name: "urgent" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Local triage workspace" }),
    ).toBeVisible();
  });

  test("renders configured SSR page path through the framework server", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/dashboard`);
    await expectRenderMode(page, "ssr", "SSR");
    await expectBackLink(page);

    await expect(
      page.getByRole("heading", { name: "Revenue Risk Dashboard" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("dashboard-page")).toHaveText("dashboard");
    await expect(page.getByTestId("dashboard-route")).toHaveText("/dashboard");
    await expect(page.getByTestId("dashboard-gmv")).toHaveText("$262.5k");
    await expect(
      page.getByText("Payments requiring operator judgment"),
    ).toBeVisible();
    await expect(
      page.getByText("Hold payout and request invoice evidence"),
    ).toBeVisible();
    await expect(page.getByText("APAC priority release")).toBeVisible();
    await expect(page.getByText("Who owns the open work")).toBeVisible();
    await expect(page.getByText("Regional payment health")).toBeVisible();
    await expect(page.getByText("Payment review board")).toBeVisible();
    await page.getByTestId("page-back-link").click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(
      page.getByRole("heading", { name: "Acme Pay Control Center" }),
    ).toBeVisible();
  });

  test("serves a configured SSG page path through the framework server", async ({
    page,
    request,
    baseURL,
    apiURL,
  }) => {
    const htmlResponse = await request.get(`${apiURL}/settlement-report`);
    expect(htmlResponse.status()).toBe(200);
    const html = await htmlResponse.text();
    expect(html).toContain("Settlement Readiness Report");
    expect(html).toContain('data-render-mode="ssg"');
    expect(html).not.toContain("settlement.js");

    await page.goto(`${baseURL}/settlement-report`);
    await expectRenderMode(page, "ssg", "SSG");
    await expectBackLink(page);

    await expect(
      page.getByRole("heading", { name: "Settlement Readiness Report" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("settlement-render-mode")).toHaveText(
      "static",
    );
    await expect(page.getByTestId("settlement-hydration")).toHaveText("none");
    await expect(page.getByTestId("settlement-ready-count")).toHaveText("2");
    await expect(page.getByText("North America express")).toBeVisible();
    await expect(page.locator('script[src*="settlement"]')).toHaveCount(0);
  });

  test("serves PPR shell and dynamic region through the framework server", async ({
    page,
    request,
    baseURL,
    apiURL,
  }) => {
    const browserRegionRequests: string[] = [];
    page.on("request", (browserRequest) => {
      const url = new URL(browserRequest.url());
      if (url.pathname.startsWith("/__evjs/ppr/campaign/")) {
        browserRegionRequests.push(browserRequest.url());
      }
    });

    await page.goto(`${baseURL}/campaign`);
    await expectRenderMode(page, "ppr", "PPR");
    await expectBackLink(page);

    await expect(
      page.getByRole("heading", { name: "Spring Launch Campaign" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("campaign-page")).toHaveText("campaign");
    await expect(page.getByText("Static campaign shell")).toBeVisible();
    await expect(page.getByText("Checkout conversion")).toBeVisible();
    await expect(
      page
        .locator('[aria-label="Campaign metrics"]')
        .getByText("18.4%", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("offer-region")).toContainText(
      "Dynamic PPR region rendered on demand",
    );
    await expect(
      page.getByRole("heading", { name: "Offer Region" }),
    ).toBeVisible();
    expect(browserRegionRequests).toEqual([]);

    const pageResponse = await request.get(`${apiURL}/campaign`);
    expect(pageResponse.status()).toBe(200);
    expect(pageResponse.headers()["x-evjs-ppr"]).toBe("stream");
    const pageHtml = await pageResponse.text();
    const publicPages = getRenderModesPublicPages();
    const campaignPpr = getRenderModesCampaignPpr(publicPages);
    const { id: regionId } = getSinglePprRegion(campaignPpr.regions);
    expect(pageHtml).toContain(`data-evjs-ppr-stream-region="${regionId}"`);
    expect(pageHtml).toContain("Dynamic PPR region rendered on demand");

    const regionResponse = await request.get(
      `${apiURL}/__evjs/ppr/campaign/${encodeURIComponent(regionId)}`,
    );
    expect(regionResponse.status()).toBe(200);
    expect(regionResponse.headers()["cache-control"]).toBe("s-maxage=30");
    // The streamed page request above renders and caches the same PPR region.
    expect(regionResponse.headers()["x-evjs-cache"]).toBe("HIT");
    const regionHtml = await regionResponse.text();
    expect(regionHtml).toContain("Offer Region");
    expect(regionHtml).toContain("Dynamic allocation");
    expect(regionHtml).toContain("region-card");
  });

  test("serves an RSC page and framework RSC endpoint through the server runtime", async ({
    page,
    request,
    baseURL,
    apiURL,
  }) => {
    const htmlResponse = await request.get(`${apiURL}/insights`);
    expect(htmlResponse.status()).toBe(200);
    const html = await htmlResponse.text();
    expect(html).toContain("__EVJS_RSC_BOOTSTRAP__");
    expect(html).toContain('<script defer src="/evjs-rsc-client');
    expect(html).not.toContain('<script type="module"');
    expect(html).not.toContain("src/pages/Insights.tsx");
    expect(html).not.toContain("insights-rsc.js");

    const runtimeFlightResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/__evjs/rsc" &&
        url.searchParams.get("page") === "insights"
      );
    });

    await page.goto(`${baseURL}/insights`);
    const runtimeFlightResponse = await runtimeFlightResponsePromise;
    expect(runtimeFlightResponse.status()).toBe(200);
    expect(runtimeFlightResponse.headers()["content-type"]).toContain(
      "text/x-component",
    );
    await expectRenderMode(page, "rsc", "RSC");
    await expectBackLink(page);

    await expect(
      page.getByRole("heading", { name: "Profitability Insights" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("insights-route")).toHaveText(
      "Route: /insights",
    );
    await expect(page.getByTestId("insights-badge")).toHaveText(
      "Client risk model hydrated",
    );
    await expect(page.getByTestId("insights-recommendation")).toContainText(
      "Atlas Foods",
    );
    await expect(
      page.getByRole("heading", { name: "Server-generated recommendations" }),
    ).toBeVisible();
    await expect(
      page.getByText("Policy lanes evaluated on the server"),
    ).toBeVisible();

    const flightResponse = await request.get(
      `${apiURL}/__evjs/rsc?page=insights`,
    );
    expect(flightResponse.status()).toBe(200);
    expect(flightResponse.headers()["content-type"]).toContain(
      "text/x-component",
    );
    const flightText = await flightResponse.text();
    expect(flightText).toContain("Profitability Insights");
    expect(flightText).toContain("insights");
    expect(flightText).toContain("Atlas Foods");
  });

  test("emits a manifest with app, page, route, and server data", async () => {
    const manifestPath = getRenderModesPublicManifestPath();
    const manifest = readRenderModesPublicManifest();
    const buildOutput = readRenderModesBuildOutput();
    const buildOutputText = JSON.stringify(buildOutput);
    const frameworkRuntime = readRenderModesFrameworkRuntime();
    const publicPages = getRenderModesPublicPages(manifest);
    const publicRoutes = Object.entries(publicPages).map(([pageId, page]) => ({
      id: page.routeId,
      path: page.path,
      pageId,
    }));

    expect("distDir" in buildOutput).toBe(false);
    expect(buildOutput.paths).toEqual({
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    });
    expect(buildOutputText).not.toContain('"chunks"');
    expect(manifest.app).toEqual(
      expect.objectContaining({
        mount: "#app",
        module: expect.objectContaining({ type: "entry" }),
      }),
    );
    expect(manifest).not.toHaveProperty("pages");
    expect(manifest).not.toHaveProperty("routes");
    expect(manifest.routing.kind).toBe("mpa");
    expect(publicPages.support).toEqual(
      expect.objectContaining({
        render: "csr",
        rendering: {
          component: "client",
          html: "client",
          streaming: false,
          hydrate: "load",
        },
        module: expect.objectContaining({ type: "react-component" }),
      }),
    );
    expect(publicPages.dashboard).toEqual(
      expect.objectContaining({
        path: "/dashboard",
        render: "ssr",
        rendering: {
          component: "server",
          html: "server",
          streaming: false,
          hydrate: "load",
        },
        routeId: "dashboard",
      }),
    );
    expect(publicPages.settlement).toEqual(
      expect.objectContaining({
        path: "/settlement-report",
        render: "ssg",
        rendering: {
          component: "server",
          html: "static",
          prerender: "full",
          streaming: false,
          hydrate: "none",
        },
        routeId: "settlement",
      }),
    );
    expect(publicPages.settlement.document).toBeUndefined();
    expect(publicPages.settlement.module).toBeUndefined();
    expect(publicPages.insights).toEqual(
      expect.objectContaining({
        path: "/insights",
        render: "ssr",
        componentModel: "rsc",
        rendering: {
          component: "rsc",
          html: "server",
          streaming: true,
          hydrate: "none",
        },
        routeId: "insights",
      }),
    );
    expect(publicPages.campaign).toEqual(
      expect.objectContaining({
        path: "/campaign",
        render: "ssr",
        prerender: expect.objectContaining({
          partial: true,
          delivery: "stream",
        }),
        rendering: {
          component: "server",
          html: "partial",
          prerender: "partial",
          streaming: true,
          hydrate: "none",
        },
      }),
    );
    const campaignPpr = getRenderModesCampaignPpr(publicPages);
    const { id: campaignRegionId, region: campaignRegion } = getSinglePprRegion(
      campaignPpr.regions,
    );
    expect(campaignRegion).toEqual(
      expect.objectContaining({
        id: campaignRegionId,
        cache: { revalidate: 30 },
      }),
    );
    expect(campaignPpr.delivery).toBe("stream");
    expect(publicRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "dashboard",
          path: "/dashboard",
          pageId: "dashboard",
        }),
        expect.objectContaining({
          id: "campaign",
          path: "/campaign",
          pageId: "campaign",
        }),
        expect.objectContaining({
          id: "settlement",
          path: "/settlement-report",
          pageId: "settlement",
        }),
        expect.objectContaining({
          id: "insights",
          path: "/insights",
          pageId: "insights",
        }),
      ]),
    );
    expect(Object.values(buildOutput.server.functions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exportName: "getMerchantOperationsSnapshot",
        }),
      ]),
    );
    expect(buildOutput.server.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/api/render-modes/health",
          methods: expect.arrayContaining(["GET"]),
        }),
      ]),
    );
    expect(buildOutput.runtime.server).toEqual(
      expect.objectContaining({
        basePath: "/__evjs",
        fn: "/__evjs/fn",
        ppr: "/__evjs/ppr",
        rsc: "/__evjs/rsc",
      }),
    );
    expect(buildOutput.rsc.pages.insights).toEqual(
      expect.objectContaining({
        renderer: "insights-rsc",
        routeId: "insights",
        assets: expect.objectContaining({
          css: expect.arrayContaining(["insights-rsc.css"]),
        }),
      }),
    );
    expect(manifest.rsc.clientReferences).toBeUndefined();
    expect(manifest.rsc.clientReferenceManifest).toBeUndefined();
    expect(manifest.rsc.serverConsumerManifest).toBeUndefined();
    expect(frameworkRuntime.rsc.clientReferenceManifest).toBeDefined();
    expect(
      fs.existsSync(
        path.join(exampleDir, "dist/client/react-client-manifest.json"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(exampleDir, "dist/client/react-ssr-manifest.json"),
      ),
    ).toBe(false);

    const publicManifestText = fs.readFileSync(manifestPath, "utf-8");
    expect(publicManifestText).not.toContain('"distDir"');
    expect(publicManifestText).not.toContain('"chunks"');
    expect(publicManifestText).not.toContain(".tsx");
    expect(publicManifestText).not.toContain("file://");
    expect(publicManifestText).not.toContain(exampleDir);
  });
});

async function expectRenderMode(
  page: Page,
  mode: "csr" | "ssr" | "ssg" | "ppr" | "rsc",
  label: string,
): Promise<void> {
  const renderModePage = page.getByTestId("render-mode-page");
  await expect(renderModePage).toHaveAttribute("data-render-mode", mode);
  await expect(page.getByTestId("render-mode-chip")).toHaveText(label);
  await expect(renderModePage).toHaveCSS("background-image", /linear-gradient/);
}

async function expectBackLink(page: Page): Promise<void> {
  const backLink = page.getByTestId("page-back-link");
  await expect(backLink).toBeVisible();
  await expect(backLink).toHaveText("Back to control center");
  await expect(backLink).toHaveAttribute("href", "/");
}

function getRenderModesPublicManifestPath(): string {
  return path.join(exampleDir, "dist", "client", "manifest.json");
}

function readRenderModesPublicManifest() {
  return JSON.parse(
    fs.readFileSync(getRenderModesPublicManifestPath(), "utf-8"),
  );
}

function getRenderModesPublicPages(
  manifest = readRenderModesPublicManifest(),
): Record<string, RenderModesPublicPage> {
  expect(manifest.routing?.kind).toBe("mpa");
  return manifest.routing.pages;
}

function getRenderModesCampaignPpr(
  pages: Record<string, RenderModesPublicPage>,
): NonNullable<RenderModesPublicPage["ppr"]> {
  const ppr = pages.campaign?.ppr;
  expect(ppr).toBeDefined();
  return ppr as NonNullable<RenderModesPublicPage["ppr"]>;
}

function readRenderModesBuildOutput() {
  return JSON.parse(
    fs.readFileSync(
      path.join(exampleDir, "dist", "build-output.json"),
      "utf-8",
    ),
  );
}

function readRenderModesFrameworkRuntime() {
  return JSON.parse(
    fs.readFileSync(path.join(exampleDir, "dist/server/runtime.json"), "utf-8"),
  );
}

function getSinglePprRegion(
  regions: Record<string, { id?: string; cache?: unknown }>,
): { id: string; region: { id?: string; cache?: unknown } } {
  const entries = Object.entries(regions);
  if (entries.length !== 1) {
    throw new Error(
      `Expected one campaign PPR region, received ${entries.length}.`,
    );
  }

  const [id, region] = entries[0];
  expect(id).toMatch(/^region_[0-9a-f]{12}$/);
  expect(region.id).toBe(id);
  return { id, region };
}
