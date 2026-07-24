import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type CoreGraph,
  linkBuildOutput,
  PAGE_ANCHOR_PROVIDER_ID,
} from "@evjs/shared/manifest";
import { afterEach, describe, expect, it } from "vitest";
import {
  GENERATED_PAGES_APP_BUILD_ENTRY,
  SERVER_RUNTIME_BUILD_ENTRY_NAME,
} from "../src/_internal/build/build-entry-conventions.js";
import { PAGE_ANCHOR_ROOT_LAYOUT_ROUTE_ID } from "../src/_internal/build/graph/core.js";
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
      topology: "spa",
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
    expect(routes.get(PAGE_ANCHOR_ROOT_LAYOUT_ROUTE_ID)).toMatchObject({
      realm: "client",
      pattern: { segments: [] },
      target: { kind: "group" },
      facets: { layout: "./src/pages/layout.tsx", wrappers: [] },
    });
    expect(routes.get("users")).toMatchObject({
      parentId: PAGE_ANCHOR_ROOT_LAYOUT_ROUTE_ID,
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
    expect(clientRouteProjection(mpa.graph)).toEqual(
      clientRouteProjection(spa.graph),
    );
    expect(spa.graph.applications.default).toMatchObject({
      topology: "spa",
      pageIds: ["index", "about"],
      documentIds: ["index"],
    });
    expect(mpa.graph.applications.default).toMatchObject({
      topology: "mpa",
      pageIds: ["index", "about"],
      documentIds: ["index", "about"],
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
        output: "about/index.html",
        owner: { kind: "page", pageId: "about" },
        bootstrap: { kind: "page", pageId: "about" },
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
          layouts:
            entry.metadata?.type === "react-component-page"
              ? entry.metadata.layouts
              : undefined,
        })),
    ).toEqual([
      {
        name: "index",
        owner: { appId: "default", pageId: "index" },
        layouts: ["./src/pages/layout.tsx"],
      },
      {
        name: "about",
        owner: { appId: "default", pageId: "about" },
        layouts: ["./src/pages/layout.tsx"],
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
        fileName: "about/index.html",
        owner: { appId: "default", pageId: "about" },
        metadata: {
          title: "About",
          meta: {
            description: "About this application",
            Robots: "index,follow",
          },
        },
      },
    ]);

    const output = linkBuildOutput({
      graph: mpa.graph,
      plan: mpaPlan,
      clientEntryAssets: {
        index: { js: ["index.js"], css: [] },
        about: { js: ["about.js"], css: ["about.css"] },
      },
    });
    expect(output.apps).toEqual({});
    expect(output.routes).toEqual([
      { id: "index", path: "/", pageId: "index" },
      { id: "about", path: "/about", pageId: "about" },
    ]);
    expect(output.pages.about.document).toEqual({
      fileName: "about/index.html",
    });
    expect(output.pages.about.metadata).toEqual({
      title: "About",
      meta: {
        description: "About this application",
        Robots: "index,follow",
      },
    });
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
      "src/pages/ssr/page.tsx":
        "export default function Ssr() { return null; }",
      "src/pages/ssr/page.config.ts":
        'export default { render: "ssr", hydrate: "visible" };',
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
      ssr: { render: "ssr", hydrate: "visible" },
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
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ssr",
          kind: "page-client",
          owner: { appId: "default", pageId: "ssr" },
        }),
        {
          name: "ssr-server",
          import: "./src/pages/ssr/page.tsx",
          environment: "server",
          runtime: "node",
          kind: "page-server",
          owner: { pageId: "ssr", routeId: "ssr" },
        },
        {
          name: "ssg-server",
          import: "./src/pages/ssg/page.tsx",
          environment: "server",
          runtime: "node",
          kind: "page-server",
          phase: "build",
          owner: { pageId: "ssg", routeId: "ssg" },
        },
        {
          name: "rsc-rsc",
          import: "./src/pages/rsc/page.tsx",
          environment: "server",
          runtime: "node",
          kind: "rsc-page",
          owner: { pageId: "rsc", routeId: "rsc" },
        },
        {
          name: "ppr-ppr-shell",
          import: "./src/pages/ppr/page.tsx",
          environment: "server",
          runtime: "node",
          kind: "ppr-shell",
          owner: { pageId: "ppr", routeId: "ppr" },
        },
        {
          name: `ppr-${pprRegionId}-ppr-region`,
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
    expect(plan.server.renderers?.map((renderer) => renderer.kind)).toEqual(
      expect.arrayContaining([
        "page-server",
        "rsc-page",
        "ppr-shell",
        "ppr-region",
      ]),
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

  it("diagnoses removed rendering exports without consuming them", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": `
        export const render = "ssr";
        export const hydrate = "none";
        export const prerender = true;
        export const rsc = true;
        export default function Home() { return null; }
      `,
      "index.html": '<main id="app"></main>',
    });
    const config = await createCanonicalConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);

    expect(analysis.graph.pages.index).toMatchObject({
      render: "csr",
      source: { module: "./src/pages/page.tsx" },
    });
    expect(analysis.graph.pages.index).not.toHaveProperty("hydrate");
    expect(analysis.graph.pages.index).not.toHaveProperty("prerender");
    expect(analysis.graph.pages.index).not.toHaveProperty("componentModel");
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/pages/page.tsx",
      message:
        'Page "index" declares render, hydrate, prerender, or rsc from its component module. Component rendering exports have been removed; move these fields to the adjacent page.config.ts module.',
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

  it("publishes only configured server file routes and middleware", async () => {
    const globalMiddleware = {
      id: "src/middleware.ts:global-middleware",
      module: "src/middleware.ts",
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
      "src/apis/health.ts":
        "export const GET = async () => Response.json({ ok: true });",
      "src/apis/users/$userId.ts":
        "export const POST = async () => Response.json({ ok: true });",
      "src/middleware.ts":
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
      serverRouting: {
        dir: "./src/apis",
        routes: [
          {
            id: "src/apis/health.ts:/health:GET",
            module: "src/apis/health.ts",
            path: "/health",
            methods: ["GET"],
          },
          {
            id: "src/apis/users/$userId.ts:/users/:userId:POST",
            module: "src/apis/users/$userId.ts",
            path: "/users/:userId",
            methods: ["POST"],
            moduleSegments: ["users"],
            middlewares: [userMiddleware],
          },
        ],
      },
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
        id: "src/apis/health.ts:/health:GET",
        module: "src/apis/health.ts",
        path: "/health",
        methods: ["GET"],
      },
      {
        id: "src/apis/users/$userId.ts:/users/:userId:POST",
        module: "src/apis/users/$userId.ts",
        path: "/users/:userId",
        methods: ["POST"],
      },
    ]);
    expect(analysis.graph.serverRoutes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/ignored" })]),
    );
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
            id: "src/apis/health.ts:/health:GET",
            module: "src/apis/health.ts",
            path: "/health",
            methods: ["GET"],
          },
          {
            id: "src/apis/users/$userId.ts:/users/:userId:POST",
            module: "src/apis/users/$userId.ts",
            path: "/users/:userId",
            methods: ["POST"],
            moduleSegments: ["users"],
            middlewares: [userMiddleware],
          },
        ],
        middlewares: [globalMiddleware],
      },
    });
    expect(plan.server.entry).toBe("@evjs/ev/_internal/server/fetch");
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
        name: "orders",
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
        fileName: "orders/index.html",
        owner: { appId: "default", pageId: "orders" },
      },
    ]);
    expect(update.serverChanged).toBe(true);
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
  serverRouting?: NonNullable<GraphConfig["server"]["routing"]>;
  serverConventions?: NonNullable<GraphConfig["server"]["conventions"]>;
}

async function createCanonicalConfig(
  cwd: string,
  mode: "spa" | "mpa",
  options: CanonicalConfigOptions = {},
): Promise<TestConfig> {
  const discovery = await discoverPageRoutes(cwd, {
    dir: "./src/pages",
    mode,
    required: true,
  });
  expect(discovery.diagnostics).toEqual([]);

  return {
    routing: {
      mode,
      dir: "./src/pages",
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
      ...(options.serverRouting ? { routing: options.serverRouting } : {}),
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
  return graph.routes
    .filter((route) => route.realm === "client")
    .map((route) => ({
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

function getSinglePprRegionId(
  regions: Record<string, unknown> | undefined,
): string {
  const ids = Object.keys(regions ?? {});
  expect(ids).toHaveLength(1);
  const [id] = ids;
  expect(id).toMatch(/^region_[0-9a-f]{12}$/);
  return id as string;
}
