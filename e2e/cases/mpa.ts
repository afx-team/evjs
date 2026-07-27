import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { DeploymentMetadata } from "@evjs/shared/manifest";
import { test as base, expect } from "@playwright/test";

const exampleDir = path.resolve(
  import.meta.dirname,
  "../..",
  "examples",
  "mpa",
);

const test = base.extend<{ baseURL: string }, { _app: { port: number } }>({
  _app: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture API requires object destructuring
    async ({}, use) => {
      execSync("ev build", {
        cwd: exampleDir,
        stdio: "pipe",
      });

      const distDir = path.join(exampleDir, "dist");

      const server = http.createServer((req, res) => {
        const requestPath = new URL(req.url ?? "/", "http://localhost")
          .pathname;
        const pathname =
          requestPath === "/"
            ? "/index.html"
            : path.extname(requestPath)
              ? requestPath
              : `${requestPath.replace(/\/$/, "")}/index.html`;
        const filePath = path.join(distDir, pathname);

        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath);
          const ct =
            ext === ".html"
              ? "text/html"
              : ext === ".js"
                ? "application/javascript"
                : ext === ".css"
                  ? "text/css"
                  : ext === ".map"
                    ? "application/json"
                    : "text/plain";

          res.writeHead(200, { "Content-Type": ct });
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

      await use({ port });

      server.close();
    },
    { scope: "worker" },
  ],
  baseURL: async ({ _app }, use) => {
    await use(`http://localhost:${_app.port}`);
  },
});

test.describe("mpa", () => {
  test("renders home page", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await expect(page.getByRole("heading", { name: "Home Page" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("This page is rendered from")).toBeVisible();
    await expect(page).toHaveTitle("evjs MPA Home");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "The home Page in the canonical evjs MPA example.",
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      "#ffffff",
    );
  });

  test("navigates from home to about", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await page.getByRole("link", { name: "Go to About page" }).click();

    await expect(page).toHaveURL(`${baseURL}/about`);
    await expect(page.getByRole("heading", { name: "About Page" })).toBeVisible(
      {
        timeout: 10_000,
      },
    );
    await expect(page).toHaveTitle("evjs MPA About");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "The about Page in the canonical evjs MPA example.",
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      "#f8fafc",
    );
  });

  test("materializes Page metadata in emitted HTML", async () => {
    const homeHtml = fs.readFileSync(
      path.join(exampleDir, "dist", "index.html"),
      "utf-8",
    );
    expect(homeHtml).toContain("<title>evjs MPA Home</title>");
    expect(homeHtml).toContain(
      '<meta name="description" content="The home Page in the canonical evjs MPA example.">',
    );

    const aboutHtml = fs.readFileSync(
      path.join(exampleDir, "dist", "about", "index.html"),
      "utf-8",
    );
    expect(aboutHtml).toContain("<title>evjs MPA About</title>");
    expect(aboutHtml).toContain(
      '<meta name="description" content="The about Page in the canonical evjs MPA example.">',
    );
  });

  test("emits MPA pages in deployment metadata", async () => {
    const metadataPath = path.join(
      exampleDir,
      "dist",
      "deployment-metadata.json",
    );
    const metadata = JSON.parse(
      fs.readFileSync(metadataPath, "utf-8"),
    ) as DeploymentMetadata;

    expect(metadata).not.toHaveProperty("pages");
    expect(metadata).not.toHaveProperty("runtime");
    expect(metadata.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "page",
          id: "about",
          fileName: "about/index.html",
          assets: expect.objectContaining({
            js: expect.arrayContaining([expect.stringMatching(/about.*\.js$/)]),
            css: expect.any(Array),
          }),
        }),
        expect.objectContaining({
          kind: "page",
          id: "index",
          fileName: "index.html",
          assets: expect.objectContaining({
            js: expect.arrayContaining([expect.stringMatching(/index.*\.js$/)]),
            css: expect.any(Array),
          }),
        }),
      ]),
    );
    expect(metadata.routes).toEqual(
      expect.arrayContaining([
        {
          kind: "static-page",
          path: "/about",
          pageId: "about",
          documentId: "about",
          render: "csr",
          methods: ["GET", "HEAD"],
        },
        {
          kind: "static-page",
          path: "/",
          pageId: "index",
          documentId: "index",
          render: "csr",
          methods: ["GET", "HEAD"],
        },
      ]),
    );
    const metadataText = fs.readFileSync(metadataPath, "utf-8");
    expect(metadataText).not.toContain(".tsx");
    expect(metadataText).not.toContain('"module"');
    expect(fs.existsSync(path.join(exampleDir, "dist", "manifest.json"))).toBe(
      false,
    );
  });
});
