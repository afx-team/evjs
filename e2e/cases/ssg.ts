import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { DeploymentMetadata } from "@evjs/shared/manifest";
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
          path.join(exampleDir, "dist", "deployment-metadata.json"),
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
    fileName: "forecast/index.html",
    heading: "Build-Time Revenue Forecast",
    id: "forecast",
    path: "/forecast",
    title: "SSG Report",
  },
  {
    description: "A nested APAC operations snapshot generated as static HTML.",
    fileName: "regions/apac/index.html",
    heading: "APAC Operations Snapshot",
    id: "regions_apac",
    path: "/regions/apac",
    title: "APAC Operations Snapshot",
  },
  {
    description: "A commerce report rendered as static HTML during ev build.",
    fileName: "report/index.html",
    heading: "Build-Time Commerce Report",
    id: "report",
    path: "/report",
    title: "Build-Time Commerce Report",
  },
] as const;

test.describe("ssg", () => {
  test("emits prerendered static page documents", async ({
    deploymentMetadata,
  }) => {
    expect(deploymentMetadata.documents).toEqual(
      expectedPages.map((page) => ({
        fileName: page.fileName,
        id: page.id,
        kind: "page",
      })),
    );
    expect(deploymentMetadata.server).toEqual({});
    expect(deploymentMetadata.routes).toEqual(
      expectedPages.map((page) => ({
        kind: "static-page",
        path: page.path,
        pageId: page.id,
        documentId: page.id,
        render: "ssg",
        methods: ["GET", "HEAD"],
      })),
    );
    expect(deploymentMetadata.routes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "server-page",
        }),
      ]),
    );

    expect(listRelativeFiles(path.join(exampleDir, "dist", "client"))).toEqual(
      expectedPages.map((page) => page.fileName).sort(),
    );
    expect(
      fs.existsSync(path.join(exampleDir, "dist", "build-output.json")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(exampleDir, "dist", "client", "manifest.json")),
    ).toBe(false);
    expect(fs.existsSync(path.join(exampleDir, "dist", "server"))).toBe(false);

    for (const page of expectedPages) {
      const html = fs.readFileSync(
        path.join(exampleDir, "dist", "client", page.fileName),
        "utf-8",
      );
      expect(html).toContain(page.heading);
      expect(html).toContain("<main");
      expect(html).toContain(`>${page.title}</title>`);
      if ("description" in page) {
        expect(html).toContain(`content="${page.description}"`);
        // Static documents do not need SPA metadata restoration markers.
        expect(html).not.toContain("data-evjs-page-metadata");
      } else {
        expect(html).not.toContain('meta name="description"');
      }
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
      await expect(page).toHaveTitle(staticPage.title);
      if ("description" in staticPage) {
        await expect(page.locator('meta[name="description"]')).toHaveAttribute(
          "content",
          staticPage.description,
        );
      } else {
        await expect(page.locator('meta[name="description"]')).toHaveCount(0);
      }
      await expect(page.locator("script[src]")).toHaveCount(0);
    }

    await page.goto(`${baseURL}/report`);
    await expect(page.getByTestId("metric-orders")).toHaveText("12,480");
  });
});

function createStaticPageRewrites(
  deploymentMetadata: DeploymentMetadata,
): Record<string, string> {
  const documentsById = new Map(
    deploymentMetadata.documents.map((document) => [document.id, document]),
  );
  return Object.fromEntries(
    deploymentMetadata.routes.flatMap((route) => {
      if (route.kind !== "static-page" || !route.path.startsWith("/")) {
        return [];
      }
      const document = documentsById.get(route.documentId);
      return document?.kind === "page"
        ? [[route.path, document.fileName] as const]
        : [];
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

function listRelativeFiles(root: string): string[] {
  const files: string[] = [];

  function visit(directory: string, relativeDirectory = ""): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (entry.isDirectory()) {
        visit(path.join(directory, entry.name), relativePath);
      } else {
        files.push(relativePath);
      }
    }
  }

  visit(root);
  return files.sort();
}
