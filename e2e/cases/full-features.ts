import fs from "node:fs";
import path from "node:path";
import { expect, type Page, type Route } from "@playwright/test";
import { buildExample, createExampleTest } from "../fixtures";

const exampleDir = path.resolve(
  import.meta.dirname,
  "../..",
  "examples",
  "full-features",
);
const remoteExampleDir = path.resolve(
  import.meta.dirname,
  "../..",
  "examples",
  "full-features-remote",
);

const test = createExampleTest("full-features");

test.describe("full-features", () => {
  test.beforeAll(async () => {
    await buildExample(remoteExampleDir, "webpack", false);
  });

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
    await expect(page.locator("html")).toHaveAttribute(
      "data-full-features-html",
      "support",
    );
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

  test("serves PPR shell and dynamic region through the framework server", async ({
    page,
    request,
    baseURL,
    apiURL,
  }) => {
    const browserRegionRequests: string[] = [];
    page.on("request", (browserRequest) => {
      const url = new URL(browserRequest.url());
      if (url.pathname === "/__evjs/ppr/campaign/offer") {
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
    expect(pageHtml).toContain('data-evjs-ppr-stream-region="offer"');
    expect(pageHtml).toContain("Dynamic PPR region rendered on demand");

    const regionResponse = await request.get(
      `${apiURL}/__evjs/ppr/campaign/offer`,
    );
    expect(regionResponse.status()).toBe(200);
    expect(regionResponse.headers()["cache-control"]).toBe("s-maxage=30");
    expect(regionResponse.headers()["x-evjs-cache"]).toBe("MISS");
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

  test("mounts a manifest-driven remote app from the shell runtime", async ({
    page,
    baseURL,
  }) => {
    await routeRemoteAssets(page, remoteExampleDir);
    await page.goto(`${baseURL}/remote.html`);
    await expectRenderMode(page, "csr", "CSR + Remote");
    await expectBackLink(page);

    await expect(
      page.getByRole("heading", { name: "CRM Workspace Host" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("remote-status")).toHaveText(
      "Remote: mounted",
    );
    await expect(
      page.getByRole("heading", { name: "Northstar Outdoor" }),
    ).toBeVisible();
    const remoteCard = page.getByTestId("crm-remote-card");
    await expect(remoteCard).toBeVisible();
    await expect(remoteCard).toHaveCSS("background-image", /linear-gradient/);
    await expect(page.getByTestId("remote-health-score")).toHaveText("92");
    await expect(remoteCard).toContainText("expansion-ready");
    await expect(page.getByTestId("remote-open-revenue")).toHaveText("$184.2k");
    await expect(page.getByTestId("remote-success-owner")).toHaveText(
      "Grace Hopper",
    );
    await expect(remoteCard).toContainText("Schedule retention offer review");
    await expect(page.getByTestId("remote-entry")).toHaveText("customers");
    await expect(page.getByTestId("remote-url")).toHaveText("/crm/customers");
    await expect(page.getByTestId("remote-shared")).toHaveText(
      "Shared: crm: remote-react -> 19.2.5",
    );
    await expect(page.getByTestId("remote-source")).toContainText(
      "served from",
    );

    const remoteManifest = JSON.parse(
      fs.readFileSync(
        path.join(remoteExampleDir, "dist", "evjs-remote.json"),
        "utf-8",
      ),
    );
    expect(remoteManifest.shared).toEqual({
      "remote-react": {
        shareKey: "react",
        requiredVersion: ">=19 <20",
        singleton: true,
        eager: true,
      },
    });
  });

  test("runs an app route source with SSR, PPR, RSC, and remote routes", async ({
    page,
    request,
    baseURL,
    apiURL,
  }) => {
    await page.goto(`${baseURL}/render-lab.html`);
    await expectRenderMode(page, "csr", "App Routes");
    await expect(
      page.getByRole("heading", { name: "Render Lab App" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("/app/dashboard")).toBeVisible();
    await expect(page.getByText("/app/campaign")).toBeVisible();
    await expect(page.getByText("/app/insights")).toBeVisible();
    await expect(page.getByText("/app/remote")).toBeVisible();

    await page.goto(`${baseURL}/app/dashboard`);
    await expectRenderMode(page, "ssr", "SSR");
    await expect(page.getByTestId("dashboard-page")).toHaveText(
      "render-lab_dashboard",
    );
    await expect(page.getByTestId("dashboard-route")).toHaveText(
      "/app/dashboard",
    );
    await expect(
      page.getByRole("heading", { name: "Revenue Risk Dashboard" }),
    ).toBeVisible();

    await page.goto(`${baseURL}/app/campaign`);
    await expectRenderMode(page, "ppr", "PPR");
    await expect(page.getByTestId("campaign-page")).toHaveText(
      "render-lab_campaign",
    );
    await expect(page.getByTestId("offer-region")).toContainText(
      "Dynamic PPR region rendered on demand",
    );
    const appPprResponse = await request.get(`${apiURL}/app/campaign`);
    expect(appPprResponse.status()).toBe(200);
    expect(await appPprResponse.text()).toContain("Offer Region");
    const appRegionResponse = await request.get(
      `${apiURL}/__evjs/ppr/render-lab_campaign/offer`,
    );
    expect(appRegionResponse.status()).toBe(200);
    expect(await appRegionResponse.text()).toContain("Offer Region");

    const appRscFlightResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/__evjs/rsc" &&
        url.searchParams.get("page") === "render-lab_insights"
      );
    });
    await page.goto(`${baseURL}/app/insights`);
    const appRscFlightResponse = await appRscFlightResponsePromise;
    expect(appRscFlightResponse.status()).toBe(200);
    await expectRenderMode(page, "rsc", "RSC");
    await expect(page.getByTestId("insights-route")).toHaveText(
      "Route: /app/insights",
    );
    await expect(
      page.getByRole("heading", { name: "Profitability Insights" }),
    ).toBeVisible();

    await routeRemoteAssets(page, remoteExampleDir);
    await page.goto(`${baseURL}/app/remote`);
    await expectRenderMode(page, "csr", "CSR + Remote");
    await expect(page.getByTestId("remote-status")).toHaveText(
      "Remote: mounted",
    );
    await expect(page.getByTestId("remote-entry")).toHaveText("customers");
  });

  test("emits a single manifest with app, page, route, server, and plugin data", async () => {
    const manifestPath = path.join(exampleDir, "dist", "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    expect(manifest.apps.default).toEqual(
      expect.objectContaining({
        mount: "#app",
        module: expect.objectContaining({ type: "entry" }),
      }),
    );
    expect(manifest.apps["render-lab"]).toEqual(
      expect.objectContaining({
        mount: "#app",
        module: expect.objectContaining({ type: "entry" }),
      }),
    );
    expect(manifest.pages.support).toEqual(
      expect.objectContaining({
        render: "csr",
        rendering: {
          mode: "csr",
          component: "client",
          html: "client",
          streaming: false,
          hydrate: "load",
        },
        module: expect.objectContaining({ type: "react-component" }),
      }),
    );
    expect(manifest.pages.dashboard).toEqual(
      expect.objectContaining({
        path: "/dashboard",
        render: "ssr",
        rendering: {
          mode: "ssr",
          component: "server",
          html: "server",
          streaming: false,
          hydrate: "load",
        },
        routeId: "dashboard",
      }),
    );
    expect(manifest.pages.insights).toEqual(
      expect.objectContaining({
        path: "/insights",
        render: "rsc",
        rendering: {
          mode: "rsc",
          component: "rsc",
          html: "server",
          streaming: true,
          hydrate: "load",
        },
        routeId: "insights",
      }),
    );
    expect(manifest.pages.remote).toEqual(
      expect.objectContaining({
        render: "csr",
        rendering: expect.objectContaining({
          mode: "csr",
          component: "client",
          html: "client",
        }),
      }),
    );
    expect(manifest.pages.campaign).toEqual(
      expect.objectContaining({
        path: "/campaign",
        render: "ppr",
        rendering: {
          mode: "ppr",
          component: "server",
          html: "partial",
          prerender: "partial",
          streaming: true,
          hydrate: "none",
        },
      }),
    );
    expect(manifest.pages.campaign.ppr.regions.offer).toEqual(
      expect.objectContaining({
        cache: { revalidate: 30 },
      }),
    );
    expect(manifest.pages.campaign.ppr.delivery).toBe("stream");
    expect(manifest.pages["render-lab_dashboard"]).toEqual(
      expect.objectContaining({
        render: "ssr",
        routeId: "render-lab.dashboard",
      }),
    );
    expect(manifest.pages["render-lab_campaign"]).toEqual(
      expect.objectContaining({
        render: "ppr",
        routeId: "render-lab.campaign",
      }),
    );
    expect(manifest.pages["render-lab_insights"]).toEqual(
      expect.objectContaining({
        render: "rsc",
        routeId: "render-lab.insights",
      }),
    );
    expect(manifest.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "dashboard",
          path: "/dashboard",
          appId: "default",
          pageId: "dashboard",
        }),
        expect.objectContaining({
          id: "campaign",
          path: "/campaign",
          appId: "default",
          pageId: "campaign",
        }),
        expect.objectContaining({
          id: "insights",
          path: "/insights",
          appId: "default",
          pageId: "insights",
        }),
        expect.objectContaining({
          id: "render-lab.dashboard",
          path: "/app/dashboard",
          appId: "render-lab",
          pageId: "render-lab_dashboard",
        }),
        expect.objectContaining({
          id: "render-lab.campaign",
          path: "/app/campaign",
          appId: "render-lab",
          pageId: "render-lab_campaign",
        }),
        expect.objectContaining({
          id: "render-lab.insights",
          path: "/app/insights",
          appId: "render-lab",
          pageId: "render-lab_insights",
        }),
        expect.objectContaining({
          id: "render-lab.remote",
          path: "/app/remote",
          appId: "render-lab",
        }),
      ]),
    );
    expect(Object.values(manifest.server.functions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exportName: "getMerchantOperationsSnapshot",
        }),
      ]),
    );
    expect(manifest.server.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/api/full-features/health",
          methods: expect.arrayContaining(["GET"]),
        }),
      ]),
    );
    expect(manifest.runtime.server).toEqual(
      expect.objectContaining({
        basePath: "/__evjs",
        fn: "/__evjs/fn",
        ppr: "/__evjs/ppr",
        rsc: "/__evjs/rsc",
      }),
    );
    expect(manifest.rsc.pages.insights).toEqual(
      expect.objectContaining({
        renderer: "insights-rsc",
        routeId: "insights",
        assets: expect.objectContaining({
          css: expect.arrayContaining(["insights-rsc.css"]),
        }),
      }),
    );
    expect(manifest.rsc.pages["render-lab_insights"]).toEqual(
      expect.objectContaining({
        renderer: "render-lab_insights-rsc",
        routeId: "render-lab.insights",
      }),
    );
    expect(manifest.rsc.clientReferences).toBeUndefined();
    expect(manifest.rsc.clientReferenceManifest).toBeUndefined();
    expect(manifest.rsc.serverConsumerManifest).toBeUndefined();
    const publicManifestText = fs.readFileSync(manifestPath, "utf-8");
    expect(publicManifestText).not.toContain(".tsx");
    expect(publicManifestText).not.toContain("file://");
    expect(publicManifestText).not.toContain(exampleDir);
    expect(manifest.remotes.crm).toEqual({
      manifest: "https://assets.example.com/crm/evjs-remote.json",
      activeWhen: ["/crm/*"],
    });
    expect(manifest.deployment.fullFeaturesExample).toEqual({
      apps: ["default", "render-lab"],
      pages: [
        "support",
        "campaign",
        "dashboard",
        "insights",
        "remote",
        "render-lab_dashboard",
        "render-lab_campaign",
        "render-lab_insights",
      ],
      rscPages: ["insights", "render-lab_insights"],
      remotes: ["crm"],
      serverBasePath: "/__evjs",
    });

    const deployArtifactPath = path.join(
      exampleDir,
      "dist",
      "deployment.full-features.json",
    );
    const deployArtifact = JSON.parse(
      fs.readFileSync(deployArtifactPath, "utf-8"),
    );
    expect(deployArtifact).toEqual(
      expect.objectContaining({
        platform: "full-features-example",
        server: expect.objectContaining({
          basePath: "/__evjs",
          rsc: "/__evjs/rsc",
        }),
        rsc: expect.objectContaining({
          endpoint: "/__evjs/rsc",
          pages: expect.arrayContaining(["insights", "render-lab_insights"]),
        }),
        remotes: expect.objectContaining({
          crm: manifest.remotes.crm,
        }),
      }),
    );
    expect(
      deployArtifact.routes.map((route: { path: string }) => route.path),
    ).toEqual(
      expect.arrayContaining([
        "/campaign",
        "/dashboard",
        "/insights",
        "/app/campaign",
        "/app/dashboard",
        "/app/insights",
        "/app/remote",
      ]),
    );

    const nodeArtifact = JSON.parse(
      fs.readFileSync(
        path.join(exampleDir, "dist", "deployment.node.json"),
        "utf-8",
      ),
    );
    expect(nodeArtifact).toEqual(
      expect.objectContaining({
        platform: "node",
        server: expect.objectContaining({
          basePath: "/__evjs",
          rsc: "/__evjs/rsc",
        }),
      }),
    );
    expect(
      fs.readFileSync(path.join(exampleDir, "dist", "server.mjs"), "utf-8"),
    ).toMatch(/import serverHandler from "\.\/server\/server\.[^"]+\.js";/);

    const staticArtifact = JSON.parse(
      fs.readFileSync(
        path.join(exampleDir, "dist", "client", "deployment.static.json"),
        "utf-8",
      ),
    );
    expect(staticArtifact.platform).toBe("static");
    const redirects = fs.readFileSync(
      path.join(exampleDir, "dist", "client", "_redirects"),
      "utf-8",
    );
    expect(redirects).toContain("/support /support.html 200");
    expect(redirects).toContain("/* /index.html 200");

    const edgeArtifact = JSON.parse(
      fs.readFileSync(
        path.join(exampleDir, "dist", "deployment.edge.json"),
        "utf-8",
      ),
    );
    expect(edgeArtifact.platform).toBe("edge");
    const edgeWorker = fs.readFileSync(
      path.join(exampleDir, "dist", "worker.mjs"),
      "utf-8",
    );
    expect(edgeWorker).toContain('const frameworkBasePath = "/__evjs";');
    expect(edgeWorker).toContain('const assetsBinding = "ASSETS";');
  });
});

async function expectRenderMode(
  page: Page,
  mode: "csr" | "ssr" | "ppr" | "rsc",
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

async function routeRemoteAssets(page: Page, remoteDir: string): Promise<void> {
  const distDir = path.join(remoteDir, "dist");
  const fulfillRemoteAsset = async (route: Route) => {
    const requestUrl = new URL(route.request().url());
    const assetName = requestUrl.pathname
      .replace(/^\/crm\//, "")
      .replace(/^\/+/, "");
    const filePath = path.join(distDir, assetName || "evjs-remote.json");

    if (!fs.existsSync(filePath)) {
      await route.fulfill({
        status: 404,
        contentType: "text/plain",
        body: `Remote asset not found: ${assetName}`,
      });
      return;
    }

    await route.fulfill({
      path: filePath,
      contentType: getRemoteContentType(filePath),
    });
  };

  await page.route("https://assets.example.com/crm/**", fulfillRemoteAsset);
  await page.route("http://localhost:3002/**", fulfillRemoteAsset);
}

function getRemoteContentType(filePath: string): string {
  switch (path.extname(filePath)) {
    case ".json":
      return "application/json";
    case ".js":
      return "application/javascript";
    case ".css":
      return "text/css";
    default:
      return "text/plain";
  }
}
