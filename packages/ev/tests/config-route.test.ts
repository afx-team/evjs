import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BIGFISH_ROUTE_EXTENSION_ID,
  CONFIG_ROUTE_PROVIDER_ID,
  linkBuildOutput,
  type PagesAppEntryMetadata,
} from "@evjs/shared/manifest";
import { afterEach, describe, expect, it } from "vitest";
import { GENERATED_PAGES_APP_BUILD_ENTRY } from "../src/_internal/build/build-entry-conventions.js";
import { prepareFrameworkBuild } from "../src/_internal/build/commands.js";
import { createFrameworkHtmlDocument } from "../src/_internal/build/framework-html-document.js";
import { createClientRuntime } from "../src/_internal/build/framework-runtime.js";
import { createConfigRouteGraph } from "../src/_internal/build/graph/config-route.js";
import { createCoreGraph } from "../src/_internal/build/graph/index.js";
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

describe("Bigfish SPA migration route graph", () => {
  it("targets the canonical Page at application.pageRoot", async () => {
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
      source: {
        module: "./src/pages/page.tsx",
        scope: { kind: "directory", root: "./src/pages" },
      },
      metadata: { title: "Home" },
    });
    expect(graph.routes).toContainEqual(
      expect.objectContaining({
        target: { kind: "page", pageId: "index" },
      }),
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
    expect(graph.extensions).toEqual({ namespaces: {} });

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

  it("retains strict Bigfish metadata on the semantic Route extension", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/layouts/Section.tsx":
        "export default function Section({ children }) { return children; }",
      "src/pages/home/page.tsx":
        "export default function Home() { return null; }",
    });
    const config = resolveConfig({
      application: {
        routes: [
          {
            path: "/home",
            page: "home",
            layout: "@/layouts/Section",
            name: "首页",
            icon: "home",
            title: "Home",
            hideInMenu: false,
            flatMenu: true,
            spmBPos: { a226: "b1", a1853: "b2" },
            access: "canReadHome",
            menuKey: { spcenter: null, merchant_b: "" },
            menuAssetOptions: {
              source: "route",
              nested: { enabled: true },
            },
            exact: true,
          },
        ],
      },
    });

    const graph = await createConfigRouteGraph(config, cwd);
    expect(graph.extensions.namespaces).toEqual({
      [BIGFISH_ROUTE_EXTENSION_ID]: {
        producer: CONFIG_ROUTE_PROVIDER_ID,
        owners: ["route"],
      },
    });
    const pageRoute = graph.routes.find(
      (route) => route.target.kind === "page" && route.target.pageId === "home",
    );
    expect(pageRoute?.extensions).toEqual({
      [BIGFISH_ROUTE_EXTENSION_ID]: {
        name: "首页",
        icon: "home",
        title: "Home",
        hideInMenu: false,
        flatMenu: true,
        spmBPos: { a226: "b1", a1853: "b2" },
        access: "canReadHome",
        menuKey: { spcenter: null, merchant_b: "" },
        menuAssetOptions: {
          source: "route",
          nested: { enabled: true },
        },
      },
    });
    expect(
      pageRoute?.extensions[BIGFISH_ROUTE_EXTENSION_ID],
    ).not.toHaveProperty("exact");
    const layoutRoute = graph.routes.find(
      (route) =>
        route.target.kind === "group" &&
        route.facets.layout === "./src/layouts/Section.tsx",
    );
    expect(layoutRoute?.extensions).toEqual({});
  });

  it.each([
    "__proto__",
    "constructor",
    "prototype",
  ])('rejects unsafe Bigfish nested metadata key "%s"', (key) => {
    const menuAssetOptions = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(menuAssetOptions, key, {
      enumerable: true,
      value: true,
    });

    expect(() =>
      resolveConfig({
        application: {
          routes: [
            {
              path: "/home",
              page: "home",
              menuAssetOptions,
            },
          ],
        },
      } as never),
    ).toThrow("not a safe config field");
  });

  it("loads only adjacent page.config.ts and ignores Smallfish config.json", async () => {
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
      "src/pages/orders/config.json": JSON.stringify({
        title: "Legacy Smallfish title",
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
      path.join(cwd, "src/pages/orders/config.json"),
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
    ).rejects.toThrow("has multiple canonical Page entries");
  });

  it("allows an index.* component only as an explicit migration alias", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/legacy/index.tsx":
        "export default function Legacy() { return null; }",
    });
    const config = resolveConfig({
      application: {
        routes: [{ path: "/legacy", component: "legacy/index" }],
      },
    });

    const graph = await createConfigRouteGraph(config, cwd);
    expect(graph.pages.legacy?.source).toMatchObject({
      module: "./src/pages/legacy/index.tsx",
      scope: { kind: "directory", root: "./src/pages/legacy" },
      provider: CONFIG_ROUTE_PROVIDER_ID,
    });
  });

  it("keeps a direct Bigfish component module as a module-scoped Page", async () => {
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

  it("uses explicit Bigfish path syntax and diagnoses the target file convention", async () => {
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
      'Bigfish migration/config-route syntax. Explicit route paths use ":param" and terminal "*"; the target Page file convention uses "$param" and terminal "$...splat"',
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
    ).rejects.toThrow(
      'Bigfish migration/config-route wildcard "*" must be terminal',
    );
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
      application: {
        document: { template: "./app.html" },
        routes: [{ path: "/report", page: "report" }],
      },
    });
    const graph = (await createCoreGraph(config, cwd)).graph;
    const plan = createBuildPlan(config, graph, {
      mode: "production",
      buildId: "config-route-metadata",
    });
    const output = linkBuildOutput({
      graph,
      plan,
      firstClientEntryAssets: { js: ["main.js"], css: [] },
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
  });

  it("materializes graph-derived route types and the generated SPA facade", async () => {
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
      { cwd, runLifecycleHooks: false },
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

      const routeTypes = await fs.readFile(
        path.join(cwd, "src/route-types.d.ts"),
        "utf-8",
      );
      expect(routeTypes).toContain('path: "/users/$userId"');
      expect(routeTypes).toContain('from "./pages/users/detail/page"');
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
