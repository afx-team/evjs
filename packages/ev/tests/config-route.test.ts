import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CONFIG_ROUTE_PROVIDER_ID,
  linkBuildOutput,
  type PagesAppEntryMetadata,
} from "@evjs/shared/manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareFrameworkBuild } from "../src/_internal/build/commands.js";
import { GENERATED_PAGES_APP_BUILD_ENTRY } from "../src/_internal/build/conventions/build-entry-conventions.js";
import { createConfigRouteGraph } from "../src/_internal/build/graph/config-route.js";
import { createCoreGraph } from "../src/_internal/build/graph/index.js";
import { createClientRuntime } from "../src/_internal/build/output/framework-runtime.js";
import { createFrameworkHtmlDocument } from "../src/_internal/build/output/html/framework-html-document.js";
import { createBuildPlan } from "../src/_internal/build/plan/index.js";
import { resolveConfig } from "../src/config/index.js";

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((fixture) => fs.rm(fixture, { force: true, recursive: true })),
  );
});

describe("explicit SPA route graph", () => {
  it("targets a page.* anchor at the default application.pageRoot", async () => {
    const cwd = await createFixture({
      "index.html": '<main id="app"></main>',
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "src/pages/page.config.ts": `
        export default { title: "Home" };
      `,
    });
    const config = resolveConfig({
      application: {
        routes: [{ path: "/", page: "." }],
      },
    });
    const { graph } = await createCoreGraph(config, cwd);

    expect(graph.pages.index).toMatchObject({
      id: "index",
      render: "csr",
      source: {
        module: "./src/pages/page.tsx",
        scope: { kind: "directory", root: "./src/pages" },
      },
      metadata: { title: "Home" },
    });
    expect(graph.pages.index).not.toHaveProperty("hydrate");
    expect(graph.routes).toContainEqual(
      expect.objectContaining({
        target: { kind: "page", pageId: "index" },
      }),
    );
  });

  it("resolves component Pages through a custom application.pageRoot", async () => {
    const cwd = await createFixture({
      "index.html": '<main id="app"></main>',
      "app/pages/dashboard/page.tsx":
        "export default function Dashboard() { return null; }",
    });
    const config = resolveConfig({
      application: {
        pageRoot: "./app/pages",
        routes: [
          {
            path: "/dashboard",
            component: "@/pages/dashboard/page",
          },
        ],
      },
    });

    const graph = await createConfigRouteGraph(config, cwd);

    expect(graph.pages.dashboard?.source).toEqual({
      module: "./app/pages/dashboard/page.tsx",
      scope: { kind: "directory", root: "./app/pages/dashboard" },
      provider: CONFIG_ROUTE_PROVIDER_ID,
    });
    expect(graph.pages.dashboard?.render).toBe("csr");
    expect(graph.pages.dashboard).not.toHaveProperty("hydrate");
  });

  it("rejects a component symlink that escapes application.pageRoot", async () => {
    const cwd = await createFixture({
      "index.html": '<main id="app"></main>',
      "app/pages/inside/page.tsx":
        "export default function Inside() { return null; }",
      "app/outside.tsx": "export default function Outside() { return null; }",
    });
    await fs.symlink(
      path.join(cwd, "app/outside.tsx"),
      path.join(cwd, "app/pages/escape.tsx"),
    );
    const config = resolveConfig({
      application: {
        pageRoot: "./app/pages",
        routes: [{ path: "/escape", component: "@/pages/escape" }],
      },
    });

    await expect(createConfigRouteGraph(config, cwd)).rejects.toThrow(
      'component module "./app/pages/escape.tsx" must resolve inside application.pageRoot "./app/pages" after resolving symlinks',
    );
  });

  it("normalizes one source profile into Pages, Routes, and one Document", async () => {
    const cwd = await createFixture({
      "app.html": '<main id="root"></main>',
      "src/layouts/AppLayout.tsx":
        "export default function AppLayout({ children }) { return children; }",
      "src/pages/users/detail/page.tsx":
        "export default function UserDetail() { return null; }",
      "src/pages/home/page.tsx":
        "export default function Home() { return null; }",
      "src/wrappers/Auth.tsx":
        "export default function Auth({ children }) { return children; }",
    });
    const config = resolveConfig({
      application: {
        document: { template: "./app.html", mount: "#root" },
        layout: "@/layouts/AppLayout",
        routes: [
          { path: "/", page: "home" },
          {
            path: "/users",
            wrappers: ["@/wrappers/Auth"],
            routes: [
              { path: ":userId", page: "users/detail", layout: false },
              { path: ":userId/legacy", redirect: "/users/:userId" },
            ],
          },
        ],
      },
    });
    expect(config.routing).toBeUndefined();

    const graph = await createConfigRouteGraph(config, cwd);
    expect(graph.applications.default).toMatchObject({
      id: "default",
      routingMode: "spa",
      pageIds: expect.arrayContaining(["home", "users_detail"]),
      documentIds: ["index"],
    });
    expect(graph.applications.default).not.toHaveProperty("entry");
    expect(graph.documents.index).toMatchObject({
      template: "./app.html",
      output: "index.html",
      mount: "#root",
      owner: { kind: "application" },
      bootstrap: { kind: "application" },
    });
    expect(graph.plugins).toEqual({ entries: {} });
    expect(graph.applications.default?.plugins).toEqual({});
    expect(graph.pages.home?.plugins).toEqual({});
    expect(graph.routes.every((route) => !("plugins" in route))).toBe(true);
    expect(graph.documents.index).not.toHaveProperty("plugins");

    expect(graph.applications.default).toMatchObject({
      layout: "./src/layouts/AppLayout.tsx",
    });
    expect(
      graph.routes.some(
        (route) =>
          route.target.kind === "page" &&
          route.target.pageId === "users_detail" &&
          route.pattern.segments.some(
            (segment) => segment.kind === "param" && segment.name === "userId",
          ) &&
          route.facets.layout === false,
      ),
    ).toBe(true);
    expect(graph.routes.some((route) => route.target.kind === "redirect")).toBe(
      true,
    );
  });

  it("analyzes the Application layout import closure", async () => {
    const cwd = await createFixture({
      "index.html": '<main id="app"></main>',
      "src/layouts/AppLayout.tsx": `
        import { saveLayoutState } from "./actions.server";
        void saveLayoutState;
        export default function AppLayout({ children }) { return children; }
      `,
      "src/layouts/actions.server.ts": `
        "use server";
        export async function saveLayoutState() {}
      `,
      "src/pages/home/page.tsx":
        "export default function Home() { return null; }",
    });
    const config = resolveConfig({
      application: {
        layout: "@/layouts/AppLayout",
        routes: [{ path: "/", page: "home" }],
      },
    });

    const analysis = await createCoreGraph(config, cwd);

    expect(analysis.graph.serverFunctions).toContainEqual(
      expect.objectContaining({
        module: "src/layouts/actions.server.ts",
        exportName: "saveLayoutState",
      }),
    );
    expect(analysis.fileDependencies).toEqual(
      expect.arrayContaining([
        path.join(cwd, "src/layouts/AppLayout.tsx"),
        path.join(cwd, "src/layouts/actions.server.ts"),
      ]),
    );
  });

  it("loads only adjacent page.config.ts and ignores unrelated JSON", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/orders/page.tsx":
        "export default function Orders() { return null; }",
      "src/pages/orders/page.config.ts": `
        export default {
          title: "Orders",
          meta: {
            description: "Review payment orders",
            viewport: "width=device-width, initial-scale=1",
          },
        };
      `,
      "src/pages/orders/notes.json": JSON.stringify({
        title: "Unrelated title",
        render: "ssg",
      }),
    });
    const config = resolveConfig({
      application: {
        routes: [{ path: "/orders", page: "orders" }],
      },
    });

    const analysis = await createCoreGraph(config, cwd);
    expect(analysis.graph.pages.orders?.metadata).toEqual({
      title: "Orders",
      meta: {
        description: "Review payment orders",
        viewport: "width=device-width, initial-scale=1",
      },
    });
    expect(analysis.graph.pages.orders?.render).toBe("csr");
    expect(analysis.fileDependencies).toContain(
      path.join(cwd, "src/pages/orders/page.config.ts"),
    );
    expect(analysis.fileDependencies).not.toContain(
      path.join(cwd, "src/pages/orders/notes.json"),
    );
  });

  it("requires a positive page.* anchor for page references", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/good/page.tsx":
        "export default function Good() { return null; }",
      "src/pages/index-only/index.tsx":
        "export default function IndexOnly() { return null; }",
      "src/pages/duplicate/page.tsx":
        "export default function Duplicate() { return null; }",
      "src/pages/duplicate/page.jsx":
        "export default function DuplicateJsx() { return null; }",
    });

    await expect(
      createConfigRouteGraph(
        resolveConfig({
          application: { routes: [{ page: "good" }] },
        }),
        cwd,
      ),
    ).resolves.toMatchObject({
      pages: {
        good: {
          source: {
            module: "./src/pages/good/page.tsx",
            scope: { kind: "directory", root: "./src/pages/good" },
          },
        },
      },
    });
    await expect(
      createConfigRouteGraph(
        resolveConfig({
          application: { routes: [{ page: "index-only" }] },
        }),
        cwd,
      ),
    ).rejects.toThrow(
      "rename the Page entry to page.*, or reference the existing module explicitly",
    );
    await expect(
      createConfigRouteGraph(
        resolveConfig({
          application: { routes: [{ page: "duplicate" }] },
        }),
        cwd,
      ),
    ).rejects.toThrow(
      'has multiple Page entries under application.pageRoot "./src/pages"',
    );
  });

  it("allows an index.* component only through an explicit route reference", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/explicit-index/index.tsx":
        "export default function ExplicitIndex() { return null; }",
    });
    const config = resolveConfig({
      application: {
        routes: [
          { path: "/explicit-index", component: "explicit-index/index" },
        ],
      },
    });

    const graph = await createConfigRouteGraph(config, cwd);
    expect(graph.pages["explicit-index"]?.source).toMatchObject({
      module: "./src/pages/explicit-index/index.tsx",
      scope: { kind: "directory", root: "./src/pages/explicit-index" },
      provider: CONFIG_ROUTE_PROVIDER_ID,
    });
  });

  it("keeps a direct component module as a module-scoped Page", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/403.tsx":
        "export default function Forbidden() { return null; }",
    });
    const config = resolveConfig({
      application: {
        routes: [{ path: "/403", component: "./403" }],
      },
    });

    const graph = await createConfigRouteGraph(config, cwd);
    expect(graph.pages["403"]?.source).toEqual({
      module: "./src/pages/403.tsx",
      scope: { kind: "module", file: "./src/pages/403.tsx" },
      provider: CONFIG_ROUTE_PROVIDER_ID,
    });
    expect(graph.routes).toContainEqual(
      expect.objectContaining({
        pattern: {
          segments: [{ kind: "static", value: "403" }],
        },
        target: { kind: "page", pageId: "403" },
      }),
    );
  });

  it("does not bypass an inaccessible higher-priority explicit component", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/report.js":
        "export default function Report() { return null; }",
    });
    const config = resolveConfig({
      application: {
        routes: [{ path: "/report", component: "./report" }],
      },
    });
    const base = path.join(cwd, "src/pages/report");
    const inaccessibleCandidate = `${base}.ts`;
    const observed = new Set<string>();
    const originalStat = fs.stat.bind(fs);
    const statSpy = vi.spyOn(fs, "stat").mockImplementation((async (
      ...args: Parameters<typeof fs.stat>
    ) => {
      if (path.resolve(String(args[0])) === inaccessibleCandidate) {
        throw Object.assign(new Error("permission denied"), {
          code: "EACCES",
        });
      }
      return originalStat(...args);
    }) as typeof fs.stat);

    try {
      await expect(
        createConfigRouteGraph(config, cwd, undefined, (file) => {
          observed.add(path.resolve(file));
        }),
      ).rejects.toMatchObject({ code: "EACCES" });
      expect([...observed]).toEqual(
        expect.arrayContaining([
          base,
          `${base}.ts`,
          `${base}.tsx`,
          `${base}.js`,
          `${base}.jsx`,
          path.join(base, "index.ts"),
          path.join(base, "index.tsx"),
          path.join(base, "index.js"),
          path.join(base, "index.jsx"),
        ]),
      );
    } finally {
      statSpy.mockRestore();
    }
  });

  it("uses explicit route path syntax and diagnoses the target file convention", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/users/page.tsx":
        "export default function Users() { return null; }",
    });

    await expect(
      createConfigRouteGraph(
        resolveConfig({
          application: {
            routes: [{ path: "/users/$userId", page: "users" }],
          },
        }),
        cwd,
      ),
    ).rejects.toThrow(
      'application.routes syntax. Explicit route paths use ":param" and terminal "*"; the Page file convention uses "$param" and terminal "$...splat"',
    );
    await expect(
      createConfigRouteGraph(
        resolveConfig({
          application: {
            routes: [{ path: "/docs/*/child", page: "users" }],
          },
        }),
        cwd,
      ),
    ).rejects.toThrow('application.routes wildcard "*" must be terminal');
  });

  it("rejects redirect param and sibling route-shape ambiguity", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/users/page.tsx":
        "export default function Users() { return null; }",
    });

    await expect(
      createConfigRouteGraph(
        resolveConfig({
          application: {
            routes: [
              {
                path: "/users/:userId",
                redirect: "/profiles/:profileId",
              },
            ],
          },
        }),
        cwd,
      ),
    ).rejects.toThrow('requires param parameter "profileId"');
    await expect(
      createConfigRouteGraph(
        resolveConfig({
          application: {
            routes: [
              { path: "/users/:id", page: "users" },
              { path: "/users/:userId", redirect: "/users/:userId" },
            ],
          },
        }),
        cwd,
      ),
    ).rejects.toThrow("conflicts with sibling");
  });

  it.each([
    ["raw ASCII", "/users", "/%75sers"],
    ["raw Unicode", "/你好", "/%E4%BD%A0%E5%A5%BD"],
  ])("rejects explicit application.routes that differ only by a %s encoding alias", async (_label, raw, encoded) => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/first/page.tsx":
        "export default function First() { return null; }",
      "src/pages/second/page.tsx":
        "export default function Second() { return null; }",
    });

    await expect(
      createConfigRouteGraph(
        resolveConfig({
          application: {
            routes: [
              { path: raw, page: "first" },
              { path: encoded, page: "second" },
            ],
          },
        }),
        cwd,
      ),
    ).rejects.toThrow("conflicts with sibling");
  });

  it("uses canonical semantics for nested prefixes without collapsing segment boundaries", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/details/page.tsx":
        "export default function Details() { return null; }",
      "src/pages/encoded-slash/page.tsx":
        "export default function EncodedSlash() { return null; }",
      "src/pages/path-boundary/page.tsx":
        "export default function PathBoundary() { return null; }",
      "src/pages/single-encoding/page.tsx":
        "export default function SingleEncoding() { return null; }",
      "src/pages/double-encoding/page.tsx":
        "export default function DoubleEncoding() { return null; }",
    });

    const graph = await createConfigRouteGraph(
      resolveConfig({
        application: {
          routes: [
            {
              path: "/users",
              routes: [
                {
                  path: "/%75sers",
                  routes: [{ path: "details", page: "details" }],
                },
              ],
            },
            { path: "/files/a%2Fb", page: "encoded-slash" },
            { path: "/files/a/b", page: "path-boundary" },
            { path: "/tokens/%2F", page: "single-encoding" },
            { path: "/tokens/%252F", page: "double-encoding" },
          ],
        },
      }),
      cwd,
    );

    expect(Object.keys(graph.pages)).toEqual(
      expect.arrayContaining([
        "details",
        "encoded-slash",
        "path-boundary",
        "single-encoding",
        "double-encoding",
      ]),
    );
  });

  it.each([
    "/%2E",
    "/.%2e",
    "/%2E%2E",
  ])('rejects explicit application.routes one-decode dot segment "%s"', async (routePath) => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/target/page.tsx":
        "export default function Target() { return null; }",
    });

    await expect(
      createConfigRouteGraph(
        resolveConfig({
          application: {
            routes: [{ path: routePath, page: "target" }],
          },
        }),
        cwd,
      ),
    ).rejects.toThrow("must not contain dot segments");
  });

  it("rejects malformed, default-less, and outside-project modules", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/no-default/page.tsx": "export const value = 1;",
      "src/pages/malformed/page.tsx": "export default function Broken(",
      "src/wrappers/NoDefault.tsx": "export const value = 1;",
    });

    await expect(
      createConfigRouteGraph(
        resolveConfig({
          application: { routes: [{ page: "no-default" }] },
        }),
        cwd,
      ),
    ).rejects.toThrow("must default-export a React component");
    await expect(
      createConfigRouteGraph(
        resolveConfig({
          application: { routes: [{ page: "malformed" }] },
        }),
        cwd,
      ),
    ).rejects.toThrow("could not be parsed");
    await expect(
      createConfigRouteGraph(
        resolveConfig({
          application: {
            routes: [
              {
                page: "no-default",
                wrappers: ["@/wrappers/NoDefault"],
              },
            ],
          },
        }),
        cwd,
      ),
    ).rejects.toThrow("must default-export a React component");
  });

  it("keeps rendering configuration in page.config.ts", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/orders/page.tsx": `
        export const render = "ssr";
        export const hydrate = "none";
        export default function Orders() { return null; }
      `,
    });
    const analysis = await createCoreGraph(
      resolveConfig({
        application: {
          routes: [{ path: "/orders", page: "orders" }],
        },
      }),
      cwd,
    );

    expect(analysis.diagnostics).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: expect.stringContaining("page.config.ts"),
      }),
    );
    expect(analysis.graph.pages.orders?.render).toBe("csr");
  });

  it("derives the generated pages-app entry in BuildPlan, not CoreGraph", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/home/page.tsx":
        "export default function Home() { return null; }",
    });
    const config = resolveConfig({
      application: {
        routes: [{ path: "/", page: "home" }],
      },
    });
    const graph = (await createCoreGraph(config, cwd)).graph;
    const plan = createBuildPlan(config, graph, {
      mode: "development",
      buildId: "config-route",
    });

    expect(graph.applications.default).not.toHaveProperty("entry");
    const entry = plan.entries.find(
      (candidate) => candidate.metadata?.type === "pages-app",
    );
    expect(entry).toMatchObject({
      name: "main",
      import: GENERATED_PAGES_APP_BUILD_ENTRY,
      owner: { appId: "default" },
    });
    const metadata = entry?.metadata as PagesAppEntryMetadata | undefined;
    expect(metadata?.routes).toEqual([
      expect.objectContaining({
        path: "/",
        module: "./src/pages/home/page.tsx",
      }),
    ]);
  });

  it("preserves SPA metadata baselines for application.routes Page documents", async () => {
    const cwd = await createFixture({
      "app.html": `<!doctype html>
        <html>
          <head>
            <title>Application baseline</title>
            <meta name="viewport" content="width=device-width">
          </head>
          <body><main id="app"></main></body>
        </html>`,
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        export default {
          render: "ssg",
          hydrate: "load",
          title: "Report",
          meta: { viewport: "width=device-width, initial-scale=1" },
        };
      `,
    });
    const config = resolveConfig({
      target: { android: 5, ios: 8 },
      polyfill: {
        coreJs: "https://cdn.example.com/core-js-bundle.min.js",
      },
      application: {
        document: { template: "./app.html" },
        routes: [{ path: "/report", page: "report" }],
      },
    });
    const graph = (await createCoreGraph(config, cwd)).graph;
    const plan = createBuildPlan(config, graph, {
      mode: "production",
      buildId: "config-route-extensions",
    });
    const clientEntry = plan.entries.find(
      (entry) => entry.environment === "client",
    );
    if (!clientEntry) {
      throw new Error("Expected an application client entry.");
    }
    const serverEntryAssets = Object.fromEntries(
      plan.entries
        .filter((entry) => entry.environment === "server")
        .map((entry) => [entry.name, { js: [`${entry.name}.js`], css: [] }]),
    );
    const output = linkBuildOutput({
      graph,
      plan,
      clientEntryAssets: {
        [clientEntry.name]: { js: ["main.js"], css: [] },
      },
      serverEntryAssets,
    });
    const htmlPlan = plan.html.find(
      (candidate) => candidate.owner.pageId === "report",
    );
    if (!htmlPlan) {
      throw new Error("Expected an SSG Page document.");
    }

    expect(config.routing).toBeUndefined();
    expect(plan.entries).toContainEqual(
      expect.objectContaining({
        kind: "app-client",
        owner: { appId: "default" },
      }),
    );

    const doc = createFrameworkHtmlDocument({
      cwd,
      config,
      output,
      plan,
      html: {
        documentId: htmlPlan.id,
        applicationId: "default",
        owner: { kind: "page", pageId: "report" },
        template: htmlPlan.template,
        fileName: htmlPlan.fileName,
        assets: output.pages.report.assets,
      },
      clientRuntime: createClientRuntime(output),
      purpose: "client-document",
    });

    expect(doc.querySelector("title")?.textContent).toBe("Report");
    expect(
      doc
        .querySelector("title")
        ?.getAttribute("data-evjs-page-metadata-baseline"),
    ).toBe("Application baseline");
    const viewport = doc.querySelector('meta[name="viewport"]');
    expect(viewport?.getAttribute("content")).toBe(
      "width=device-width, initial-scale=1",
    );
    expect(viewport?.getAttribute("data-evjs-page-metadata-baseline")).toBe(
      "width=device-width",
    );
    const scripts = [...doc.querySelectorAll("body script")];
    expect(scripts.map((script) => script.getAttribute("src"))).toEqual([
      "https://cdn.example.com/core-js-bundle.min.js",
      null,
      "/main.js",
    ]);
    expect(scripts[0]?.hasAttribute("async")).toBe(false);
    expect(scripts[0]?.hasAttribute("defer")).toBe(false);
    expect(scripts[2]?.hasAttribute("defer")).toBe(true);

    const documentWithoutClientJs = createFrameworkHtmlDocument({
      cwd,
      config,
      output,
      plan,
      html: {
        documentId: htmlPlan.id,
        applicationId: "default",
        owner: { kind: "page", pageId: "report" },
        template: htmlPlan.template,
        fileName: htmlPlan.fileName,
        assets: { ...output.pages.report.assets, js: [] },
      },
      clientRuntime: createClientRuntime(output),
      purpose: "client-document",
    });
    expect(
      documentWithoutClientJs.querySelector(
        'script[src="https://cdn.example.com/core-js-bundle.min.js"]',
      ),
    ).toBeNull();
    expect(
      documentWithoutClientJs.getElementById("__EVJS_CLIENT_RUNTIME__"),
    ).toBeNull();

    const developmentDocument = createFrameworkHtmlDocument({
      cwd,
      config,
      output,
      plan: { ...plan, mode: "development" },
      html: {
        documentId: htmlPlan.id,
        applicationId: "default",
        owner: { kind: "page", pageId: "report" },
        template: htmlPlan.template,
        fileName: htmlPlan.fileName,
        assets: output.pages.report.assets,
      },
      clientRuntime: createClientRuntime(output),
      purpose: "client-document",
    });
    expect(
      developmentDocument.querySelector(
        'script[src="https://cdn.example.com/core-js-bundle.min.js"]',
      ),
    ).toBeNull();
  });

  it("materializes the generated SPA facade without canonical route types", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/layouts/AppLayout.tsx":
        "export default function AppLayout({ children }) { return children; }",
      "src/pages/users/detail/page.tsx":
        "export default function Detail() { return null; }",
      "src/wrappers/Auth.tsx":
        "export default function Auth({ children }) { return children; }",
    });
    const prepared = await prepareFrameworkBuild(
      {
        application: {
          document: { mount: "#app" },
          layout: "@/layouts/AppLayout",
          routes: [
            {
              path: "/users",
              wrappers: ["@/wrappers/Auth"],
              routes: [
                {
                  path: ":userId",
                  page: "users/detail",
                  layout: false,
                },
              ],
            },
          ],
        },
      },
      { cwd },
    );

    try {
      const entrySource = await fs.readFile(
        path.join(cwd, ".ev/entries/main.ts"),
        "utf-8",
      );
      expect(entrySource).toContain(
        'import * as rootModule from "../../src/layouts/AppLayout";',
      );
      expect(entrySource).toContain(
        'import * as routeWrapperModule0_0 from "../../src/wrappers/Auth";',
      );
      expect(entrySource).toContain('path: "/users/$userId"');
      expect(entrySource).toContain("layout: false");
      expect(entrySource).toContain('startPagesApp(app, "#app")');

      await expect(
        fs.access(path.join(cwd, "src/route-types.d.ts")),
      ).rejects.toThrow();
    } finally {
      await prepared.dispose();
    }
  });
});

async function createFixture(files: Record<string, string>): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "ev-config-route-"));
  fixtures.push(cwd);
  await Promise.all(
    Object.entries(files).map(async ([file, source]) => {
      const absolute = path.join(cwd, file);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, source);
    }),
  );
  return cwd;
}
