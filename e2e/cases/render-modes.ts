import fs from "node:fs";
import path from "node:path";
import type { PageMetadata } from "@evjs/shared/manifest";
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

interface RenderModesPublicRoute {
  id: string;
  path: string;
  pageId?: string;
  render?: string;
  metadata?: PageMetadata;
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
    await expect(page).toHaveTitle("Acme Pay Control Center");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Monitor payment operations, risk, and settlement readiness.",
    );
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
    await expect(page).toHaveTitle("Revenue Risk Dashboard | Acme Pay");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Review revenue risk and payment operations requiring action.",
    );
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
    await expect(page).toHaveTitle("Acme Pay Control Center");
    await expect(page.locator('meta[name="keywords"]')).toHaveAttribute(
      "content",
      "payments,operations,risk",
    );
  });

  test("serves a full-prerendered SSR page path through the framework server", async ({
    page,
    request,
    baseURL,
    apiURL,
  }) => {
    const htmlResponse = await request.get(`${apiURL}/settlement-report`);
    expect(htmlResponse.status()).toBe(200);
    const html = await htmlResponse.text();
    expect(html).toContain("Settlement Readiness Report");
    expect(html).toContain('data-render-mode="ssr"');
    expect(html).toContain(">Settlement Readiness Report | Acme Pay</title>");
    expect(html).toContain(
      'content="A prerendered report of settlement readiness by region."',
    );
    expect(html).toContain('data-evjs-page-metadata="title"');
    expect(html).toContain('data-evjs-page-metadata="meta"');
    expect(html).not.toContain("settlement.js");

    await page.goto(`${baseURL}/settlement-report`);
    await expectRenderMode(page, "ssr", "Prerendered SSR");
    await expectBackLink(page);

    await expect(
      page.getByRole("heading", { name: "Settlement Readiness Report" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveTitle("Settlement Readiness Report | Acme Pay");
    await expect(page.getByTestId("settlement-render-mode")).toHaveText(
      "full prerender",
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
    frameworkRuntime,
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
    const runtimePages = getRenderModesRuntimePages(frameworkRuntime);
    const campaignPpr = getRenderModesCampaignPpr(runtimePages);
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
    // The HTML parser serializes boolean attributes as `defer=""`.
    expect(html).toContain('<script defer="" src="/evjs-rsc-client');
    expect(html).not.toContain('<script type="module"');
    expect(html).not.toContain("src/pages/insights/page.tsx");
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

  test("emits canonical Page routes and rendering metadata", async ({
    frameworkRuntime,
  }) => {
    const manifestPath = getRenderModesDeploymentMetadataPath();
    const deploymentMetadata = readRenderModesDeploymentMetadata();
    const deploymentMetadataText = JSON.stringify(deploymentMetadata);
    const runtimePages = getRenderModesRuntimePages(frameworkRuntime);
    const runtimeRoutes = getRenderModesRuntimeRoutes(frameworkRuntime);

    expect("distDir" in deploymentMetadata).toBe(false);
    expect(deploymentMetadata.paths).toEqual({
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    });
    expect(deploymentMetadataText).not.toContain('"chunks"');
    expect(deploymentMetadataText).not.toContain('"renderers"');
    expect(deploymentMetadata).not.toHaveProperty("apps");
    expect(deploymentMetadata).not.toHaveProperty("pages");
    expect(deploymentMetadata).not.toHaveProperty("runtime");
    expect(deploymentMetadata.assets).toEqual(
      expect.objectContaining({
        main: expect.objectContaining({
          js: expect.arrayContaining([expect.stringMatching(/^main\..+\.js$/)]),
        }),
      }),
    );
    expect(frameworkRuntime.routing.kind).toBe("spa");
    expect(runtimeRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "index",
          path: "/",
        }),
        expect.objectContaining({
          id: "support",
          path: "/support",
        }),
        expect.objectContaining({
          id: "dashboard",
          pageId: "dashboard",
          path: "/dashboard",
        }),
        expect.objectContaining({
          id: "campaign",
          pageId: "campaign",
          path: "/campaign",
        }),
        expect.objectContaining({
          id: "settlement-report",
          pageId: "settlement-report",
          path: "/settlement-report",
        }),
        expect.objectContaining({
          id: "insights",
          pageId: "insights",
          path: "/insights",
        }),
      ]),
    );
    expect(runtimePages.index?.metadata).toEqual({
      title: "Acme Pay Control Center",
      meta: {
        description:
          "Monitor payment operations, risk, and settlement readiness.",
        keywords: "payments,operations,risk",
        viewport: "width=device-width, initial-scale=1",
        "theme-color": "#0f172a",
      },
    });
    expect(runtimePages.dashboard?.metadata).toEqual({
      title: "Revenue Risk Dashboard | Acme Pay",
      meta: {
        description:
          "Review revenue risk and payment operations requiring action.",
        "theme-color": "#0f172a",
      },
    });
    expect(runtimePages["settlement-report"]?.metadata).toEqual({
      title: "Settlement Readiness Report | Acme Pay",
      meta: {
        description: "A prerendered report of settlement readiness by region.",
        "theme-color": "#0f172a",
      },
    });
    expect(runtimePages.dashboard).toEqual(
      expect.objectContaining({
        path: "/dashboard",
        routeId: "dashboard",
      }),
    );
    expect(runtimePages["settlement-report"]).toEqual(
      expect.objectContaining({
        path: "/settlement-report",
        routeId: "settlement-report",
      }),
    );
    // Request-time SSR Pages receive a compiled server document shell, even
    // when their full prerender disables client hydration.
    expect(runtimePages["settlement-report"].document).toEqual(
      expect.objectContaining({
        afterData: expect.any(String),
        beforeContent: expect.any(String),
        betweenContentAndData: expect.any(String),
      }),
    );
    expect(runtimePages["settlement-report"].module).toBeUndefined();
    expect(runtimePages.insights).toEqual(
      expect.objectContaining({
        path: "/insights",
        routeId: "insights",
      }),
    );
    expect(runtimePages.campaign).toEqual(
      expect.objectContaining({
        path: "/campaign",
        routeId: "campaign",
      }),
    );

    expect(runtimePages.dashboard).toEqual(
      expect.objectContaining({
        render: "ssr",
        rendering: {
          component: "server",
          html: "server",
          streaming: false,
          hydrate: "load",
        },
      }),
    );
    expect(runtimePages["settlement-report"]).toEqual(
      expect.objectContaining({
        render: "ssr",
        rendering: {
          component: "server",
          html: "server",
          prerender: "full",
          streaming: false,
          hydrate: "none",
        },
      }),
    );
    expect(runtimePages.insights).toEqual(
      expect.objectContaining({
        render: "ssr",
        componentModel: "rsc",
        rendering: {
          component: "rsc",
          html: "server",
          streaming: true,
          hydrate: "none",
        },
      }),
    );
    expect(runtimePages.campaign).toEqual(
      expect.objectContaining({
        render: "ssr",
        rendering: {
          component: "server",
          html: "partial",
          prerender: "partial",
          streaming: true,
          hydrate: "none",
        },
      }),
    );
    const campaignPpr = getRenderModesCampaignPpr(runtimePages);
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
    expect(deploymentMetadata.routes).toEqual(
      expect.arrayContaining([
        {
          kind: "server-page",
          path: "/dashboard",
          pageId: "dashboard",
          render: "ssr",
          methods: ["GET", "HEAD"],
        },
        {
          kind: "server-page",
          path: "/settlement-report",
          pageId: "settlement-report",
          render: "ssr",
          prerender: "full",
          methods: ["GET", "HEAD"],
        },
        {
          kind: "server-page",
          path: "/campaign",
          pageId: "campaign",
          render: "ssr",
          prerender: "partial",
          methods: ["GET", "HEAD"],
        },
        {
          kind: "server-page",
          path: "/insights",
          pageId: "insights",
          render: "ssr",
          rsc: true,
          methods: ["GET", "HEAD"],
        },
        {
          kind: "server-function",
          path: "/__evjs/fn",
          methods: ["POST"],
        },
        {
          kind: "ppr-endpoint",
          path: "/__evjs/ppr/*",
          methods: ["GET", "HEAD"],
        },
        {
          kind: "rsc-endpoint",
          path: "/__evjs/rsc",
          methods: ["GET", "HEAD"],
        },
        {
          kind: "api-route",
          path: "/api/render-modes/health",
          methods: ["GET"],
        },
      ]),
    );
    expect(deploymentMetadata.server).toEqual(
      expect.objectContaining({
        entry: expect.any(String),
      }),
    );
    expect("runtime" in deploymentMetadata).toBe(false);
    expect("rsc" in deploymentMetadata).toBe(false);
    expect(frameworkRuntime.runtime.server).toEqual(
      expect.objectContaining({
        basePath: "/__evjs",
        fn: "__evjs/fn",
        ppr: "__evjs/ppr",
        rsc: "__evjs/rsc",
      }),
    );
    expect(frameworkRuntime.rsc).toBeDefined();
    expect(frameworkRuntime.rsc?.pages).toBeDefined();
    expect(frameworkRuntime.rsc?.pages?.insights).toEqual(
      expect.objectContaining({
        renderer: "insights-rsc",
        routeId: "insights",
        assets: expect.objectContaining({
          css: expect.arrayContaining(["insights-rsc.css"]),
        }),
      }),
    );
    expect(frameworkRuntime.rsc?.clientReferenceManifest).toBeDefined();
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
    expect(
      fs.existsSync(path.join(exampleDir, "dist/client/manifest.json")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(exampleDir, "dist/server/manifest.json")),
    ).toBe(false);
    expect(fs.existsSync(path.join(exampleDir, "dist/build-output.json"))).toBe(
      false,
    );

    const deploymentMetadataFileText = fs.readFileSync(manifestPath, "utf-8");
    expect(deploymentMetadataFileText).not.toContain('"distDir"');
    expect(deploymentMetadataFileText).not.toContain('"chunks"');
    expect(deploymentMetadataFileText).not.toContain(".tsx");
    expect(deploymentMetadataFileText).not.toContain("file://");
    expect(deploymentMetadataFileText).not.toContain(exampleDir);
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

function getRenderModesRuntimePages(frameworkRuntime: {
  routing: {
    kind: string;
    pages: Record<string, RenderModesPublicPage>;
  };
}): Record<string, RenderModesPublicPage> {
  return frameworkRuntime.routing.pages;
}

function getRenderModesRuntimeRoutes(frameworkRuntime: {
  routing: {
    kind: string;
    routes?: RenderModesPublicRoute[];
  };
}): RenderModesPublicRoute[] {
  expect(frameworkRuntime.routing.kind).toBe("spa");
  return frameworkRuntime.routing.routes ?? [];
}

function getRenderModesCampaignPpr(
  pages: Record<string, RenderModesPublicPage>,
): NonNullable<RenderModesPublicPage["ppr"]> {
  const ppr = pages.campaign?.ppr;
  expect(ppr).toBeDefined();
  return ppr as NonNullable<RenderModesPublicPage["ppr"]>;
}

function readRenderModesDeploymentMetadata() {
  return JSON.parse(
    fs.readFileSync(getRenderModesDeploymentMetadataPath(), "utf-8"),
  );
}

function getRenderModesDeploymentMetadataPath(): string {
  return path.join(exampleDir, "dist", "deployment-metadata.json");
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
