import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type CoreGraph,
  createDeploymentMetadata,
  linkBuildOutput,
  PAGE_ANCHOR_PROVIDER_ID,
} from "@evjs/shared/manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPageClientBuildEntryName,
  createPageServerBuildEntryName,
  createPprRegionBuildEntryName,
  createPprShellBuildEntryName,
  createRscPageBuildEntryName,
  GENERATED_PAGES_APP_BUILD_ENTRY,
  SERVER_RUNTIME_BUILD_ENTRY_NAME,
} from "../src/_internal/build/build-entry-conventions.js";
import type {
  BuildPlanConfig,
  GraphConfig,
} from "../src/_internal/build/index.js";
import {
  createBuildPlan,
  createCoreGraph,
  diffBuildPlan,
  discoverPageRoutes,
} from "../src/_internal/build/index.js";
import { hashServerFunction } from "../src/_internal/build/utils.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("canonical CoreGraph and BuildPlan integration", () => {
  it("assigns a unique identity to each production generation", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);

    const first = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });
    const second = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });
    const development = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });
    const explicit = createBuildPlan(config, analysis.graph, {
      buildId: "release-42",
      mode: "production",
    });

    expect(first.buildId).toMatch(/^build-[a-f0-9-]{36}$/);
    expect(second.buildId).not.toBe(first.buildId);
    expect(development.buildId).toBe("development");
    expect(explicit.buildId).toBe("release-42");
  });

  it.each([
    { mode: "spa", render: "csr", pageDocument: false },
    { mode: "spa", render: "ssr", pageDocument: false },
    { mode: "spa", render: "ssg", pageDocument: true },
    { mode: "mpa", render: "csr", pageDocument: true },
    { mode: "mpa", render: "ssr", pageDocument: true },
    { mode: "mpa", render: "ssg", pageDocument: true },
  ] as const)("plans $mode $render Page Document materialization", async ({
    mode,
    render,
    pageDocument,
  }) => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "src/pages/page.config.ts": `export default { render: ${JSON.stringify(render)} };`,
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, mode);
    const analysis = await createCoreGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(
      plan.html.some((document) => document.owner.pageId === "index"),
    ).toBe(pageDocument);
    expect(
      plan.server.documents?.some((document) => document.pageId === "index") ??
        false,
    ).toBe(render === "ssr");
  });

  it("links an MPA SSR fallback Document without changing its deployment route", async () => {
    const cwd = await createFixture({
      "src/pages/about/page.tsx":
        "export default function About() { return null; }",
      "src/pages/about/page.config.ts":
        'export default { render: "ssr", hydrate: "load" };',
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "mpa");
    const analysis = await createCoreGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });
    const clientEntry = createPageClientBuildEntryName("about");
    const output = linkBuildOutput({
      graph: analysis.graph,
      plan,
      clientEntryAssets: {
        [clientEntry]: { js: [`${clientEntry}.js`], css: [] },
      },
      serverEntryAssets: Object.fromEntries(
        plan.entries
          .filter((entry) => entry.environment === "server")
          .map((entry) => [entry.name, { js: [`${entry.name}.js`], css: [] }]),
      ),
    });

    expect(output.pages.about.document).toEqual({ fileName: "about.html" });
    expect(createDeploymentMetadata(output)).toMatchObject({
      documents: [
        {
          kind: "page",
          id: "about",
          fileName: "about.html",
          assets: { js: [`${clientEntry}.js`], css: [] },
        },
      ],
      routes: [
        {
          kind: "server-page",
          path: "/about",
          pageId: "about",
          render: "ssr",
          methods: ["GET", "HEAD"],
        },
      ],
    });
  });

  it("projects server-only build settings", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    config.server.resolve = {
      alias: { "server-sdk": "./src/server/sdk.ts" },
    };
    config.server.externals = {
      "native-addon": "commonjs native-addon",
    };
    const analysis = await createCoreGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph);

    expect(plan.server.resolve).toEqual({
      alias: config.server.resolve.alias,
    });
    expect(plan.server.externals).toEqual(config.server.externals);
    expect(plan.server.resolve?.alias).not.toBe(config.server.resolve.alias);
    expect(plan.server.externals).not.toBe(config.server.externals);

    const next = structuredClone(plan);
    delete next.server.resolve;
    delete next.server.externals;
    expect(diffBuildPlan(plan, next, "config").serverCompilationChanged).toBe(
      true,
    );
  });

  it("keeps recursively cleaned outputs inside the BuildPlan distDir", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);

    for (const unsafeOutput of [
      { client: "src", server: "dist/server" },
      { client: "dist", server: "dist/server" },
      { client: "dist/client", server: "server-output" },
    ]) {
      expect(() =>
        createBuildPlan({ ...config, output: unsafeOutput }, analysis.graph),
      ).toThrow('must be a strict descendant of plan.distDir "dist"');
    }

    expect(() =>
      createBuildPlan(
        {
          ...config,
          output: { client: "custom/client", server: "custom/server" },
        },
        analysis.graph,
        { distDir: "custom" },
      ),
    ).not.toThrow();

    expect(() =>
      createBuildPlan(
        {
          ...config,
          output: { client: "dist/client", server: "dist/server" },
        },
        analysis.graph,
        { distDir: "DIST" },
      ),
    ).toThrow('must be a strict descendant of plan.distDir "DIST"');

    expect(() =>
      createBuildPlan(
        {
          ...config,
          output: { client: "dist\\client", server: "dist/server" },
        },
        analysis.graph,
      ),
    ).toThrow("output.client must be a non-empty portable output directory");

    for (const client of [
      "dist/client.",
      "dist/AUX",
      "dist/client?",
      "dist/client//nested",
    ]) {
      expect(() =>
        createBuildPlan(
          {
            ...config,
            output: { client, server: "dist/server" },
          },
          analysis.graph,
        ),
      ).toThrow("output.client must be a non-empty portable output directory");
    }

    expect(() =>
      createBuildPlan(
        {
          ...config,
          output: {
            client: "dist/caf\u00e9",
            server: "dist/cafe\u0301",
          },
        },
        analysis.graph,
      ),
    ).toThrow("output.client must be a non-empty portable output directory");
  });

  it("revalidates concrete runtime endpoint grammar at the BuildPlan boundary", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);

    expect(() =>
      createBuildPlan(
        {
          ...config,
          server: { ...config.server, basePath: "/运行" },
        },
        analysis.graph,
      ),
    ).toThrow("runtime.server.basePath must use non-empty ASCII URL-safe");
    expect(() =>
      createBuildPlan(
        {
          ...config,
          server: { ...config.server, basePath: "__evjs" },
        },
        analysis.graph,
      ),
    ).toThrow('runtime.server.basePath must start with "/"');
    expect(() =>
      createBuildPlan(
        {
          ...config,
          server: {
            ...config.server,
            runtime: { ...config.server.runtime, fn: "__evjs/%66n" },
          },
        },
        analysis.graph,
      ),
    ).toThrow("runtime.server.fn must use non-empty ASCII URL-safe");
    expect(() =>
      createBuildPlan(
        {
          ...config,
          server: {
            ...config.server,
            runtime: { ...config.server.runtime, fn: "/__evjs/fn" },
          },
        },
        analysis.graph,
      ),
    ).toThrow('runtime.server.fn must not start with "/"');

    const rscGraph: CoreGraph = {
      ...analysis.graph,
      pages: {
        ...analysis.graph.pages,
        index: {
          ...analysis.graph.pages.index,
          render: "ssr",
          hydrate: "none",
          componentModel: "rsc",
        },
      },
    };
    expect(() =>
      createBuildPlan(
        {
          ...config,
          server: {
            ...config.server,
            runtime: { ...config.server.runtime, rsc: "flight/航班" },
          },
        },
        rscGraph,
      ),
    ).toThrow("runtime.server.rsc must use non-empty ASCII URL-safe");
    expect(() =>
      createBuildPlan(
        {
          ...config,
          server: {
            ...config.server,
            runtime: { ...config.server.runtime, rsc: "/flight" },
          },
        },
        rscGraph,
      ),
    ).toThrow('runtime.server.rsc must not start with "/"');

    const pprGraph: CoreGraph = {
      ...analysis.graph,
      pages: {
        ...analysis.graph.pages,
        index: {
          ...analysis.graph.pages.index,
          render: "ssr",
          hydrate: "none",
          prerender: { partial: true },
        },
      },
    };
    expect(() =>
      createBuildPlan(
        {
          ...config,
          server: {
            ...config.server,
            runtime: { ...config.server.runtime, ppr: "__evjs/%70pr" },
          },
        },
        pprGraph,
      ),
    ).toThrow("runtime.server.ppr must use non-empty ASCII URL-safe");
    expect(() =>
      createBuildPlan(
        {
          ...config,
          server: {
            ...config.server,
            runtime: { ...config.server.runtime, ppr: "/__evjs/ppr" },
          },
        },
        pprGraph,
      ),
    ).toThrow('runtime.server.ppr must not start with "/"');
  });

  it("normalizes one SPA Page tree and keeps the generated router out of CoreGraph", async () => {
    const cwd = await createFixture({
      "src/pages/layout.tsx":
        "export default function Layout({ children }) { return children; }",
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "src/pages/users/layout.tsx":
        "export default function UsersLayout({ children }) { return children; }",
      "src/pages/users/error.tsx":
        "export default function UsersError() { return null; }",
      "src/pages/users/not-found.tsx":
        "export default function UsersNotFound() { return null; }",
      "src/pages/users/page.tsx":
        "export default function Users() { return null; }",
      "src/pages/users/$userId/page.tsx":
        "export default function User() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.graph.applications.default).toMatchObject({
      id: "default",
      routingMode: "spa",
      layout: "./src/pages/layout.tsx",
      pageIds: ["index", "users", "users_userId"],
      documentIds: ["index"],
      provenance: {
        producer: { kind: "provider", id: PAGE_ANCHOR_PROVIDER_ID },
        source: "./src/pages",
      },
    });
    expect(analysis.graph.applications.default).not.toHaveProperty("entry");
    expect(analysis.graph.pages.users_userId).toMatchObject({
      id: "users_userId",
      applicationId: "default",
      source: {
        module: "./src/pages/users/$userId/page.tsx",
        scope: {
          kind: "directory",
          root: "./src/pages/users/$userId",
        },
        provider: PAGE_ANCHOR_PROVIDER_ID,
      },
      render: "csr",
    });

    const routes = new Map(
      analysis.graph.routes.map((route) => [route.id, route]),
    );
    expect(routes.get("users")).toMatchObject({
      pattern: {
        segments: [{ kind: "static", value: "users" }],
      },
      target: { kind: "page", pageId: "users" },
      facets: {
        layout: "./src/pages/users/layout.tsx",
        error: "./src/pages/users/error.tsx",
        notFound: "./src/pages/users/not-found.tsx",
        wrappers: [],
      },
    });
    expect(routes.get("users")).not.toHaveProperty("parentId");
    expect(routes.get("users_userId")).toMatchObject({
      parentId: "users",
      pattern: {
        segments: [
          { kind: "static", value: "users" },
          { kind: "param", name: "userId" },
        ],
      },
      target: { kind: "page", pageId: "users_userId" },
    });

    expect(plan.entries).toContainEqual({
      name: "main",
      import: GENERATED_PAGES_APP_BUILD_ENTRY,
      environment: "client",
      runtime: "browser",
      kind: "app-client",
      owner: { appId: "default" },
      metadata: {
        type: "pages-app",
        routes: expect.arrayContaining([
          expect.objectContaining({
            id: "users_userId",
            path: "/users/$userId",
            module: "./src/pages/users/$userId/page.tsx",
          }),
        ]),
        mount: "#app",
        rootModule: "./src/pages/layout.tsx",
      },
    });
    expect(plan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { appId: "default" },
      },
    ]);
    expect(plan.runtime.server?.rsc).toBeUndefined();
  });

  it("selects only the unique Application-owned Document for SPA planning", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);
    const graphWithPluginDocument: CoreGraph = {
      ...analysis.graph,
      plugins: {
        entries: {
          "test-plugin": {},
        },
      },
      applications: {
        ...analysis.graph.applications,
        default: {
          ...analysis.graph.applications.default,
          documentIds: ["index", "plugin-overlay"],
        },
      },
      documents: {
        ...analysis.graph.documents,
        "plugin-overlay": {
          id: "plugin-overlay",
          template: "./plugin.html",
          output: "plugin.html",
          applicationId: "default",
          owner: { kind: "plugin", pluginId: "test-plugin" },
          provenance: {
            producer: { kind: "plugin", id: "test-plugin" },
          },
        },
      },
    };

    const plan = createBuildPlan(config, graphWithPluginDocument);
    expect(plan.html).toContainEqual({
      id: "index",
      template: "./index.html",
      fileName: "index.html",
      owner: { appId: "default" },
    });

    const graphWithDuplicateApplicationDocument: CoreGraph = {
      ...graphWithPluginDocument,
      applications: {
        ...graphWithPluginDocument.applications,
        default: {
          ...graphWithPluginDocument.applications.default,
          documentIds: ["index", "alternate", "plugin-overlay"],
        },
      },
      documents: {
        ...graphWithPluginDocument.documents,
        alternate: {
          id: "alternate",
          template: "./alternate.html",
          output: "alternate.html",
          applicationId: "default",
          owner: { kind: "application" },
          provenance: {
            producer: { kind: "provider", id: PAGE_ANCHOR_PROVIDER_ID },
          },
        },
      },
    };
    expect(() =>
      createBuildPlan(config, graphWithDuplicateApplicationDocument),
    ).toThrow(
      'Application "default" owns more than one Application Document: "index" and "alternate".',
    );
  });

  it("materializes the same semantic Pages and client Routes as SPA or MPA", async () => {
    const cwd = await createFixture({
      "src/pages/layout.tsx":
        "export default function Layout({ children }) { return children; }",
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "src/pages/about/page.tsx":
        "export default function About() { return null; }",
      "src/pages/about/page.config.ts": `
        export default {
          title: "About",
          meta: {
            description: "About this application",
            Robots: "index,follow",
          },
        };
      `,
      "src/pages/foo/bar/page.tsx":
        "export default function Nested() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const spaConfig = await createCanonicalConfig(cwd, "spa");
    const mpaConfig = await createCanonicalConfig(cwd, "mpa");
    const spa = await createCoreGraph(spaConfig, cwd);
    const mpa = await createCoreGraph(mpaConfig, cwd);
    const spaPlan = createBuildPlan(spaConfig, spa.graph, {
      mode: "development",
    });
    const mpaPlan = createBuildPlan(mpaConfig, mpa.graph, {
      mode: "development",
    });

    expect(spa.diagnostics).toEqual([]);
    expect(mpa.diagnostics).toEqual([]);
    expect(mpa.graph.pages).toEqual(spa.graph.pages);
    expect(spa.graph.pages).toMatchObject({
      index: { render: "csr" },
      about: { render: "csr" },
      foo_bar: { render: "csr" },
    });
    expect(spa.graph.pages.index).not.toHaveProperty("hydrate");
    expect(spa.graph.pages.about).not.toHaveProperty("hydrate");
    expect(clientRouteProjection(mpa.graph)).toEqual(
      clientRouteProjection(spa.graph),
    );
    expect(spa.graph.applications.default).toMatchObject({
      routingMode: "spa",
      pageIds: ["index", "about", "foo_bar"],
      documentIds: ["index"],
    });
    expect(mpa.graph.applications.default).toMatchObject({
      routingMode: "mpa",
      pageIds: ["index", "about", "foo_bar"],
      documentIds: ["index", "about", "foo_bar"],
    });
    expect(mpa.graph.pages.about.metadata).toEqual({
      title: "About",
      meta: {
        description: "About this application",
        Robots: "index,follow",
      },
    });
    expect(mpa.graph.documents).toMatchObject({
      index: {
        output: "index.html",
        owner: { kind: "page", pageId: "index" },
        bootstrap: { kind: "page", pageId: "index" },
      },
      about: {
        output: "about.html",
        owner: { kind: "page", pageId: "about" },
        bootstrap: { kind: "page", pageId: "about" },
      },
      foo_bar: {
        output: "foo/bar.html",
        owner: { kind: "page", pageId: "foo_bar" },
        bootstrap: { kind: "page", pageId: "foo_bar" },
      },
    });

    expect(
      spaPlan.entries.filter((entry) => entry.environment === "client"),
    ).toHaveLength(1);
    expect(
      mpaPlan.entries
        .filter((entry) => entry.kind === "page-client")
        .map((entry) => ({
          name: entry.name,
          owner: entry.owner,
          layers:
            entry.metadata?.type === "react-component-page"
              ? entry.metadata.layers
              : undefined,
          render:
            entry.metadata?.type === "react-component-page"
              ? entry.metadata.render
              : undefined,
          hydrate:
            entry.metadata?.type === "react-component-page"
              ? entry.metadata.hydrate
              : undefined,
        })),
    ).toEqual([
      {
        name: createPageClientBuildEntryName("index"),
        owner: { appId: "default", pageId: "index" },
        layers: [{ kind: "layout", module: "./src/pages/layout.tsx" }],
        render: "csr",
        hydrate: "load",
      },
      {
        name: createPageClientBuildEntryName("about"),
        owner: { appId: "default", pageId: "about" },
        layers: [{ kind: "layout", module: "./src/pages/layout.tsx" }],
        render: "csr",
        hydrate: "load",
      },
      {
        name: createPageClientBuildEntryName("foo_bar"),
        owner: { appId: "default", pageId: "foo_bar" },
        layers: [{ kind: "layout", module: "./src/pages/layout.tsx" }],
        render: "csr",
        hydrate: "load",
      },
    ]);
    expect(mpaPlan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { appId: "default", pageId: "index" },
      },
      {
        id: "about",
        template: "./index.html",
        fileName: "about.html",
        owner: { appId: "default", pageId: "about" },
        metadata: {
          title: "About",
          meta: {
            description: "About this application",
            Robots: "index,follow",
          },
        },
      },
      {
        id: "foo_bar",
        template: "./index.html",
        fileName: "foo/bar.html",
        owner: { appId: "default", pageId: "foo_bar" },
      },
    ]);

    const output = linkBuildOutput({
      graph: mpa.graph,
      plan: mpaPlan,
      clientEntryAssets: {
        [createPageClientBuildEntryName("index")]: {
          js: ["index.js"],
          css: [],
        },
        [createPageClientBuildEntryName("about")]: {
          js: ["about.js"],
          css: ["about.css"],
        },
        [createPageClientBuildEntryName("foo_bar")]: {
          js: ["nested.js"],
          css: [],
        },
      },
    });
    expect(output.apps).toEqual({});
    expect(output.routes).toEqual([
      { id: "index", path: "/", pageId: "index" },
      { id: "about", path: "/about", pageId: "about" },
      { id: "foo_bar", path: "/foo/bar", pageId: "foo_bar" },
    ]);
    expect(output.pages.about.document).toEqual({
      fileName: "about.html",
    });
    expect(output.pages.about.metadata).toEqual({
      title: "About",
      meta: {
        description: "About this application",
        Robots: "index,follow",
      },
    });
  });

  it("projects MPA Page Document aliases through CoreGraph and BuildPlan", async () => {
    const cwd = await createFixture({
      "src/pages/about/page.tsx":
        "export default function About() { return null; }",
      "src/pages/about/page.config.ts": `
        export default {
          document: { aliases: ["legacy/about.html", "legacy/about.htm"] },
        };
      `,
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "mpa");
    const analysis = await createCoreGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(analysis.graph.documents.about).toMatchObject({
      output: "about.html",
      aliases: ["legacy/about.html", "legacy/about.htm"],
      owner: { kind: "page", pageId: "about" },
    });
    expect(plan.html).toEqual([
      {
        id: "about",
        template: "./index.html",
        fileName: "about.html",
        aliases: ["legacy/about.html", "legacy/about.htm"],
        owner: { appId: "default", pageId: "about" },
      },
    ]);

    const output = linkBuildOutput({
      graph: analysis.graph,
      plan,
      clientEntryAssets: {
        [createPageClientBuildEntryName("about")]: {
          js: ["about.js"],
          css: [],
        },
      },
    });
    expect(output.pages.about.document).toEqual({
      fileName: "about.html",
      aliases: ["legacy/about.html", "legacy/about.htm"],
    });
  });

  it("materializes SPA SSG aliases as one Page-owned static Document", async () => {
    const cwd = await createFixture({
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        export default {
          render: "ssg",
          hydrate: "none",
          document: { aliases: ["report.html"] },
        };
      `,
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(
      Object.values(analysis.graph.documents).filter(
        (document) =>
          document.owner.kind === "page" && document.owner.pageId === "report",
      ),
    ).toEqual([
      expect.objectContaining({
        output: "report/index.html",
        aliases: ["report.html"],
      }),
    ]);
    expect(plan.html).toEqual([
      {
        id: "report",
        template: "./index.html",
        fileName: "report/index.html",
        aliases: ["report.html"],
        owner: { pageId: "report" },
      },
    ]);
  });

  it("rejects Page aliases without an independently static Document", async () => {
    const cwd = await createFixture({
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        export default {
          document: { aliases: ["report.html"] },
        };
      `,
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");

    await expect(createCoreGraph(config, cwd)).rejects.toThrow(
      'SPA render mode "csr" shares its Application Document',
    );
  });

  it("rejects one static alias for a dynamic SPA SSG route", async () => {
    const cwd = await createFixture({
      "src/pages/posts/$postId/page.tsx":
        "export default function Post() { return null; }",
      "src/pages/posts/$postId/page.config.ts": `
        export default {
          render: "ssg",
          hydrate: "none",
          document: { aliases: ["post.html"] },
        };
      `,
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");

    await expect(createCoreGraph(config, cwd)).rejects.toThrow(
      'cannot materialize dynamic Route "/posts/$postId" as one static HTML output',
    );
  });

  it("rejects a Page alias that collides with the SPA Application Document", async () => {
    const cwd = await createFixture({
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        export default {
          render: "ssg",
          hydrate: "none",
          document: { aliases: ["index.html"] },
        };
      `,
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");

    await expect(createCoreGraph(config, cwd)).rejects.toThrow(
      /aliases\[0\] "index\.html" conflicts with canonical output owned by Document "index"/,
    );
  });

  it("rejects non-portable HTML outputs and cross-platform aliases", async () => {
    const cwd = await createFixture({
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "mpa");
    const analysis = await createCoreGraph(config, cwd);
    const document = analysis.graph.documents.report;
    if (!document) throw new Error("Expected the report Document.");

    const originalOutput = document.output;
    document.output = "nested/../report.html";
    expect(() => createBuildPlan(config, analysis.graph)).toThrow(
      "must be a non-empty portable relative artifact path",
    );
    document.output = originalOutput;

    for (const alias of [
      String.raw`nested\report.html`,
      "nested//report.html",
      "./report.html",
      "NUL/report.html",
      "nested/report.",
      "nested/report?.html",
      "nested/\u001f.html",
    ]) {
      document.aliases = [alias];
      expect(() => createBuildPlan(config, analysis.graph)).toThrow(
        "must be a non-empty portable relative artifact path",
      );
    }

    document.aliases = ["REPORT.HTML"];
    expect(() => createBuildPlan(config, analysis.graph)).toThrow(
      'Duplicate HTML output file "REPORT.HTML"',
    );

    document.aliases = [`${originalOutput}/nested.html`];
    expect(() => createBuildPlan(config, analysis.graph)).toThrow(
      `Duplicate HTML output file "${originalOutput}/nested.html"`,
    );

    document.aliases = ["cafe\u0301.html"];
    expect(() => createBuildPlan(config, analysis.graph)).toThrow(
      "must be a non-empty portable relative artifact path",
    );
  });

  it("diffs alias additions and removals as HTML Document changes", async () => {
    const cwd = await createFixture({
      "src/pages/about/page.tsx":
        "export default function About() { return null; }",
      "src/pages/about/page.config.ts":
        'export default { document: { aliases: ["legacy/about.html"] } };',
      "index.html": '<main id="app"></main>',
    });
    const previousConfig = await createCanonicalConfig(cwd, "mpa");
    const previousAnalysis = await createCoreGraph(previousConfig, cwd);
    const previousPlan = createBuildPlan(
      previousConfig,
      previousAnalysis.graph,
      { mode: "development" },
    );

    await fs.writeFile(
      path.join(cwd, "src/pages/about/page.config.ts"),
      "export default {};",
      "utf-8",
    );
    const nextConfig = await createCanonicalConfig(cwd, "mpa");
    const nextAnalysis = await createCoreGraph(nextConfig, cwd);
    const nextPlan = createBuildPlan(nextConfig, nextAnalysis.graph, {
      mode: "development",
    });
    const update = diffBuildPlan(previousPlan, nextPlan, "config");

    expect(update.html.added).toEqual([]);
    expect(update.html.removed).toEqual([]);
    expect(update.html.changed).toEqual([
      {
        id: "about",
        template: "./index.html",
        fileName: "about.html",
        owner: { appId: "default", pageId: "about" },
      },
    ]);
  });

  it("normalizes dynamic, catch-all, pathless, and prototype-shaped route ids", async () => {
    const cwd = await createFixture({
      "src/pages/constructor/page.tsx":
        "export default function ConstructorPage() { return null; }",
      "src/pages/toString/page.tsx":
        "export default function ToStringPage() { return null; }",
      "src/pages/users/$userId/page.tsx":
        "export default function User() { return null; }",
      "src/pages/docs/$...splat/page.tsx":
        "export default function Docs() { return null; }",
      "src/pages/(admin)/settings/page.tsx":
        "export default function Settings() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([]);
    expect(Object.hasOwn(analysis.graph.pages, "constructor")).toBe(true);
    expect(Object.hasOwn(analysis.graph.pages, "toString")).toBe(true);
    expect(
      analysis.graph.routes.map((route) => formatGraphRoutePath(route)),
    ).toEqual(
      expect.arrayContaining([
        "/constructor",
        "/toString",
        "/users/$userId",
        "/docs/$",
        "/settings",
      ]),
    );
    expect(
      analysis.graph.routes.find(
        (route) => formatGraphRoutePath(route) === "/users/$userId",
      ),
    ).toMatchObject({
      pattern: {
        segments: [
          { kind: "static", value: "users" },
          { kind: "param", name: "userId" },
        ],
      },
    });
    expect(
      analysis.graph.routes.find(
        (route) => formatGraphRoutePath(route) === "/docs/$",
      ),
    ).toMatchObject({
      pattern: {
        segments: [
          { kind: "static", value: "docs" },
          { kind: "splat", name: "_splat" },
        ],
      },
    });
  });

  it("projects SSR, SSG, RSC, and PPR page.config settings into one plan", async () => {
    const cwd = await createFixture({
      "src/pages/layout.tsx":
        "export default function RootLayout({ children }) { return children; }",
      "src/pages/ssr/layout.tsx":
        "export default function SsrLayout({ children }) { return children; }",
      "src/pages/ssr/page.tsx":
        "export default function Ssr() { return null; }",
      "src/pages/ssr/page.config.ts":
        'export default { render: "ssr", hydrate: "load" };',
      "src/pages/ssg/page.tsx":
        "export default function Ssg() { return null; }",
      "src/pages/ssg/page.config.ts":
        'export default { render: "ssg", hydrate: "none", prerender: true };',
      "src/pages/rsc/page.tsx":
        "export default function Rsc() { return null; }",
      "src/pages/rsc/page.config.ts":
        'export default { render: "ssr", hydrate: "none", rsc: true };',
      "src/pages/ppr/page.tsx": `
        import * as React from "react";
        const Offer = React.lazy(() => import("./Offer.region"));

        export default function Ppr() {
          return (
            <React.Suspense fallback={<p>Loading</p>}>
              <Offer />
            </React.Suspense>
          );
        }
      `,
      "src/pages/ppr/Offer.region.tsx": `
        export const cache = { revalidate: 30 } as const;
        export default function Offer() { return null; }
      `,
      "src/pages/ppr/page.config.ts": `
        export default {
          render: "ssr",
          hydrate: "none",
          prerender: { partial: true, delivery: "stream" },
        };
      `,
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "mpa");
    const analysis = await createCoreGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });
    const pprRegionId = getSinglePprRegionId(
      analysis.graph.pages.ppr.ppr?.regions,
    );

    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.graph.pages).toMatchObject({
      ssr: { render: "ssr", hydrate: "load" },
      ssg: { render: "ssg", hydrate: "none", prerender: true },
      rsc: {
        render: "ssr",
        hydrate: "none",
        componentModel: "rsc",
      },
      ppr: {
        render: "ssr",
        hydrate: "none",
        prerender: { partial: true, delivery: "stream" },
        ppr: {
          delivery: "stream",
          regions: {
            [pprRegionId]: {
              component: "./src/pages/ppr/Offer.region.tsx",
              cache: { revalidate: 30 },
            },
          },
        },
      },
    });
    expect(plan.runtime.server).toMatchObject({
      ppr: "__evjs/ppr",
      rsc: "__evjs/rsc",
    });
    expect(plan.dev.serverRequestRoutePaths).toEqual([]);
    expect(new Set(plan.dev.serverRenderedPagePaths)).toEqual(
      new Set(["/ssr.html", "/rsc.html", "/ppr.html"]),
    );
    expect(plan.dev.serverRenderedPagePaths).not.toContain("/ssg");
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: createPageClientBuildEntryName("ssr"),
          kind: "page-client",
          owner: { appId: "default", pageId: "ssr" },
        }),
        expect.objectContaining({
          name: createPageServerBuildEntryName("ssr"),
          import: "./src/pages/ssr/page.tsx",
          environment: "server",
          runtime: "node",
          kind: "page-server",
          owner: { pageId: "ssr", routeId: "ssr" },
          metadata: {
            type: "react-server-page",
            component: "./src/pages/ssr/page.tsx",
            layers: [
              {
                kind: "layout",
                module: "./src/pages/layout.tsx",
              },
              {
                kind: "layout",
                module: "./src/pages/ssr/layout.tsx",
              },
            ],
          },
        }),
        expect.objectContaining({
          name: createPageServerBuildEntryName("ssg"),
          import: "./src/pages/ssg/page.tsx",
          environment: "server",
          runtime: "node",
          kind: "page-server",
          phase: "build",
          owner: { pageId: "ssg", routeId: "ssg" },
        }),
        expect.objectContaining({
          name: createRscPageBuildEntryName("rsc"),
          import: "./src/pages/rsc/page.tsx",
          environment: "server",
          runtime: "node",
          kind: "rsc-page",
          owner: { pageId: "rsc", routeId: "rsc" },
        }),
        expect.objectContaining({
          name: createPprShellBuildEntryName("ppr"),
          import: "./src/pages/ppr/page.tsx",
          environment: "server",
          runtime: "node",
          kind: "ppr-shell",
          owner: { pageId: "ppr", routeId: "ppr" },
        }),
        {
          name: createPprRegionBuildEntryName("ppr", pprRegionId),
          import: "./src/pages/ppr/Offer.region.tsx",
          environment: "server",
          runtime: "node",
          kind: "ppr-region",
          owner: {
            pageId: "ppr",
            routeId: "ppr",
            regionId: pprRegionId,
          },
        },
      ]),
    );
    expect(
      plan.entries
        .filter((entry) => entry.kind === "page-client")
        .map((entry) => entry.owner?.pageId),
    ).toEqual(["ssr"]);
    expect(
      new Set(plan.html.flatMap((document) => document.owner.pageId ?? [])),
    ).toEqual(new Set(["ssg", "ssr"]));
    expect(plan.server.renderers?.map((renderer) => renderer.kind)).toEqual(
      expect.arrayContaining([
        "page-server",
        "rsc-page",
        "ppr-shell",
        "ppr-region",
      ]),
    );
    expect(plan.server.documents).toEqual([
      {
        pageId: "ppr",
        documentId: "ppr",
        applicationId: "default",
        template: "./index.html",
        fileName: "ppr.html",
        mount: "#app",
      },
      {
        pageId: "rsc",
        documentId: "rsc",
        applicationId: "default",
        template: "./index.html",
        fileName: "rsc.html",
        mount: "#app",
      },
      {
        pageId: "ssr",
        documentId: "ssr",
        applicationId: "default",
        template: "./index.html",
        fileName: "ssr.html",
        mount: "#app",
      },
    ]);
    expect(
      plan.server.documents?.some((document) => document.pageId === "ssg"),
    ).toBe(false);
  });

  it("uses MPA Document URLs for server-rendered dev paths without changing SPA routes", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "src/pages/page.config.ts": 'export default { render: "ssr" };',
      "src/pages/about/page.tsx":
        "export default function About() { return null; }",
      "src/pages/about/page.config.ts": 'export default { render: "ssr" };',
      "index.html": '<main id="app"></main>',
    });
    const spaConfig = await createCanonicalConfig(cwd, "spa");
    const mpaConfig = await createCanonicalConfig(cwd, "mpa");
    const spa = await createCoreGraph(spaConfig, cwd);
    const mpa = await createCoreGraph(mpaConfig, cwd);
    const spaPlan = createBuildPlan(spaConfig, spa.graph, {
      mode: "development",
    });
    const mpaPlan = createBuildPlan(mpaConfig, mpa.graph, {
      mode: "development",
    });

    expect(clientRouteProjection(mpa.graph)).toEqual(
      clientRouteProjection(spa.graph),
    );
    expect(spaPlan.dev.serverRenderedPagePaths).toEqual(["/", "/about"]);
    expect(mpaPlan.dev.serverRenderedPagePaths).toEqual([
      "/index.html",
      "/about.html",
    ]);
  });

  it("uses the SPA Application Document as an explicit SSR Page shell without emitting it twice", async () => {
    const cwd = await createFixture({
      "src/pages/dashboard/page.tsx":
        "export default function Dashboard() { return null; }",
      "src/pages/dashboard/page.config.ts":
        'export default { render: "ssr", title: "Dashboard" };',
      "index.html":
        '<!doctype html><html lang="zh-CN"><head></head><body><main id="app"></main></body></html>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(plan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { appId: "default" },
      },
    ]);
    expect(plan.server.documents).toEqual([
      {
        pageId: "dashboard",
        documentId: "index",
        applicationId: "default",
        template: "./index.html",
        fileName: "index.html",
        mount: "#app",
        metadata: { title: "Dashboard" },
      },
    ]);
  });

  it("uses semantic route directories for SPA SSG documents", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "src/pages/page.config.ts":
        'export default { render: "ssg", hydrate: "none" };',
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts":
        'export default { render: "ssg", hydrate: "none" };',
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(analysis.graph.applications.default.documentIds).toEqual([
      "index",
      "page:index",
      "report",
    ]);
    expect(analysis.graph.documents).toMatchObject({
      index: {
        output: "__evjs/default.html",
        owner: { kind: "application" },
      },
      "page:index": {
        output: "index.html",
        owner: { kind: "page", pageId: "index" },
        bootstrap: { kind: "page", pageId: "index" },
      },
      report: {
        output: "report/index.html",
        owner: { kind: "page", pageId: "report" },
        bootstrap: { kind: "page", pageId: "report" },
      },
    });
    expect(plan.html).toEqual([
      {
        id: "page:index",
        template: "./index.html",
        fileName: "index.html",
        owner: { pageId: "index" },
      },
      {
        id: "report",
        template: "./index.html",
        fileName: "report/index.html",
        owner: { pageId: "report" },
      },
    ]);
  });

  it("keeps mixed SPA HTML identities distinct and reports root SSG removal", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "src/pages/page.config.ts":
        'export default { render: "ssg", hydrate: "none" };',
      "src/pages/dashboard/page.tsx":
        "export default function Dashboard() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(plan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "__evjs/default.html",
        owner: { appId: "default" },
      },
      {
        id: "page:index",
        template: "./index.html",
        fileName: "index.html",
        owner: { pageId: "index" },
      },
    ]);
    expect(new Set(plan.html.map((document) => document.fileName)).size).toBe(
      plan.html.length,
    );

    const output = linkBuildOutput({
      graph: analysis.graph,
      plan,
      clientEntryAssets: {
        main: { js: ["main.js"], css: [] },
      },
      serverEntryAssets: {
        [createPageServerBuildEntryName("index")]: {
          js: ["page-server-index.js"],
          css: [],
        },
      },
    });
    expect(output.apps.default?.document).toEqual({
      fileName: "__evjs/default.html",
    });
    expect(output.pages.index?.document).toEqual({
      fileName: "index.html",
    });

    await fs.rm(path.join(cwd, "src/pages/page.config.ts"));
    const nextConfig = await createCanonicalConfig(cwd, "spa");
    const nextAnalysis = await createCoreGraph(nextConfig, cwd);
    const nextPlan = createBuildPlan(nextConfig, nextAnalysis.graph, {
      mode: "production",
    });
    const update = diffBuildPlan(plan, nextPlan, "route-declaration");

    expect(update.html.removed).toEqual([
      {
        id: "page:index",
        template: "./index.html",
        fileName: "index.html",
        owner: { pageId: "index" },
      },
    ]);
    expect(update.html.changed).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { appId: "default" },
      },
    ]);
  });

  it("names MPA entries in disjoint owner and kind namespaces", async () => {
    const cwd = await createFixture({
      "src/pages/server/page.tsx":
        "export default function ServerPage() { return null; }",
      "src/pages/evjs-rsc-client/page.tsx":
        "export default function RuntimeNamedPage() { return null; }",
      "src/pages/report-server/page.tsx":
        "export default function RendererNamedPage() { return null; }",
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts":
        'export default { render: "ssr", hydrate: "none", rsc: true };',
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "mpa");
    const analysis = await createCoreGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });
    const names = plan.entries.map((entry) => entry.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        createPageClientBuildEntryName("server"),
        createPageClientBuildEntryName("evjs-rsc-client"),
        createPageClientBuildEntryName("report-server"),
        createPageServerBuildEntryName("report"),
        createRscPageBuildEntryName("report"),
        "evjs-rsc-client",
        SERVER_RUNTIME_BUILD_ENTRY_NAME,
      ]),
    );
  });

  it("rejects BuildEntry names that alias on case-insensitive file systems", async () => {
    const cwd = await createFixture({
      "src/pages/foo/page.tsx":
        "export default function Foo() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "mpa");
    const analysis = await createCoreGraph(config, cwd);
    const graph = structuredClone(analysis.graph);
    const page = graph.pages.foo;
    const route = graph.routes.find(
      (candidate) =>
        candidate.target.kind === "page" && candidate.target.pageId === "foo",
    );
    const document = graph.documents.foo;
    const application = graph.applications.default;
    if (!page || !route || !document || !application) {
      throw new Error("Expected the canonical MPA fixture graph.");
    }

    graph.pages.FOO = { ...page, id: "FOO" };
    graph.routes.push({
      ...route,
      id: "FOO",
      pattern: { segments: [{ kind: "static", value: "FOO" }] },
      target: { kind: "page", pageId: "FOO" },
    });
    graph.documents.FOO = {
      ...document,
      id: "FOO",
      output: "FOO/index.html",
      owner: { kind: "page", pageId: "FOO" },
      bootstrap: { kind: "page", pageId: "FOO" },
    };
    application.pageIds.push("FOO");
    application.routeIds.push("FOO");
    application.documentIds.push("FOO");

    expect(() => createBuildPlan(config, graph)).toThrow(
      'Duplicate build entry name "page-client-FOO" from page "foo" and page "FOO"',
    );
  });

  it("keeps composite PPR region entry names injective", () => {
    expect(createPprRegionBuildEntryName("a-b", "c")).not.toBe(
      createPprRegionBuildEntryName("a", "b-c"),
    );
  });

  it("keeps hydrated SPA SSG client assets while treating its renderer and document as build-only", async () => {
    const cwd = await createFixture({
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts":
        'export default { render: "ssg", hydrate: "load" };',
      "index.html":
        '<!doctype html><html><head></head><body><main id="app"></main></body></html>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(plan.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "main",
          kind: "app-client",
          owner: { appId: "default" },
        }),
        expect.objectContaining({
          name: createPageServerBuildEntryName("report"),
          kind: "page-server",
          phase: "build",
          owner: { pageId: "report", routeId: "report" },
        }),
      ]),
    );
    expect(plan.entries.some((entry) => entry.kind === "server-runtime")).toBe(
      false,
    );
    expect(plan.server.entry).toBeUndefined();
    expect(plan.server.documents).toBeUndefined();
    expect(plan.html).toEqual([
      {
        id: "report",
        template: "./index.html",
        fileName: "report/index.html",
        owner: { pageId: "report" },
      },
    ]);
  });

  it("rejects dynamic SSG Pages before bundler execution", async () => {
    const cwd = await createFixture({
      "src/pages/posts/$postId/page.tsx":
        "export default function Post() { return null; }",
      "src/pages/posts/$postId/page.config.ts":
        'export default { render: "ssg", hydrate: "none" };',
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    await expect(createCoreGraph(config, cwd)).rejects.toThrow(
      'cannot materialize dynamic Route "/posts/$postId" as one static HTML output',
    );
  });

  it("reports unsupported RSC and PPR combinations from page.config.ts", async () => {
    const cwd = await createFixture({
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        export default {
          render: "ssr",
          hydrate: "none",
          rsc: true,
          prerender: { partial: true },
        };
      `,
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");

    await expect(createCoreGraph(config, cwd)).rejects.toThrow(
      'Page "report" config "./src/pages/report/page.config.ts" combines RSC and partial prerendering',
    );
  });

  it.each([
    "load",
    "none",
  ] as const)("rejects manually injected CSR hydrate %s before build planning", async (hydrate) => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);
    const page = analysis.graph.pages.index;
    if (!page) throw new Error("Expected the root Page.");
    page.hydrate = hydrate;

    expect(() => createBuildPlan(config, analysis.graph)).toThrow(
      'Page "index" resolves to render: "csr" and must omit hydrate. Hydration is only configurable for render: "ssr" or "ssg".',
    );
  });

  it("rejects a Core Page without a resolved render mode", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);
    const page = analysis.graph.pages.index;
    if (!page) throw new Error("Expected the root Page.");
    Object.defineProperty(page, "render", { value: undefined });

    expect(() => createBuildPlan(config, analysis.graph)).toThrow(
      'Page "index" is missing its resolved render mode. Core Pages must resolve render before build planning.',
    );
  });

  it("rejects browser-only route lifecycle exports from non-CSR Pages", async () => {
    const cwd = await createFixture({
      "src/pages/report/page.tsx": `
        export async function beforeLoad() {}
        export async function loader() {
          return { report: "quarterly" };
        }
        export default function Report() { return null; }
      `,
      "src/pages/report/page.config.ts":
        'export default { render: "ssr", hydrate: "load" };',
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);

    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/pages/report/page.tsx",
      message:
        'Page "report" uses render "ssr" and exports browser-only route lifecycle "beforeLoad", "loader". Non-CSR Pages cannot use browser-only route lifecycle exports. Remove these exports or use render: "csr".',
    });
  });

  it("collects RSC and server-function references only from the Page source closure", async () => {
    const cwd = await createFixture({
      "src/pages/report/page.tsx": `
        import ClientCard, { ClientBadge } from "./ClientCard";
        import { saveReport } from "../../actions";

        export default function Report() {
          void ClientCard;
          void ClientBadge;
          void saveReport;
          return null;
        }
      `,
      "src/pages/report/ClientCard.tsx": `
        "use client";
        export default function ClientCard() { return null; }
        export function ClientBadge() { return null; }
      `,
      "src/pages/report/page.config.ts":
        'export default { render: "ssr", hydrate: "none", rsc: true };',
      "src/actions.ts": `
        "use server";
        export async function saveReport() {
          return { ok: true };
        }
      `,
      "src/unrelated.ts": `
        "use server";
        export async function shouldNotAppear() {
          return { ok: false };
        }
      `,
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.graph.clientReferences).toEqual([
      {
        id: "src/pages/report/ClientCard.tsx#default",
        module: "src/pages/report/ClientCard.tsx",
        exportName: "default",
      },
      {
        id: "src/pages/report/ClientCard.tsx#ClientBadge",
        module: "src/pages/report/ClientCard.tsx",
        exportName: "ClientBadge",
      },
    ]);
    expect(analysis.graph.serverFunctions).toEqual([
      {
        id: hashServerFunction("src/actions.ts", "saveReport"),
        module: "src/actions.ts",
        exportName: "saveReport",
      },
    ]);
    expect(analysis.graph.serverReferences).toEqual([
      {
        id: hashServerFunction("src/actions.ts", "saveReport"),
        module: "src/actions.ts",
        exportName: "saveReport",
      },
    ]);
    expect(analysis.graph.serverFunctions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ exportName: "shouldNotAppear" }),
      ]),
    );
    expect(plan.entries).toContainEqual(
      expect.objectContaining({
        name: "evjs-rsc-client",
        import: "@evjs/ev/_internal/client/rsc-runtime",
        environment: "client",
        kind: "runtime",
      }),
    );
    expect(plan.entries).toContainEqual(
      expect.objectContaining({
        name: SERVER_RUNTIME_BUILD_ENTRY_NAME,
        import: "@evjs/ev/_internal/server/fetch",
        kind: "server-runtime",
      }),
    );
  });

  it("fails closed when a discovered framework source cannot be read", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": `
        import { value } from "./helper";
        void value;
        export default function Home() { return null; }
      `,
      "src/pages/helper.js": "export const value = 1;",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const helper = path.join(cwd, "src/pages/helper.js");
    const originalReadFile = fs.readFile.bind(fs);
    const readFileSpy = vi.spyOn(fs, "readFile").mockImplementation((async (
      ...args: Parameters<typeof fs.readFile>
    ) => {
      if (path.resolve(String(args[0])) === helper) {
        throw Object.assign(new Error("permission denied"), {
          code: "EACCES",
        });
      }
      return originalReadFile(...args);
    }) as typeof fs.readFile);

    try {
      await expect(createCoreGraph(config, cwd)).rejects.toMatchObject({
        code: "EACCES",
      });
    } finally {
      readFileSpy.mockRestore();
    }
  });

  it("does not bypass an inaccessible higher-priority source candidate", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": `
        import { value } from "./helper";
        void value;
        export default function Home() { return null; }
      `,
      "src/pages/helper.js": "export const value = 1;",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const inaccessibleCandidate = path.join(cwd, "src/pages/helper.ts");
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
      await expect(createCoreGraph(config, cwd)).rejects.toMatchObject({
        code: "EACCES",
      });
    } finally {
      statSpy.mockRestore();
    }
  });

  it("reports every project-local source candidate for extensionless aliases", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": `
        import { value } from "@/shared/helper";
        void value;
        export default function Home() { return null; }
      `,
      "src/shared/helper.js": "export const value = 1;",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const observed = new Set<string>();

    await createCoreGraph(config, cwd, {
      onSourceDependency(file) {
        observed.add(path.resolve(file));
      },
    });

    const base = path.join(cwd, "src/shared/helper");
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
  });

  it("keeps canonical server route dependencies safe when the root is unavailable", async () => {
    const fileRootCwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "src/apis": "not a directory",
      "index.html": '<main id="app"></main>',
    });
    const fileRootConfig = await createCanonicalConfig(fileRootCwd, "spa", {
      serverRoutes: [],
    });

    await expect(
      createCoreGraph(fileRootConfig, fileRootCwd),
    ).resolves.toMatchObject({
      fileDependencies: expect.arrayContaining([
        path.join(fileRootCwd, "src/apis"),
      ]),
    });

    const externalRoot = await createFixture({
      "nested/api.ts":
        "export const GET = async () => Response.json({ outside: true });",
    });
    const symlinkRootCwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    await fs.mkdir(path.join(symlinkRootCwd, "src"), { recursive: true });
    await fs.symlink(
      externalRoot,
      path.join(symlinkRootCwd, "src/apis"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const symlinkRootConfig = await createCanonicalConfig(
      symlinkRootCwd,
      "spa",
      { serverRoutes: [] },
    );
    const analysis = await createCoreGraph(symlinkRootConfig, symlinkRootCwd);

    expect(analysis.fileDependencies).toContain(
      path.join(symlinkRootCwd, "src/apis"),
    );
    expect(analysis.fileDependencies).not.toContain(
      path.join(symlinkRootCwd, "src/apis/nested"),
    );
  });

  it("publishes only configured server file routes and middleware", async () => {
    const globalMiddleware = {
      id: "src/middlewares/middleware.ts:global-middleware",
      module: "src/middlewares/middleware.ts",
      scope: "global" as const,
      scopeSegments: [],
    };
    const userMiddleware = {
      id: "src/apis/users/middleware.ts:route-middleware",
      module: "src/apis/users/middleware.ts",
      scope: "route" as const,
      scopeSegments: ["users"],
    };
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "src/apis/health/api.ts":
        "export const GET = async () => Response.json({ ok: true });",
      "src/apis/users/$userId/api.ts":
        "export const POST = async () => Response.json({ ok: true });",
      "src/middlewares/middleware.ts":
        "export default async function middleware(_ctx, next) { await next(); }",
      "src/apis/users/middleware.ts":
        "export default async function middleware(_ctx, next) { await next(); }",
      "src/programmatic.ts": `
        import { createRoute } from "@evjs/server";
        export const ignored = createRoute("/ignored", {
          GET: async () => Response.json({ ok: true }),
        });
      `,
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa", {
      serverRoutes: [
        {
          id: "src/apis/health/api.ts:/health:GET",
          module: "src/apis/health/api.ts",
          path: "/health",
          methods: ["GET"],
        },
        {
          id: "src/apis/users/$userId/api.ts:/users/:userId:POST",
          module: "src/apis/users/$userId/api.ts",
          path: "/users/:userId",
          methods: ["POST"],
          moduleSegments: ["users", "$userId"],
          middlewares: [userMiddleware],
        },
      ],
      serverConventions: {
        globalMiddlewares: [globalMiddleware],
        routeMiddlewares: [userMiddleware],
      },
    });
    const analysis = await createCoreGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.graph.serverRoutes).toEqual([
      {
        id: "src/apis/health/api.ts:/health:GET",
        module: "src/apis/health/api.ts",
        path: "/health",
        methods: ["GET"],
      },
      {
        id: "src/apis/users/$userId/api.ts:/users/:userId:POST",
        module: "src/apis/users/$userId/api.ts",
        path: "/users/:userId",
        methods: ["POST"],
      },
    ]);
    expect(analysis.graph.serverRoutes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/ignored" })]),
    );
    expect(plan.dev.serverRequestRoutePaths).toEqual([
      "/health",
      "/users/:userId",
    ]);
    expect(plan.dev.serverRenderedPagePaths).toEqual([]);
    expect(plan.entries).toContainEqual({
      name: SERVER_RUNTIME_BUILD_ENTRY_NAME,
      import: "@evjs/ev/_internal/server/fetch",
      environment: "server",
      runtime: "node",
      kind: "server-runtime",
      metadata: {
        type: "server-app",
        routes: [
          {
            id: "src/apis/health/api.ts:/health:GET",
            module: "src/apis/health/api.ts",
            path: "/health",
            methods: ["GET"],
          },
          {
            id: "src/apis/users/$userId/api.ts:/users/:userId:POST",
            module: "src/apis/users/$userId/api.ts",
            path: "/users/:userId",
            methods: ["POST"],
            moduleSegments: ["users", "$userId"],
            middlewares: [userMiddleware],
          },
        ],
        middlewares: [globalMiddleware],
      },
    });
    expect(plan.server.entry).toBe("@evjs/ev/_internal/server/fetch");
  });

  it("rejects server file routes that can match framework runtime endpoints", async () => {
    const cwd = await createFixture({
      "src/pages/rsc/page.tsx":
        "export default function Rsc() { return null; }",
      "src/pages/rsc/page.config.ts":
        'export default { render: "ssr", hydrate: "none", rsc: true };',
      "src/pages/ppr/page.tsx": `
        import * as React from "react";
        const Offer = React.lazy(() => import("./Offer.region"));
        export default function Ppr() {
          return <React.Suspense fallback={null}><Offer /></React.Suspense>;
        }
      `,
      "src/pages/ppr/Offer.region.tsx":
        "export default function Offer() { return null; }",
      "src/pages/ppr/page.config.ts": `
        export default {
          render: "ssr",
          hydrate: "none",
          prerender: { partial: true, delivery: "stream" },
        };
      `,
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "mpa", {
      rscEndpoint: "internal/flight",
    });
    const analysis = await createCoreGraph(config, cwd);
    expect(analysis.diagnostics).toEqual([]);

    const conflicts = [
      {
        module: "./src/apis/__evjs/fn/api.ts",
        path: "/__evjs/fn",
        reserved: 'server function endpoint "/__evjs/fn"',
      },
      {
        module: "./src/apis/__evjs/$endpoint/api.ts",
        path: "/__evjs/:endpoint",
        reserved: 'server function endpoint "/__evjs/fn"',
      },
      {
        module: "./src/apis/encoded-runtime/api.ts",
        path: "/%5F%5Fevjs/%66n",
        reserved: 'server function endpoint "/__evjs/fn"',
      },
      {
        module: "./src/apis/internal/flight/api.ts",
        path: "/internal/flight",
        reserved: 'RSC endpoint "/internal/flight"',
      },
      {
        module: "./src/apis/internal/$endpoint/api.ts",
        path: "/internal/:endpoint",
        reserved: 'RSC endpoint "/internal/flight"',
      },
      {
        module: "./src/apis/__evjs/ppr/api.ts",
        path: "/__evjs/ppr",
        reserved: 'PPR endpoint subtree rooted at "/__evjs/ppr"',
      },
      {
        module: "./src/apis/__evjs/ppr/region/api.ts",
        path: "/__evjs/ppr/region",
        reserved: 'PPR endpoint subtree rooted at "/__evjs/ppr"',
      },
      {
        module: "./src/apis/$scope/ppr/region/api.ts",
        path: "/:scope/ppr/region",
        reserved: 'PPR endpoint subtree rooted at "/__evjs/ppr"',
      },
    ];

    for (const conflict of conflicts) {
      const graph: CoreGraph = {
        ...analysis.graph,
        serverRoutes: [
          {
            id: `${conflict.module}:${conflict.path}:GET`,
            module: conflict.module,
            path: conflict.path,
            methods: ["GET"],
          },
        ],
      };
      expect(() => createBuildPlan(config, graph)).toThrow(
        `[evjs] Server file route module "${conflict.module}" with path "${conflict.path}" conflicts with the reserved framework ${conflict.reserved}.`,
      );
    }

    const adjacentGraph: CoreGraph = {
      ...analysis.graph,
      serverRoutes: [
        {
          id: "framework-parent",
          module: "./src/apis/__evjs/api.ts",
          path: "/__evjs",
          methods: ["GET"],
        },
        {
          id: "ppr-similar-prefix",
          module: "./src/apis/__evjs/pprish/$region/api.ts",
          path: "/__evjs/pprish/:region",
          methods: ["GET"],
        },
        {
          id: "rsc-descendant",
          module: "./src/apis/internal/flight/details/api.ts",
          path: "/internal/flight/details",
          methods: ["GET"],
        },
      ],
    };
    expect(() => createBuildPlan(config, adjacentGraph)).not.toThrow();
  });

  it("rejects intersecting client and server request Route patterns", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "src/pages/health/page.tsx":
        "export default function Health() { return null; }",
      "src/pages/users/$userId/page.tsx":
        "export default function User() { return null; }",
      "src/pages/users/admin/page.tsx":
        "export default function Admin() { return null; }",
      "src/pages/docs/$...splat/page.tsx":
        "export default function Docs() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);
    expect(analysis.diagnostics).toEqual([]);

    const conflicts = [
      { pageId: "index", pagePath: "/", serverPath: "/" },
      { pageId: "health", pagePath: "/health", serverPath: "/health" },
      {
        pageId: "users_userId",
        pagePath: "/users/$userId",
        serverPath: "/users/admin",
      },
      {
        pageId: "users_admin",
        pagePath: "/users/admin",
        serverPath: "/users/:userId",
      },
      {
        pageId: "users_userId",
        pagePath: "/users/$userId",
        serverPath: "/users/:accountId",
      },
      {
        pageId: "docs_splat",
        pagePath: "/docs/$",
        serverPath: "/docs",
      },
      {
        pageId: "docs_splat",
        pagePath: "/docs/$",
        serverPath: "/docs/reference/api",
      },
    ] as const;

    for (const conflict of conflicts) {
      const pageRoute = analysis.graph.routes.find(
        (route) =>
          route.target.kind === "page" &&
          route.target.pageId === conflict.pageId,
      );
      if (!pageRoute) {
        throw new Error(`Expected a Route for Page "${conflict.pageId}".`);
      }
      const serverRoute = {
        id: `server:${conflict.serverPath}`,
        module: `./src/apis${conflict.serverPath}/api.ts`,
        path: conflict.serverPath,
        methods: ["GET"],
      };
      const graph: CoreGraph = {
        ...analysis.graph,
        routes: [pageRoute],
        serverRoutes: [serverRoute],
      };

      expect(() => createBuildPlan(config, graph)).toThrow(
        `[evjs] Page Route "${pageRoute.id}" targeting Page "${conflict.pageId}" with path "${conflict.pagePath}" conflicts with server request Route module "${serverRoute.module}" with path "${conflict.serverPath}". Client and server request Route patterns must be disjoint because server request Routes take precedence at runtime.`,
      );
    }

    const healthRoute = analysis.graph.routes.find(
      (route) =>
        route.target.kind === "page" && route.target.pageId === "health",
    );
    if (!healthRoute) throw new Error('Expected a Route for Page "health".');
    const encodedHealthRoute: CoreGraph["routes"][number] = {
      ...healthRoute,
      pattern: {
        segments: [{ kind: "static", value: "%68ealth" }],
      },
    };
    const encodedAliasConflicts = [
      {
        route: encodedHealthRoute,
        clientPath: "/%68ealth",
        serverPath: "/health",
      },
      {
        route: healthRoute,
        clientPath: "/health",
        serverPath: "/%68ealth",
      },
    ];
    for (const conflict of encodedAliasConflicts) {
      const serverRoute = {
        id: `encoded:${conflict.serverPath}`,
        module: "./src/apis/encoded-health/api.ts",
        path: conflict.serverPath,
        methods: ["GET"],
      };
      expect(() =>
        createBuildPlan(config, {
          ...analysis.graph,
          routes: [conflict.route],
          serverRoutes: [serverRoute],
        }),
      ).toThrow(
        `[evjs] Page Route "${conflict.route.id}" targeting Page "health" with path "${conflict.clientPath}" conflicts with server request Route module "${serverRoute.module}" with path "${conflict.serverPath}". Client and server request Route patterns must be disjoint because server request Routes take precedence at runtime.`,
      );
    }

    const redirectRoute: CoreGraph["routes"][number] = {
      ...healthRoute,
      id: "legacy-health",
      pattern: {
        segments: [
          { kind: "static", value: "legacy" },
          { kind: "param", name: "slug" },
        ],
      },
      target: { kind: "redirect", to: { kind: "url", href: "/health" } },
    };
    const redirectServerRoute = {
      id: "legacy-current",
      module: "./src/apis/legacy/current/api.ts",
      path: "/legacy/current",
      methods: ["GET"],
    };
    expect(() =>
      createBuildPlan(config, {
        ...analysis.graph,
        routes: [redirectRoute],
        serverRoutes: [redirectServerRoute],
      }),
    ).toThrow(
      `[evjs] Redirect Route "legacy-health" with path "/legacy/$slug" conflicts with server request Route module "${redirectServerRoute.module}" with path "/legacy/current". Client and server request Route patterns must be disjoint because server request Routes take precedence at runtime.`,
    );

    const adjacentGraph: CoreGraph = {
      ...analysis.graph,
      serverRoutes: [
        {
          id: "healthy",
          module: "./src/apis/healthy/api.ts",
          path: "/healthy",
          methods: ["GET"],
        },
        {
          id: "users-root",
          module: "./src/apis/users/api.ts",
          path: "/users",
          methods: ["GET"],
        },
        {
          id: "users-descendant",
          module: "./src/apis/users/$userId/details/api.ts",
          path: "/users/:userId/details",
          methods: ["GET"],
        },
        {
          id: "document",
          module: "./src/apis/document/$slug/api.ts",
          path: "/document/:slug",
          methods: ["GET"],
        },
        {
          id: "layout-only",
          module: "./src/apis/layout-only/api.ts",
          path: "/layout-only",
          methods: ["GET"],
        },
      ],
      routes: [
        ...analysis.graph.routes,
        {
          ...healthRoute,
          id: "layout-only",
          pattern: {
            segments: [{ kind: "static", value: "layout-only" }],
          },
          target: { kind: "group" },
        },
      ],
    };
    expect(() => createBuildPlan(config, adjacentGraph)).not.toThrow();
  });

  it("rejects overlapping active framework runtime endpoints", async () => {
    const cwd = await createFixture({
      "src/pages/rsc/page.tsx":
        "export default function Rsc() { return null; }",
      "src/pages/rsc/page.config.ts":
        'export default { render: "ssr", hydrate: "none", rsc: true };',
      "src/pages/ppr/page.tsx": `
        import * as React from "react";
        const Offer = React.lazy(() => import("./Offer.region"));
        export default function Ppr() {
          return <React.Suspense fallback={null}><Offer /></React.Suspense>;
        }
      `,
      "src/pages/ppr/Offer.region.tsx":
        "export default function Offer() { return null; }",
      "src/pages/ppr/page.config.ts": `
        export default {
          render: "ssr",
          hydrate: "none",
          prerender: { partial: true, delivery: "stream" },
        };
      `,
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "mpa", {
      rscEndpoint: "internal/flight",
    });
    const analysis = await createCoreGraph(config, cwd);
    expect(analysis.diagnostics).toEqual([]);

    const conflicts = [
      {
        runtime: { rsc: "__evjs/fn" },
        message:
          '[evjs] Framework runtime server function endpoint "/__evjs/fn" conflicts with the RSC endpoint "/__evjs/fn". Active framework runtime endpoints must not match the same request path.',
      },
      {
        runtime: { rsc: "__evjs/ppr/flight" },
        message:
          '[evjs] Framework runtime RSC endpoint "/__evjs/ppr/flight" conflicts with the reserved framework PPR endpoint subtree rooted at "/__evjs/ppr". Active exact endpoints must stay outside the PPR subtree.',
      },
      {
        runtime: { fn: "__evjs/ppr/action" },
        message:
          '[evjs] Framework runtime server function endpoint "/__evjs/ppr/action" conflicts with the reserved framework PPR endpoint subtree rooted at "/__evjs/ppr". Active exact endpoints must stay outside the PPR subtree.',
      },
      {
        runtime: { ppr: "internal/flight" },
        message:
          '[evjs] Framework runtime RSC endpoint "/internal/flight" conflicts with the reserved framework PPR endpoint subtree rooted at "/internal/flight". Active exact endpoints must stay outside the PPR subtree.',
      },
    ];

    for (const conflict of conflicts) {
      const conflictConfig: TestConfig = {
        ...config,
        server: {
          ...config.server,
          runtime: { ...config.server.runtime, ...conflict.runtime },
        },
      };
      expect(() => createBuildPlan(conflictConfig, analysis.graph)).toThrow(
        conflict.message,
      );
    }

    expect(() => createBuildPlan(config, analysis.graph)).not.toThrow();
  });

  it("rejects server-rendered Page routes that can match framework runtime endpoints", async () => {
    const cwd = await createFixture({
      "src/pages/rsc/page.tsx":
        "export default function Rsc() { return null; }",
      "src/pages/rsc/page.config.ts":
        'export default { render: "ssr", hydrate: "none", rsc: true };',
      "src/pages/ppr/page.tsx": `
        import * as React from "react";
        const Offer = React.lazy(() => import("./Offer.region"));
        export default function Ppr() {
          return <React.Suspense fallback={null}><Offer /></React.Suspense>;
        }
      `,
      "src/pages/ppr/Offer.region.tsx":
        "export default function Offer() { return null; }",
      "src/pages/ppr/page.config.ts": `
        export default {
          render: "ssr",
          hydrate: "none",
          prerender: { partial: true, delivery: "stream" },
        };
      `,
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "mpa", {
      rscEndpoint: "internal/flight",
    });
    const analysis = await createCoreGraph(config, cwd);
    expect(analysis.diagnostics).toEqual([]);

    const conflicts: Array<{
      pageId: string;
      path: string;
      segments: CoreGraph["routes"][number]["pattern"]["segments"];
      reserved: string;
    }> = [
      {
        pageId: "rsc",
        path: "/__evjs/fn",
        segments: [
          { kind: "static", value: "__evjs" },
          { kind: "static", value: "fn" },
        ],
        reserved: 'server function endpoint "/__evjs/fn"',
      },
      {
        pageId: "rsc",
        path: "/internal/flight",
        segments: [
          { kind: "static", value: "internal" },
          { kind: "static", value: "flight" },
        ],
        reserved: 'RSC endpoint "/internal/flight"',
      },
      {
        pageId: "ppr",
        path: "/__evjs/ppr/region",
        segments: [
          { kind: "static", value: "__evjs" },
          { kind: "static", value: "ppr" },
          { kind: "static", value: "region" },
        ],
        reserved: 'PPR endpoint subtree rooted at "/__evjs/ppr"',
      },
      {
        pageId: "rsc",
        path: "/__evjs/$endpoint",
        segments: [
          { kind: "static", value: "__evjs" },
          { kind: "param", name: "endpoint" },
        ],
        reserved: 'server function endpoint "/__evjs/fn"',
      },
    ];

    for (const conflict of conflicts) {
      const sourceRoute = analysis.graph.routes.find(
        (route) =>
          route.target.kind === "page" &&
          route.target.pageId === conflict.pageId,
      );
      if (!sourceRoute) {
        throw new Error(`Expected a Route for Page "${conflict.pageId}".`);
      }
      const graph = replacePageRoutePattern(
        analysis.graph,
        conflict.pageId,
        conflict.segments,
      );
      expect(() => createBuildPlan(config, graph)).toThrow(
        `[evjs] Page Route "${sourceRoute.id}" targeting Page "${conflict.pageId}" with path "${conflict.path}" conflicts with the reserved framework ${conflict.reserved}.`,
      );
    }

    const adjacentGraph = replacePageRoutePattern(
      replacePageRoutePattern(analysis.graph, "rsc", [
        { kind: "static", value: "internal" },
        { kind: "static", value: "flight" },
        { kind: "static", value: "details" },
      ]),
      "ppr",
      [
        { kind: "static", value: "__evjs" },
        { kind: "static", value: "pprish" },
        { kind: "static", value: "region" },
      ],
    );
    expect(() => createBuildPlan(config, adjacentGraph)).not.toThrow();
  });

  it("reserves only active runtime endpoints for URL-owning client routes", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa", {
      rscEndpoint: "internal/flight",
    });
    const analysis = await createCoreGraph(config, cwd);

    const functionEndpointGraph = replacePageRoutePattern(
      analysis.graph,
      "index",
      [
        { kind: "static", value: "__evjs" },
        { kind: "static", value: "fn" },
      ],
    );
    const sourceRoute = analysis.graph.routes.find(
      (route) =>
        route.target.kind === "page" && route.target.pageId === "index",
    );
    if (!sourceRoute) throw new Error('Expected a Route for Page "index".');
    expect(() => createBuildPlan(config, functionEndpointGraph)).toThrow(
      `[evjs] Page Route "${sourceRoute.id}" targeting Page "index" with path "/__evjs/fn" conflicts with the reserved framework server function endpoint "/__evjs/fn".`,
    );

    const redirectEndpointGraph: CoreGraph = {
      ...functionEndpointGraph,
      routes: functionEndpointGraph.routes.map((route) =>
        route.target.kind === "page" && route.target.pageId === "index"
          ? {
              ...route,
              target: {
                kind: "redirect" as const,
                to: { kind: "url" as const, href: "/" },
              },
            }
          : route,
      ),
    };
    expect(() => createBuildPlan(config, redirectEndpointGraph)).toThrow(
      `[evjs] Redirect Route "${sourceRoute.id}" with path "/__evjs/fn" conflicts with the reserved framework server function endpoint "/__evjs/fn".`,
    );

    const encodedEndpointGraph = replacePageRoutePattern(
      analysis.graph,
      "index",
      [
        { kind: "static", value: "%5F%5Fevjs" },
        { kind: "static", value: "%66n" },
      ],
    );
    expect(() => createBuildPlan(config, encodedEndpointGraph)).toThrow(
      `[evjs] Page Route "${sourceRoute.id}" targeting Page "index" with path "/%5F%5Fevjs/%66n" conflicts with the reserved framework server function endpoint "/__evjs/fn".`,
    );

    const groupEndpointGraph: CoreGraph = {
      ...functionEndpointGraph,
      routes: functionEndpointGraph.routes.map((route) =>
        route.target.kind === "page" && route.target.pageId === "index"
          ? { ...route, target: { kind: "group" as const } }
          : route,
      ),
    };
    expect(() => createBuildPlan(config, groupEndpointGraph)).not.toThrow();

    const inactiveEndpointPatterns: CoreGraph["routes"][number]["pattern"]["segments"][] =
      [
        [
          { kind: "static", value: "internal" },
          { kind: "static", value: "flight" },
        ],
        [
          { kind: "static", value: "__evjs" },
          { kind: "static", value: "ppr" },
          { kind: "static", value: "region" },
        ],
      ];

    for (const segments of inactiveEndpointPatterns) {
      const graph = replacePageRoutePattern(analysis.graph, "index", segments);
      expect(() => createBuildPlan(config, graph)).not.toThrow();
    }
  });

  it("does not reserve inactive RSC and PPR runtime endpoints", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa", {
      rscEndpoint: "internal/flight",
    });
    const analysis = await createCoreGraph(config, cwd);
    const graph: CoreGraph = {
      ...analysis.graph,
      serverRoutes: [
        {
          id: "rsc-placeholder",
          module: "./src/apis/internal/$endpoint/api.ts",
          path: "/internal/:endpoint",
          methods: ["GET"],
        },
        {
          id: "ppr-placeholder",
          module: "./src/apis/__evjs/ppr/$region/api.ts",
          path: "/__evjs/ppr/:region",
          methods: ["GET"],
        },
      ],
    };

    const plan = createBuildPlan(config, graph);
    expect(plan.runtime.server).toEqual({
      basePath: "/__evjs",
      fn: "__evjs/fn",
    });
  });

  it("diffs canonical MPA Page and Document additions", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const previousConfig = await createCanonicalConfig(cwd, "mpa");
    const previousAnalysis = await createCoreGraph(previousConfig, cwd);
    const previousPlan = createBuildPlan(
      previousConfig,
      previousAnalysis.graph,
      { mode: "development" },
    );

    await fs.mkdir(path.join(cwd, "src/pages/orders"), { recursive: true });
    await fs.writeFile(
      path.join(cwd, "src/pages/orders/page.tsx"),
      "export default function Orders() { return null; }",
      "utf-8",
    );

    const nextConfig = await createCanonicalConfig(cwd, "mpa");
    const nextAnalysis = await createCoreGraph(nextConfig, cwd);
    const nextPlan = createBuildPlan(nextConfig, nextAnalysis.graph, {
      mode: "development",
    });
    const update = diffBuildPlan(previousPlan, nextPlan, "route-declaration");

    expect(update.entries.added).toEqual([
      expect.objectContaining({
        name: createPageClientBuildEntryName("orders"),
        import: "./src/pages/orders/page.tsx",
        kind: "page-client",
        owner: { appId: "default", pageId: "orders" },
      }),
    ]);
    expect(update.entries.removed).toEqual([]);
    expect(update.html.added).toEqual([
      {
        id: "orders",
        template: "./index.html",
        fileName: "orders.html",
        owner: { appId: "default", pageId: "orders" },
      },
    ]);
    expect(update.serverCompilationChanged).toBe(false);
    expect(update.serverDocumentsChanged).toBe(false);
    expect(update.devRoutingChanged).toBe(true);
  });

  it("reports runtime and config-delivery changes explicitly", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);
    const previous = createBuildPlan(config, analysis.graph);
    const next = {
      ...previous,
      runtime: {
        ...previous.runtime,
        transport: { baseUrl: "https://example.test/api" },
      },
    };

    const runtimeUpdate = diffBuildPlan(previous, next, "route-declaration");
    expect(runtimeUpdate.runtimeChanged).toBe(true);
    expect(runtimeUpdate.deliveryChanged).toBe(false);
    expect(runtimeUpdate.serverCompilationChanged).toBe(false);
    expect(runtimeUpdate.serverDocumentsChanged).toBe(false);
    expect(runtimeUpdate.devRoutingChanged).toBe(false);

    const configUpdate = diffBuildPlan(previous, previous, "config");
    expect(configUpdate.runtimeChanged).toBe(false);
    expect(configUpdate.deliveryChanged).toBe(true);
  });

  it("refreshes MPA SSR fallback and server Documents without recompiling", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "src/pages/page.config.ts": 'export default { render: "ssr" };',
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "mpa");
    const analysis = await createCoreGraph(config, cwd);
    const previous = createBuildPlan(config, analysis.graph);
    const nextGraph = structuredClone(analysis.graph);
    const page = nextGraph.pages.index;
    if (!page) throw new Error("Expected index Page.");
    page.metadata = {
      title: "Updated home",
      meta: { description: "Updated description" },
    };
    const next = createBuildPlan(config, nextGraph);

    const update = diffBuildPlan(previous, next, "route-declaration");

    expect(update.entries).toEqual({ added: [], removed: [], changed: [] });
    expect(update.html).toEqual({
      added: [],
      removed: [],
      changed: [
        {
          id: "index",
          template: "./index.html",
          fileName: "index.html",
          owner: { appId: "default", pageId: "index" },
          metadata: {
            title: "Updated home",
            meta: { description: "Updated description" },
          },
        },
      ],
    });
    expect(update.serverCompilationChanged).toBe(false);
    expect(update.serverDocumentsChanged).toBe(true);
    expect(update.devRoutingChanged).toBe(false);
    expect(update.runtimeChanged).toBe(false);
  });

  it("derives the RSC endpoint only for RSC Pages and honors a resolved override", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "index.html": '<main id="app"></main>',
    });
    const csrConfig = await createCanonicalConfig(cwd, "spa");
    const csrAnalysis = await createCoreGraph(csrConfig, cwd);
    const csrPlan = createBuildPlan(csrConfig, csrAnalysis.graph);

    expect(csrPlan.runtime.server?.rsc).toBeUndefined();

    await fs.writeFile(
      path.join(cwd, "src/pages/page.config.ts"),
      'export default { render: "ssr", hydrate: "none", rsc: true };',
      "utf-8",
    );
    const rscConfig = await createCanonicalConfig(cwd, "spa", {
      rscEndpoint: "internal/flight",
    });
    const rscAnalysis = await createCoreGraph(rscConfig, cwd);
    const rscPlan = createBuildPlan(rscConfig, rscAnalysis.graph);

    expect(rscPlan.runtime.server?.rsc).toBe("internal/flight");
  });
});

type TestConfig = BuildPlanConfig & GraphConfig;

interface CanonicalConfigOptions {
  rscEndpoint?: string;
  serverRoutes?: NonNullable<GraphConfig["server"]["routes"]>;
  serverConventions?: NonNullable<GraphConfig["server"]["conventions"]>;
}

async function createCanonicalConfig(
  cwd: string,
  mode: "spa" | "mpa",
  options: CanonicalConfigOptions = {},
): Promise<TestConfig> {
  const discovery = await discoverPageRoutes(cwd, {
    mode,
    required: true,
  });
  expect(discovery.diagnostics).toEqual([]);

  return {
    routing: {
      mode,
      html: "./index.html",
      mount: "#app",
      routes: discovery.routes,
      ...(discovery.rootModule ? { rootModule: discovery.rootModule } : {}),
      ...(discovery.metadata ? { metadata: discovery.metadata } : {}),
      dependencies: discovery.dependencies,
    },
    output: {
      client: "dist/client",
      server: "dist/server",
    },
    server: {
      basePath: "/__evjs",
      runtime: {
        fn: "__evjs/fn",
        ppr: "__evjs/ppr",
        ...(options.rscEndpoint ? { rsc: options.rscEndpoint } : {}),
      },
      ...(options.serverRoutes ? { routes: options.serverRoutes } : {}),
      ...(options.serverConventions
        ? { conventions: options.serverConventions }
        : {}),
    },
  };
}

async function createFixture(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-graph-plan-"));
  tempDirs.push(dir);

  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(dir, file);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, "utf-8");
  }

  return dir;
}

function clientRouteProjection(graph: CoreGraph) {
  return graph.routes.map((route) => ({
    id: route.id,
    parentId: route.parentId,
    path: formatGraphRoutePath(route),
    target: route.target,
    facets: route.facets,
  }));
}

function formatGraphRoutePath(route: CoreGraph["routes"][number]): string {
  if (route.pattern.segments.length === 0) return "/";
  return `/${route.pattern.segments
    .map((segment) => {
      if (segment.kind === "static") return segment.value;
      if (segment.kind === "param") return `$${segment.name}`;
      return "$";
    })
    .join("/")}`;
}

function replacePageRoutePattern(
  graph: CoreGraph,
  pageId: string,
  segments: CoreGraph["routes"][number]["pattern"]["segments"],
): CoreGraph {
  let replaced = false;
  const routes = graph.routes.map((route) => {
    if (route.target.kind !== "page" || route.target.pageId !== pageId) {
      return route;
    }
    replaced = true;
    return { ...route, pattern: { segments } };
  });
  if (!replaced) throw new Error(`Expected a Route for Page "${pageId}".`);
  return { ...graph, routes };
}

function getSinglePprRegionId(
  regions: Record<string, unknown> | undefined,
): string {
  const ids = Object.keys(regions ?? {});
  expect(ids).toHaveLength(1);
  const [id] = ids;
  expect(id).toMatch(/^region_[0-9a-f]{12}$/);
  return id as string;
}
