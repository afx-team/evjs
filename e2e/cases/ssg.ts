import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type {
  DeploymentMetadata,
  PublicManifestOutput,
} from "@evjs/shared/manifest";
import { test as base, expect } from "@playwright/test";
import { buildExample } from "../fixtures.js";

const exampleDir = path.resolve(
  import.meta.dirname,
  "../..",
  "examples",
  "ssg",
);

const test = base.extend<
  { baseURL: string; deploymentMetadata: DeploymentMetadata },
  { _app: { port: number; deploymentMetadata: DeploymentMetadata } }
>({
  _app: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture API requires object destructuring
    async ({}, use, workerInfo) => {
      const bundlerName =
        (workerInfo.project.use as unknown as { bundlerName?: string })
          .bundlerName ?? "utoopack";
      await buildExample(exampleDir, bundlerName);

      const deploymentMetadata = JSON.parse(
        fs.readFileSync(
          path.join(exampleDir, "dist", "build-output.json"),
          "utf-8",
        ),
      ) as DeploymentMetadata;
      const distDir = path.join(exampleDir, "dist", "client");
      const rewrites = createStaticPageRewrites(deploymentMetadata);

      const server = http.createServer((req, res) => {
        const pathname = getRequestPathname(req.url ?? "/");
        const fileName =
          rewrites[pathname] ?? pathname.replace(/^\/+/, "") ?? "report.html";
        const filePath = path.resolve(distDir, fileName);
        const root = path.resolve(distDir);

        if (
          filePath !== root &&
          filePath.startsWith(`${root}${path.sep}`) &&
          fs.existsSync(filePath)
        ) {
          res.writeHead(200, {
            "Content-Type": getContentType(path.extname(filePath)),
          });
          fs.createReadStream(filePath).pipe(res);
          return;
        }

        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      });

      await new Promise<void>((resolve) => {
        server.listen(0, resolve);
      });
      const { port } = server.address() as { port: number };

      await use({ port, deploymentMetadata });

      server.close();
    },
    { scope: "worker" },
  ],
  baseURL: async ({ _app }, use) => {
    await use(`http://localhost:${_app.port}`);
  },
  deploymentMetadata: async ({ _app }, use) => {
    await use(_app.deploymentMetadata);
  },
});

const expectedPages = [
  {
    fileName: "forecast.html",
    heading: "Build-Time Revenue Forecast",
    id: "forecast",
    path: "/forecast",
  },
  {
    fileName: "regions_apac.html",
    heading: "APAC Operations Snapshot",
    id: "regions_apac",
    path: "/regions/apac",
  },
  {
    fileName: "report.html",
    heading: "Build-Time Commerce Report",
    id: "report",
    path: "/report",
  },
] as const;

test.describe("ssg", () => {
  test("emits prerendered static page documents", async ({
    deploymentMetadata,
  }) => {
    const clientManifest = JSON.parse(
      fs.readFileSync(
        path.join(exampleDir, "dist", "client", "manifest.json"),
        "utf-8",
      ),
    ) as PublicManifestOutput;

    expect("routing" in clientManifest).toBe(false);
    expect("assets" in clientManifest).toBe(false);
    if (!("documents" in clientManifest)) {
      throw new Error("Expected SSG public manifest documents.");
    }
    expect(clientManifest.documents).toEqual(
      expectedPages.map((page) => ({
        fileName: page.fileName,
        id: page.id,
        path: page.path,
        render: "ssg",
      })),
    );
    expect(deploymentMetadata.documents).toEqual(
      expectedPages.map((page) => ({
        fileName: page.fileName,
        id: page.id,
        kind: "page",
        path: page.path,
        render: "ssg",
      })),
    );
    expect(deploymentMetadata.server).toEqual({});
    expect(deploymentMetadata.routes).toEqual([]);
    expect(deploymentMetadata.routes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "server-page",
        }),
      ]),
    );

    expect(
      fs.readdirSync(path.join(exampleDir, "dist", "client")).sort(),
    ).toEqual([
      "forecast.html",
      "manifest.json",
      "regions_apac.html",
      "report.html",
    ]);
    expect(fs.existsSync(path.join(exampleDir, "dist", "server"))).toBe(false);

    for (const page of expectedPages) {
      const html = fs.readFileSync(
        path.join(exampleDir, "dist", "client", page.fileName),
        "utf-8",
      );
      expect(html).toContain(page.heading);
      expect(html).toContain("<main");
      expect(html).not.toMatch(/<script[^>]+src=/);
      expect(html).not.toContain("__EVJS_CLIENT_RUNTIME__");
    }
  });

  test("serves pages from static files without a framework server", async ({
    page,
    baseURL,
  }) => {
    for (const staticPage of expectedPages) {
      await page.goto(`${baseURL}${staticPage.path}`);

      await expect(
        page.getByRole("heading", { name: staticPage.heading }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(page.locator("script[src]")).toHaveCount(0);
    }

    await page.goto(`${baseURL}/report`);
    await expect(page.getByTestId("metric-orders")).toHaveText("12,480");
  });
});

function createStaticPageRewrites(
  deploymentMetadata: DeploymentMetadata,
): Record<string, string> {
  return Object.fromEntries(
    deploymentMetadata.documents.flatMap((document) => {
      if (document.kind !== "page" || !document.path?.startsWith("/")) {
        return [];
      }
      return [[document.path, document.fileName]];
    }),
  );
}

function getContentType(ext: string): string {
  switch (ext) {
    case ".html":
      return "text/html";
    case ".js":
    case ".mjs":
      return "application/javascript";
    case ".css":
      return "text/css";
    case ".json":
    case ".map":
      return "application/json";
    default:
      return "text/plain";
  }
}

function getRequestPathname(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url.split("?")[0] || "/";
  }
}
