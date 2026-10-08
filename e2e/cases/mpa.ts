import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { Shell, ShellOptions } from "@evjs/client/internal";
import { test as base, expect, type Page } from "@playwright/test";
import {
  buildExample,
  getExampleDeploymentMetadataPath,
  readExampleDeploymentMetadata,
} from "../fixtures";

const exampleDir = path.resolve(
  import.meta.dirname,
  "../..",
  "examples",
  "mpa",
);

function getMpaPublicDir(): string {
  const metadata = readExampleDeploymentMetadata(exampleDir);
  return path.resolve(exampleDir, metadata.paths.publicDir);
}

const test = base.extend<{ baseURL: string }, { _app: { port: number } }>({
  _app: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture API requires object destructuring
    async ({}, use, workerInfo) => {
      const bundlerName =
        (workerInfo.project.use as unknown as { bundlerName?: string })
          .bundlerName ?? "utoopack";
      await buildExample(exampleDir, bundlerName, {
        plugins: [
          {
            id: "e2e-mpa-shell-probe",
            emitIR(ctx) {
              const probe = ctx.emit.module({
                id: "shell-probe",
                scope: { kind: "application" },
                source: `
import { createShell } from "@evjs/client/internal";
(globalThis as { __mpaCreateShell?: typeof createShell }).__mpaCreateShell = createShell;
`,
              });
              ctx.slot("client.entry").add({
                id: "shell-probe-import",
                module: probe,
                position: "before-main-imports",
              });
            },
          },
        ],
      });

      const publicDir = getMpaPublicDir();

      const server = http.createServer((req, res) => {
        const requestPath = new URL(req.url ?? "/", "http://localhost")
          .pathname;
        const pathname =
          requestPath === "/"
            ? "/index.html"
            : path.extname(requestPath)
              ? requestPath
              : `${requestPath.replace(/\/$/, "")}/index.html`;
        const filePath = path.join(publicDir, pathname);

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
    { scope: "worker", auto: true },
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
    await expectRegisteredPageModule(page, "index");
  });

  test("navigates from home to about and back", async ({ page, baseURL }) => {
    await page.goto(baseURL);

    await page.getByRole("link", { name: "Go to About page" }).click();

    await expect(page).toHaveURL(`${baseURL}/about.html`);
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
    await expectRegisteredPageModule(page, "about");

    await page.getByRole("link", { name: "Back to Home page" }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(
      page.getByRole("heading", { name: "Home Page" }),
    ).toBeVisible();
    await expect(page).toHaveTitle("evjs MPA Home");
    await expectRegisteredPageModule(page, "index");
  });

  test("loads and switches page modules within one document", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL);
    await expect(page.locator("#app h1")).toHaveText("Home Page");
    await page.evaluate(async () => {
      const probe = globalThis as typeof globalThis & MpaShellProbe;
      const runtime = JSON.parse(
        document.getElementById("__EVJS_CLIENT_RUNTIME__")?.textContent ??
          "null",
      ) as ShellOptions["runtime"];
      const mount = document.createElement("div");
      mount.id = "mpa-shell";
      document.body.appendChild(mount);
      probe.__mpaShell = probe.__mpaCreateShell({
        runtime,
        resolveMountPoint: () => mount,
      });
      await probe.__mpaShell.start({ pageId: "index", hydrate: false });
    });
    await expect(page.locator("#mpa-shell h1")).toHaveText("Home Page");

    await runShellPageAction(page, "preload", "about");
    await expectRegisteredPageModule(page, "about");
    await expect(page.locator("#app h1")).toHaveText("Home Page");
    await expect(page.locator("#mpa-shell h1")).toHaveText("Home Page");
    await expect(page.getByRole("heading", { name: "About Page" })).toHaveCount(
      0,
    );
    await expect(
      page.locator(
        'script[data-evjs-shell-load="true"][src*="page-client-about."]',
      ),
    ).toHaveCount(1);

    await runShellPageAction(page, "activate", "about");
    await expect(page.locator("#mpa-shell h1")).toHaveText("About Page");
    await expect(page.locator("#app h1")).toHaveText("Home Page");

    await runShellPageAction(page, "activate", "index");
    await expect(page.locator("#mpa-shell h1")).toHaveText("Home Page");
    await expect(page.locator("#app h1")).toHaveText("Home Page");
    await expect(page.getByRole("heading", { name: "About Page" })).toHaveCount(
      0,
    );
    await expect(
      page.locator(
        'script[data-evjs-shell-load="true"][src*="page-client-index."]',
      ),
    ).toHaveCount(0);
    await expect(page).toHaveURL(`${baseURL}/`);

    await page.evaluate(async () => {
      await (
        globalThis as typeof globalThis & MpaShellProbe
      ).__mpaShell.dispose();
    });
    await expect(page.locator("#mpa-shell")).toBeEmpty();
  });

  test("preserves complete page asset order in HTML", async () => {
    const publicDir = getMpaPublicDir();
    const metadata = readExampleDeploymentMetadata(exampleDir);
    const documents = metadata.documents.filter(
      (document) => document.kind === "page",
    );
    expect(documents).toHaveLength(2);

    for (const document of documents) {
      const html = fs.readFileSync(
        path.join(publicDir, document.fileName),
        "utf-8",
      );
      const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(
        (match) => assetPath(match[1]),
      );
      const stylesheets = [
        ...html.matchAll(
          /<link\b(?=[^>]*\brel="stylesheet")[^>]*\bhref="([^"]+)"/g,
        ),
      ].map((match) => assetPath(match[1]));
      expect(scripts).toEqual(document.assets?.js);
      expect(stylesheets).toEqual(document.assets?.css);
      for (const asset of [...scripts, ...stylesheets]) {
        expect(fs.existsSync(path.join(publicDir, asset))).toBe(true);
      }
    }
  });

  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture API requires object destructuring
  test("shares one browser runtime across production page entries by default", async ({}, testInfo) => {
    const bundlerName =
      (testInfo.project.use as unknown as { bundlerName?: string })
        .bundlerName ?? "utoopack";
    test.skip(bundlerName !== "utoopack", "Utoopack shared runtime contract");

    const publicDir = getMpaPublicDir();
    const metadata = readExampleDeploymentMetadata(exampleDir);
    const documents = metadata.documents.filter(
      (document) => document.kind === "page",
    );
    expect(documents).toHaveLength(2);
    const runtimes: string[] = [];
    const bootstraps: string[] = [];

    for (const document of documents) {
      const assets = document.assets?.js ?? [];
      const runtimeAssets = assets.filter((asset) => {
        const source = fs.readFileSync(path.join(publicDir, asset), "utf-8");
        return (
          source.includes("registerChunk") && source.includes("loadChunkCached")
        );
      });
      expect(runtimeAssets).toHaveLength(1);
      const runtime = runtimeAssets[0];
      const entryAssets = assets.filter((asset) => asset !== runtime);
      expect(entryAssets.length).toBeGreaterThan(0);
      for (const asset of entryAssets) {
        expect(assets.indexOf(asset)).toBeLessThan(assets.indexOf(runtime));
      }
      runtimes.push(runtime);
      const bootstrap = entryAssets.find((asset) =>
        path.basename(asset).startsWith(`page-client-${document.id}.`),
      );
      expect(bootstrap).toBeDefined();
      if (bootstrap) bootstraps.push(bootstrap);
    }

    expect(runtimes[0]).toBe(runtimes[1]);
    expect(bootstraps).toHaveLength(2);
    expect(bootstraps[0]).not.toBe(bootstraps[1]);
  });

  test("materializes Page metadata in emitted HTML", async () => {
    const publicDir = getMpaPublicDir();
    const homeHtml = fs.readFileSync(
      path.join(publicDir, "index.html"),
      "utf-8",
    );
    expect(homeHtml).toContain("<title>evjs MPA Home</title>");
    expect(homeHtml).toContain(
      '<meta name="description" content="The home Page in the canonical evjs MPA example.">',
    );

    const aboutHtml = fs.readFileSync(
      path.join(publicDir, "about.html"),
      "utf-8",
    );
    expect(aboutHtml).toContain("<title>evjs MPA About</title>");
    expect(aboutHtml).toContain(
      '<meta name="description" content="The about Page in the canonical evjs MPA example.">',
    );
  });

  test("emits MPA pages in deployment metadata", async () => {
    const metadataPath = getExampleDeploymentMetadataPath(exampleDir);
    const metadata = readExampleDeploymentMetadata(exampleDir);

    expect(metadata).not.toHaveProperty("pages");
    expect(metadata).not.toHaveProperty("runtime");
    expect(metadata.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "page",
          id: "about",
          fileName: "about.html",
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

function assetPath(href: string): string {
  return new URL(href, "http://mpa.test/").pathname.replace(/^\//, "");
}

interface MpaShellProbe {
  __mpaCreateShell: (options: ShellOptions) => Shell;
  __mpaShell: Shell;
}

async function runShellPageAction(
  page: Page,
  action: "activate" | "preload",
  pageId: string,
) {
  await page.evaluate(
    async ({ action, pageId }) => {
      const probe = globalThis as typeof globalThis & MpaShellProbe;
      await probe.__mpaShell[action]({ pageId, hydrate: false });
    },
    { action, pageId },
  );
}

async function expectRegisteredPageModule(page: Page, pageId: string) {
  const registration = await page.evaluate((id) => {
    const runtimeScript = document.getElementById("__EVJS_CLIENT_RUNTIME__");
    if (!runtimeScript?.textContent) {
      throw new Error("MPA page must embed its client runtime");
    }
    const runtime = JSON.parse(runtimeScript.textContent) as {
      routing: { pages: Record<string, { module: { href: string } }> };
    };
    const registry = Reflect.get(globalThis, "__EVJS_SHELL_MODULES__") as
      | Record<string, unknown>
      | undefined;
    return {
      expected: new URL(runtime.routing.pages[id].module.href, location.href)
        .href,
      registered: Object.keys(registry ?? {}).map(
        (href) => new URL(href, location.href).href,
      ),
    };
  }, pageId);
  expect(registration.registered).toContain(registration.expected);
}
