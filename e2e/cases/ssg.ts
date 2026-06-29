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

test.describe("ssg", () => {
  test("emits a prerendered static page document", async ({
    deploymentMetadata,
  }) => {
    const clientManifest = JSON.parse(
      fs.readFileSync(
        path.join(exampleDir, "dist", "client", "manifest.json"),
        "utf-8",
      ),
    ) as PublicManifestOutput;

    expect(clientManifest.routing.kind).toBe("spa");
    if (clientManifest.routing.kind !== "spa") {
      throw new Error("Expected SSG example to use SPA routing.");
    }
    expect(clientManifest.routing.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "report",
          path: "/report",
        }),
      ]),
    );
    expect(deploymentMetadata.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileName: "report.html",
          id: "report",
          kind: "page",
        }),
      ]),
    );
    expect(deploymentMetadata.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: "report",
          kind: "static-page",
          methods: ["GET", "HEAD"],
          path: "/report",
          render: "ssg",
        }),
      ]),
    );
    expect(deploymentMetadata.routes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "server-page",
          pageId: "report",
        }),
      ]),
    );

    const html = fs.readFileSync(
      path.join(exampleDir, "dist", "client", "report.html"),
      "utf-8",
    );
    expect(html).toContain("Build-Time Commerce Report");
    expect(html).toContain("12,480");
    expect(html).toContain("<main");
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  test("serves the page from static files without a framework server", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/report`);

    await expect(
      page.getByRole("heading", { name: "Build-Time Commerce Report" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("metric-orders")).toHaveText("12,480");
    await expect(page.locator("script[src]")).toHaveCount(0);
  });
});

function createStaticPageRewrites(
  deploymentMetadata: DeploymentMetadata,
): Record<string, string> {
  const documents = new Map(
    deploymentMetadata.documents.map((document) => [
      document.id,
      document.fileName,
    ]),
  );
  return Object.fromEntries(
    deploymentMetadata.routes.flatMap((route) => {
      if (route.kind !== "static-page" || !route.path.startsWith("/")) {
        return [];
      }
      const fileName = documents.get(route.documentId);
      return fileName ? [[route.path, fileName]] : [];
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
