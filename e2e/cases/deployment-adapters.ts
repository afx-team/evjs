import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { createExampleTest } from "../fixtures";

const exampleDir = path.resolve(
  import.meta.dirname,
  "../..",
  "examples",
  "deployment-adapters",
);

const test = createExampleTest("deployment-adapters");

test.describe("deployment-adapters", () => {
  test("runs the deployment fixture app with transformed HTML", async ({
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
    await expect(page.locator("html")).toHaveAttribute(
      "data-deployment-example-html",
      "default",
    );
    await expect(
      page.locator('meta[name="evjs-deployment-example-html"]'),
    ).toHaveAttribute("content", "app:default");

    await expect(
      page.getByRole("heading", { name: "Acme Pay Deployment Console" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("gmv")).toHaveText("$262.5k");
    await expect(page.getByTestId("approval-rate")).toHaveText("97.8%");
    await expect(page.getByTestId("risk-queue")).toHaveText("2 active");
    await expect(page.getByTestId("health-route")).toHaveText(
      "merchant-ops-health",
    );
    await expect(page.getByTestId("risk-service")).toHaveText(
      "Risk service: watch",
    );
  });

  test("emits manifest and deployment artifacts from BuildOutput", async () => {
    const manifestPath = path.join(exampleDir, "dist", "build-output.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    expect(manifest.apps.default).toEqual(
      expect.objectContaining({
        mount: "#app",
        module: expect.objectContaining({ type: "entry" }),
      }),
    );
    expect(manifest.pages ?? {}).toEqual({});
    expect(manifest.routes ?? []).toEqual([]);
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
          path: "/api/deployment-adapters/health",
          methods: expect.arrayContaining(["GET"]),
        }),
      ]),
    );
    expect(manifest.runtime.server).toEqual(
      expect.objectContaining({
        basePath: "/__evjs",
        fn: "/__evjs/fn",
      }),
    );
    expect(manifest.deployment.deploymentAdaptersExample).toEqual({
      apps: ["default"],
      pages: [],
      rscPages: [],
      serverBasePath: "/__evjs",
    });

    const deployArtifact = JSON.parse(
      fs.readFileSync(
        path.join(exampleDir, "dist", "deployment.example.json"),
        "utf-8",
      ),
    );
    expect(deployArtifact.platform).toBe("deployment-adapters-example");
    expect(deployArtifact.apps.default).toEqual(
      expect.objectContaining({ mount: "#app" }),
    );
    expect(deployArtifact.server).toEqual(
      expect.objectContaining({
        basePath: "/__evjs",
        fn: "/__evjs/fn",
      }),
    );
    expect(deployArtifact.server.functions).toHaveLength(1);
    expect(deployArtifact.server.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/api/deployment-adapters/health",
        }),
      ]),
    );
    expect(deployArtifact.metadata).toEqual(
      expect.objectContaining({
        deploymentAdaptersExample:
          manifest.deployment.deploymentAdaptersExample,
      }),
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
        }),
      }),
    );
    expect(
      fs.readFileSync(path.join(exampleDir, "dist", "server.mjs"), "utf-8"),
    ).toMatch(
      /await import\(pathToFileURL\(path\.join\(serverDir, serverEntry\)\)\.href\)/,
    );

    const staticArtifact = JSON.parse(
      fs.readFileSync(
        path.join(exampleDir, "dist", "client", "deployment.static.json"),
        "utf-8",
      ),
    );
    expect(staticArtifact.platform).toBe("static");
    expect(staticArtifact.metadata.static).toEqual({
      complete: false,
      unsupportedCapabilities: ["server-functions", "server-routes"],
    });
    const redirects = fs.readFileSync(
      path.join(exampleDir, "dist", "client", "_redirects"),
      "utf-8",
    );
    expect(redirects).not.toContain("/* /index.html 200");

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
