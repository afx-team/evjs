import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
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
        const url = req.url || "/home.html";
        const pathname = url === "/" ? "/home.html" : url;
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
    await page.goto(`${baseURL}/home.html`);

    await expect(page.getByRole("heading", { name: "Home Page" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("This page is rendered from")).toBeVisible();
  });

  test("navigates from home to about", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/home.html`);

    await page.getByRole("link", { name: "Go to About page" }).click();

    await expect(page).toHaveURL(/\/about\.html$/);
    await expect(page.getByRole("heading", { name: "About Page" })).toBeVisible(
      {
        timeout: 10_000,
      },
    );
  });

  test("emits MPA pages in manifest", async () => {
    const manifestPath = path.join(exampleDir, "dist", "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      pages?: Record<string, unknown>;
    };

    expect(manifest.pages).toEqual({
      about: expect.objectContaining({
        assets: expect.objectContaining({
          js: expect.arrayContaining([expect.stringMatching(/about.*\.js$/)]),
          css: expect.any(Array),
        }),
        render: "csr",
        hydrate: "load",
        rendering: expect.objectContaining({
          component: "client",
          html: "client",
          hydrate: "load",
        }),
        module: expect.objectContaining({
          type: "react-component",
          href: expect.stringMatching(/\.js$/),
        }),
      }),
      home: expect.objectContaining({
        assets: expect.objectContaining({
          js: expect.arrayContaining([expect.stringMatching(/home.*\.js$/)]),
          css: expect.any(Array),
        }),
        render: "csr",
        hydrate: "load",
        rendering: expect.objectContaining({
          component: "client",
          html: "client",
          hydrate: "load",
        }),
        module: expect.objectContaining({
          type: "react-component",
          href: expect.stringMatching(/\.js$/),
        }),
      }),
    });
    const publicManifestText = fs.readFileSync(manifestPath, "utf-8");
    expect(publicManifestText).not.toContain(".tsx");
  });
});
