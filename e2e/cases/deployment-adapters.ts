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
    const manifestText = JSON.stringify(manifest);

    expect("distDir" in manifest).toBe(false);
    expect(manifest.paths).toEqual({
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    });
    expect(manifestText).not.toContain('"chunks"');
    expect("apps" in manifest).toBe(false);
    expect("pages" in manifest).toBe(false);
    expect("runtime" in manifest).toBe(false);
    expect(manifest.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "app",
          id: "default",
          fileName: "index.html",
        }),
      ]),
    );
    expect(manifest.routes).toEqual(
      expect.arrayContaining([
        {
          kind: "server-function",
          path: "/__evjs/fn",
          methods: ["POST"],
        },
        {
          kind: "api-route",
          path: "/api/deployment-adapters/health",
          methods: ["GET"],
        },
      ]),
    );
    expect(manifest.server).toEqual(
      expect.objectContaining({
        entry: expect.any(String),
      }),
    );
    expect(manifest.metadata.deploymentAdaptersExample).toEqual({
      app: true,
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
    const deployArtifactText = JSON.stringify(deployArtifact);
    expect(deployArtifact.platform).toBe("deployment-adapters-example");
    expect("distDir" in deployArtifact).toBe(false);
    expect(deployArtifact.paths).toEqual({
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    });
    expect(deployArtifactText).not.toContain('"chunks"');
    expect("app" in deployArtifact).toBe(false);
    expect(deployArtifact.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "app",
          id: "default",
          fileName: "index.html",
        }),
      ]),
    );
    expect(deployArtifact.routes).toEqual(
      expect.arrayContaining([
        {
          kind: "server-function",
          path: "/__evjs/fn",
          methods: ["POST"],
        },
        {
          kind: "api-route",
          path: "/api/deployment-adapters/health",
          methods: ["GET"],
        },
      ]),
    );
    expect(deployArtifact.metadata).toEqual(
      expect.objectContaining({
        deploymentAdaptersExample: manifest.metadata.deploymentAdaptersExample,
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
          entry: expect.any(String),
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
