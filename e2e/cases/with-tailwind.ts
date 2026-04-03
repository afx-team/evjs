import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test as base, expect } from "@playwright/test";

const exampleDir = path.resolve(
  import.meta.dirname,
  "../..",
  "examples",
  "with-tailwind",
);

const test = base.extend<{ baseURL: string }, { _app: { port: number } }>({
  _app: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture API requires object destructuring
    async ({}, use, workerInfo) => {
      const port = 31000 + workerInfo.workerIndex;

      // Expects the example to be pre-built (npm run build)

      // Serve the client bundle
      const distDir = path.join(exampleDir, "dist", "client");
      const indexHtml = fs.readFileSync(
        path.join(distDir, "index.html"),
        "utf-8",
      );

      const server = http.createServer((req, res) => {
        const url = req.url || "/";
        if (url === "/" || url === "/index.html") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(indexHtml);
          return;
        }
        const filePath = path.join(distDir, url);
        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath);
          const ct =
            ext === ".js"
              ? "application/javascript"
              : ext === ".css"
                ? "text/css"
                : "text/plain";
          res.writeHead(200, { "Content-Type": ct });
          fs.createReadStream(filePath).pipe(res);
        } else {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(indexHtml);
        }
      });

      await new Promise<void>((resolve) => {
        server.listen(port, resolve);
      });
      await use({ port });
      server.close();
    },
    { scope: "worker" },
  ],
  baseURL: async ({ _app }, use) => {
    await use(`http://localhost:${_app.port}`);
  },
});

test.describe("with-tailwind", () => {
  test("Tailwind CSS loaded via plugin is applied", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL);

    // Title should be visible
    const title = page.getByTestId("title");
    await expect(title).toBeVisible({ timeout: 10_000 });
    await expect(title).toHaveText("Tailwind Plugin Example");

    // Verify Tailwind text-4xl (font-size: 2.25rem = 36px) is applied
    const fontSize = await title.evaluate(
      (el) => getComputedStyle(el).fontSize,
    );
    expect(fontSize).toBe("48px");
  });

  test("manifest contains routes and assets", async () => {
    const manifestPath = path.join(
      exampleDir,
      "dist",
      "client",
      "manifest.json",
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    expect(manifest.assets.js.length).toBeGreaterThan(0);
    expect(manifest.routes).toEqual([{ path: "/" }]);
  });
});
