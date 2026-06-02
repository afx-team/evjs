import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page } from "@playwright/test";
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

  test("runs explicit app entry with server function and REST route", async ({
    page,
    baseURL,
  }) => {
    const rpcResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/framework/fn" &&
        response.request().method() === "POST"
      );
    });

    await page.goto(baseURL);

    const rpcResponse = await rpcResponsePromise;
    expect(rpcResponse.status()).toBe(200);

    await expect(
      page.getByRole("heading", { name: "ev Full Features Example" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("operators-count")).toHaveText(
      "Operators: 3",
    );
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await expect(page.getByTestId("health-route")).toHaveText(
      "full-features-health",
    );
  });

  test("mounts a framework-managed CSR component page", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/support.html`);

    await expect(
      page.getByRole("heading", { name: "Support Component Page" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("html")).toHaveAttribute(
      "data-full-features-html",
      "support",
    );
  });

  test("renders configured SSR page path through the framework server", async ({
    page,
    apiURL,
  }) => {
    await page.goto(`${apiURL}/dashboard`);

    await expect(
      page.getByRole("heading", { name: "SSR Dashboard" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("dashboard-page")).toHaveText(
      "Page: dashboard",
    );
    await expect(page.getByTestId("dashboard-route")).toHaveText(
      "Route: /dashboard",
    );
  });

  test("serves PPR shell and dynamic region through the framework server", async ({
    page,
    request,
    apiURL,
  }) => {
    await page.goto(`${apiURL}/campaign`);

    await expect(
      page.getByRole("heading", { name: "PPR Campaign" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("campaign-page")).toHaveText(
      "Page: campaign",
    );

    const regionResponse = await request.get(
      `${apiURL}/framework/ppr/campaign/offer`,
    );
    expect(regionResponse.status()).toBe(200);
    expect(regionResponse.headers()["cache-control"]).toBe("s-maxage=30");
    expect(regionResponse.headers()["x-evjs-cache"]).toBe("MISS");
    await expect(regionResponse.text()).resolves.toContain("Offer Region");
  });

  test("serves an RSC page and framework RSC endpoint through the server runtime", async ({
    page,
    request,
    apiURL,
  }) => {
    await page.goto(`${apiURL}/insights`);

    await expect(
      page.getByRole("heading", { name: "RSC Insights" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("insights-page")).toHaveText(
      "Page: insights",
    );
    await expect(page.getByTestId("insights-route")).toHaveText(
      "Route: /insights",
    );
    await expect(page.getByTestId("insights-badge")).toHaveText(
      "Client reference badge",
    );

    const flightResponse = await request.get(
      `${apiURL}/framework/rsc?page=insights`,
    );
    expect(flightResponse.status()).toBe(200);
    expect(flightResponse.headers()["content-type"]).toContain(
      "text/x-component",
    );
    const flightText = await flightResponse.text();
    expect(flightText).toContain("RSC Insights");
    expect(flightText).toContain("insights");
  });

  test("mounts a manifest-driven remote app from the shell runtime", async ({
    page,
    baseURL,
  }) => {
    await routeRemoteAssets(page, remoteExampleDir);
    await page.goto(`${baseURL}/remote.html`);

    await expect(
      page.getByRole("heading", { name: "Remote Host" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("remote-status")).toHaveText(
      "Remote: mounted",
    );
    await expect(
      page.getByRole("heading", { name: "CRM Remote" }),
    ).toBeVisible();
    await expect(page.getByTestId("remote-entry")).toHaveText(
      "Entry: customers",
    );
    await expect(page.getByTestId("remote-url")).toHaveText(
      "URL: /crm/customers",
    );
    await expect(page.getByTestId("remote-shared")).toHaveText(
      "Shared remote-react: 19.2.5",
    );
    await expect(page.getByTestId("remote-init")).toHaveText(
      "Init shared react: 19.2.5",
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

  test("emits a single manifest with app, page, route, server, and plugin data", async () => {
    const manifestPath = path.join(exampleDir, "dist", "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    expect(manifest.apps.default).toEqual(
      expect.objectContaining({
        entry: "./src/main.tsx",
      }),
    );
    expect(manifest.pages.support).toEqual(
      expect.objectContaining({
        render: "csr",
        component: "./src/pages/Support.tsx",
        module: expect.objectContaining({ type: "react-component" }),
      }),
    );
    expect(manifest.pages.dashboard).toEqual(
      expect.objectContaining({
        path: "/dashboard",
        component: "./src/pages/Dashboard.tsx",
        render: "ssr",
        routeId: "dashboard",
      }),
    );
    expect(manifest.pages.insights).toEqual(
      expect.objectContaining({
        path: "/insights",
        component: "./src/pages/Insights.tsx",
        render: "rsc",
        routeId: "insights",
      }),
    );
    expect(manifest.pages.remote).toEqual(
      expect.objectContaining({
        component: "./src/pages/RemoteHost.tsx",
        render: "csr",
      }),
    );
    expect(manifest.pages.campaign).toEqual(
      expect.objectContaining({
        path: "/campaign",
        render: "ppr",
      }),
    );
    expect(manifest.pages.campaign.ppr.regions.offer).toEqual(
      expect.objectContaining({
        component: "./src/pages/OfferRegion.tsx",
        cache: { revalidate: 30 },
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
      ]),
    );
    expect(Object.values(manifest.server.functions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module: "src/api/operators.server.ts",
          exportName: "getMerchantOperators",
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
        basePath: "/framework",
        fn: "/framework/fn",
        ppr: "/framework/ppr",
        rsc: "/framework/rsc",
      }),
    );
    expect(manifest.rsc.pages.insights).toEqual(
      expect.objectContaining({
        renderer: "insights-rsc",
        component: "./src/pages/Insights.tsx",
      }),
    );
    expect(manifest.rsc.clientReferences).toEqual(
      expect.objectContaining({
        "src/pages/InsightsBadge.tsx#default": {
          module: "src/pages/InsightsBadge.tsx",
          exportName: "default",
        },
      }),
    );
    expect(manifest.rsc.clientReferenceManifest).toEqual(
      expect.objectContaining({
        [pathToFileURL(path.join(exampleDir, "src/pages/InsightsBadge.tsx"))
          .href]: expect.objectContaining({
          name: "*",
        }),
      }),
    );
    expect(manifest.rsc.serverConsumerManifest).toEqual(
      expect.objectContaining({
        moduleMap: expect.any(Object),
      }),
    );
    expect(manifest.remotes.crm).toEqual({
      manifest: "https://assets.example.com/crm/evjs-remote.json",
      activeWhen: ["/crm/*"],
    });
    expect(manifest.deployment.fullFeaturesExample).toEqual({
      apps: ["default"],
      pages: ["support", "campaign", "dashboard", "insights", "remote"],
      rscPages: ["insights"],
      remotes: ["crm"],
      serverBasePath: "/framework",
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
          basePath: "/framework",
          rsc: "/framework/rsc",
        }),
        rsc: expect.objectContaining({
          endpoint: "/framework/rsc",
          pages: ["insights"],
        }),
        remotes: expect.objectContaining({
          crm: manifest.remotes.crm,
        }),
      }),
    );
    expect(
      deployArtifact.routes.map((route: { path: string }) => route.path),
    ).toEqual(expect.arrayContaining(["/campaign", "/dashboard", "/insights"]));

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
          basePath: "/framework",
          rsc: "/framework/rsc",
        }),
      }),
    );
    expect(
      fs.readFileSync(path.join(exampleDir, "dist", "server.mjs"), "utf-8"),
    ).toMatch(/import serverHandler from "\.\/server\/server\.[^"]+\.js";/);

    const staticArtifact = JSON.parse(
      fs.readFileSync(
        path.join(exampleDir, "dist", "deployment.static.json"),
        "utf-8",
      ),
    );
    expect(staticArtifact.platform).toBe("static");
    const redirects = fs.readFileSync(
      path.join(exampleDir, "dist", "_redirects"),
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
    expect(edgeWorker).toContain('const frameworkBasePath = "/framework";');
    expect(edgeWorker).toContain('const assetsBinding = "ASSETS";');
  });
});

async function routeRemoteAssets(page: Page, remoteDir: string): Promise<void> {
  const distDir = path.join(remoteDir, "dist");
  await page.route("https://assets.example.com/crm/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const assetName = requestUrl.pathname.replace(/^\/crm\/?/, "");
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
  });
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
