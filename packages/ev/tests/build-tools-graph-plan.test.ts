import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { linkBuildOutput } from "@evjs/shared/manifest";
import { afterEach, describe, expect, it } from "vitest";
import type { BuildPlanConfig, GraphConfig } from "../src/build-tools/index.js";
import {
  createAppGraph,
  createBuildPlan,
  diffBuildPlan,
  hashServerFunction,
} from "../src/build-tools/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("createAppGraph and createBuildPlan", () => {
  it("creates one app client entry for a top-level entry config", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig();
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.apps).toEqual({
      default: {
        id: "default",
        entry: "./src/main.tsx",
        html: "./index.html",
      },
    });
    expect(analysis.graph.pages).toEqual({});
    expect(plan.entries).toContainEqual({
      name: "main",
      import: "./src/main.tsx",
      environment: "client",
      runtime: "browser",
      kind: "app-client",
      owner: { appId: "default" },
    });
    expect(plan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { appId: "default" },
      },
    ]);
  });

  it("creates one page client entry per configured page", async () => {
    const cwd = await createFixture({
      "src/pages/home/main.tsx": "console.log('home');",
      "src/pages/about/main.tsx": "console.log('about');",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        home: {
          entry: "./src/pages/home/main.tsx",
          html: "./index.html",
        },
        about: {
          entry: "./src/pages/about/main.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.apps).toEqual({});
    expect(Object.keys(analysis.graph.pages)).toEqual(["home", "about"]);
    expect(
      plan.entries.filter((entry) => entry.kind === "page-client"),
    ).toEqual([
      {
        name: "home",
        import: "./src/pages/home/main.tsx",
        environment: "client",
        runtime: "browser",
        kind: "page-client",
        owner: { pageId: "home" },
      },
      {
        name: "about",
        import: "./src/pages/about/main.tsx",
        environment: "client",
        runtime: "browser",
        kind: "page-client",
        owner: { pageId: "about" },
      },
    ]);
    expect(plan.html).toEqual([
      {
        id: "home",
        template: "./index.html",
        fileName: "home.html",
        owner: { pageId: "home" },
      },
      {
        id: "about",
        template: "./index.html",
        fileName: "about.html",
        owner: { pageId: "about" },
      },
    ]);
  });

  it("adds the server runtime entry when server is enabled", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
    });
    const config = createConfig({
      server: {
        entry: "./src/server.ts",
        basePath: "/__evjs",
        functionRuntime: {
          endpoint: "/__evjs/fn",
          clientProxy: "client-proxy",
          serverRegister: "server-register",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(plan.server).toEqual({
      enabled: true,
      entry: "./src/server.ts",
      functionRuntime: {
        endpoint: "/__evjs/fn",
        clientProxy: "client-proxy",
        serverRegister: "server-register",
      },
    });
    expect(plan.entries).toContainEqual({
      name: "server",
      import: "./src/server.ts",
      environment: "server",
      runtime: "node",
      kind: "server-runtime",
    });
  });

  it("carries the RSC endpoint into the runtime plan", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
    });
    const config = createConfig({
      server: {
        entry: undefined,
        basePath: "/__evjs",
        runtime: {
          rsc: "/__evjs/rsc",
        },
        functionRuntime: {
          endpoint: "/__evjs/fn",
          clientProxy: "@evjs/client",
          serverRegister: "@evjs/server/register",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph);

    expect(plan.runtime.server).toEqual({
      basePath: "/__evjs",
      fn: "/__evjs/fn",
      rsc: "/__evjs/rsc",
    });
  });

  it("uses the real component file with runtime entry metadata", async () => {
    const cwd = await createFixture({
      "src/pages/home.tsx": "export default function Home() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      serverEnabled: false,
      pages: {
        home: {
          component: "./src/pages/home.tsx",
          html: "./index.html",
          render: "csr",
          mount: "#root",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });
    const entry = plan.entries.find((entry) => entry.name === "home");
    if (!entry) throw new Error("Expected home entry");

    expect(entry.import).toBe("./src/pages/home.tsx");
    expect(plan.entries).toContainEqual({
      name: "home",
      import: "./src/pages/home.tsx",
      environment: "client",
      runtime: "browser",
      kind: "page-client",
      owner: { pageId: "home" },
      metadata: {
        type: "react-component-page",
        component: "./src/pages/home.tsx",
        mount: "#root",
        hydrate: "load",
        render: "csr",
      },
    });
    await expect(fs.access(path.join(cwd, ".evjs"))).rejects.toThrow();
  });

  it("does not create a client runtime entry for static non-hydrated component pages", async () => {
    const cwd = await createFixture({
      "src/pages/pricing.tsx":
        "export default function Pricing() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        pricing: {
          component: "./src/pages/pricing.tsx",
          html: "./index.html",
          render: "ssg",
          hydrate: "none",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });
    expect(plan.server.entry).toBe("@evjs/server/fetch");
    expect(plan.server.renderers).toEqual([
      {
        name: "pricing-server",
        import: "./src/pages/pricing.tsx",
        kind: "page-server",
        owner: { pageId: "pricing" },
      },
    ]);
    expect(
      plan.entries.filter((entry) => entry.kind === "page-client"),
    ).toEqual([]);
    expect(plan.entries).toContainEqual({
      name: "pricing-server",
      import: "./src/pages/pricing.tsx",
      environment: "server",
      runtime: "node",
      kind: "page-server",
      owner: { pageId: "pricing" },
    });
    await expect(fs.access(path.join(cwd, ".evjs"))).rejects.toThrow();
  });

  it("plans PPR shell and region entries from explicit page regions", async () => {
    const cwd = await createFixture({
      "src/campaign/Page.tsx":
        "export default function Page() { return null; }",
      "src/campaign/Offer.region.tsx":
        "export default function Offer() { return null; }",
      "src/campaign/OfferSkeleton.tsx":
        "export default function OfferSkeleton() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
          render: "ppr",
          ppr: {
            regions: {
              offer: {
                component: "./src/campaign/Offer.region.tsx",
                fallback: "./src/campaign/OfferSkeleton.tsx",
                cache: "no-store",
                hydrate: "visible",
              },
            },
          },
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(analysis.graph.pages.campaign.ppr).toEqual({
      regions: {
        offer: {
          component: "./src/campaign/Offer.region.tsx",
          fallback: "./src/campaign/OfferSkeleton.tsx",
          cache: "no-store",
          hydrate: "visible",
        },
      },
    });
    expect(plan.entries).toContainEqual({
      name: "server",
      import: "@evjs/server/fetch",
      environment: "server",
      runtime: "node",
      kind: "server-runtime",
    });
    expect(plan.runtime.server?.ppr).toBe("/__evjs/ppr");
    expect(plan.entries).not.toContainEqual(
      expect.objectContaining({
        name: "campaign",
        kind: "page-client",
      }),
    );
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        {
          name: "campaign-ppr-shell",
          import: "./src/campaign/Page.tsx",
          environment: "server",
          runtime: "node",
          kind: "ppr-shell",
          owner: { pageId: "campaign" },
        },
        {
          name: "campaign-offer-ppr-region",
          import: "./src/campaign/Offer.region.tsx",
          environment: "server",
          runtime: "node",
          kind: "ppr-region",
          owner: { pageId: "campaign", regionId: "offer" },
        },
      ]),
    );
    expect(plan.server.renderers).toEqual([
      {
        name: "campaign-ppr-shell",
        import: "./src/campaign/Page.tsx",
        kind: "ppr-shell",
        owner: { pageId: "campaign" },
      },
      {
        name: "campaign-offer-ppr-region",
        import: "./src/campaign/Offer.region.tsx",
        kind: "ppr-region",
        owner: { pageId: "campaign", regionId: "offer" },
      },
    ]);
    expect(
      analysis.fileDependencies.map((file) => path.relative(cwd, file)),
    ).toEqual(["src/campaign/Page.tsx"]);
  });

  it("plans PPR regions from Suspense lazy boundaries in the page component tree", async () => {
    const cwd = await createFixture({
      "src/campaign/Page.tsx": `
        import CampaignSections from "./CampaignSections";

        export default function Page() {
          return <CampaignSections />;
        }
      `,
      "src/campaign/CampaignSections.tsx": `
        import * as React from "react";

        const OfferRegion = React.lazy(() => import("./Offer.region"));

        export default function CampaignSections() {
          return (
            <React.Suspense fallback={<p>Loading offer</p>}>
              <OfferRegion />
            </React.Suspense>
          );
        }
      `,
      "src/campaign/Offer.region.tsx": `
        export const PPR = {
          cache: { revalidate: 30 },
          hydrate: "none",
        } as const;

        export default function Offer() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
          render: "ppr",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.graph.pages.campaign.ppr).toEqual({
      regions: {
        offer: {
          component: "./src/campaign/Offer.region.tsx",
          cache: { revalidate: 30 },
          hydrate: "none",
        },
      },
    });
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        {
          name: "campaign-ppr-shell",
          import: "./src/campaign/Page.tsx",
          environment: "server",
          runtime: "node",
          kind: "ppr-shell",
          owner: { pageId: "campaign" },
        },
        {
          name: "campaign-offer-ppr-region",
          import: "./src/campaign/Offer.region.tsx",
          environment: "server",
          runtime: "node",
          kind: "ppr-region",
          owner: { pageId: "campaign", regionId: "offer" },
        },
      ]),
    );
  });

  it("derives framework routes from configured page paths", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "src/pages/Dashboard.tsx":
        "export default function Dashboard() { return null; }",
      "src/pages/Campaign.tsx":
        "export default function Campaign() { return null; }",
      "src/pages/OfferRegion.tsx":
        "export default function OfferRegion() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        default: {
          entry: "./src/main.tsx",
          html: "./index.html",
        },
      },
      pages: {
        dashboard: {
          path: "/dashboard",
          component: "./src/pages/Dashboard.tsx",
          html: "./index.html",
          render: "ssr",
          hydrate: "load",
        },
        campaign: {
          path: "/campaign",
          component: "./src/pages/Campaign.tsx",
          html: "./index.html",
          render: "ppr",
          ppr: {
            regions: {
              offer: {
                component: "./src/pages/OfferRegion.tsx",
              },
            },
          },
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(analysis.graph.routes).toEqual([
      {
        id: "dashboard",
        path: "/dashboard",
        appId: "default",
        pageId: "dashboard",
        module: "./src/pages/Dashboard.tsx",
        render: "ssr",
        hydrate: "load",
      },
      {
        id: "campaign",
        path: "/campaign",
        appId: "default",
        pageId: "campaign",
        module: "./src/pages/Campaign.tsx",
        render: "ppr",
      },
    ]);
    expect(analysis.graph.pages.dashboard).toEqual(
      expect.objectContaining({
        id: "dashboard",
        path: "/dashboard",
        routeId: "dashboard",
        component: "./src/pages/Dashboard.tsx",
        render: "ssr",
      }),
    );
    expect(plan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { appId: "default" },
      },
    ]);
    expect(plan.server.renderers).toEqual(
      expect.arrayContaining([
        {
          name: "dashboard-server",
          import: "./src/pages/Dashboard.tsx",
          kind: "page-server",
          owner: { pageId: "dashboard", routeId: "dashboard" },
        },
        {
          name: "campaign-ppr-shell",
          import: "./src/pages/Campaign.tsx",
          kind: "ppr-shell",
          owner: { pageId: "campaign", routeId: "campaign" },
        },
      ]),
    );
  });

  it("rejects PPR pages when server output is disabled", async () => {
    const cwd = await createFixture({
      "src/campaign/Page.tsx":
        "export default function Page() { return null; }",
    });
    const config = createConfig({
      serverEnabled: false,
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
          render: "ppr",
          ppr: {
            regions: {},
          },
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(() =>
      createBuildPlan(config, analysis.graph, { mode: "production" }),
    ).toThrow('Page "campaign" uses render: "ppr" but server is disabled');
  });

  it("rejects PPR pages without a component page module", async () => {
    const cwd = await createFixture({
      "src/campaign/main.tsx": "console.log('campaign');",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          entry: "./src/campaign/main.tsx",
          html: "./index.html",
          render: "ppr",
          ppr: {
            regions: {},
          },
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(() =>
      createBuildPlan(config, analysis.graph, { mode: "production" }),
    ).toThrow(
      'Page "campaign" uses render: "ppr" but does not declare a component page module',
    );
  });

  it("plans RSC pages as server renderers without a client page entry", async () => {
    const cwd = await createFixture({
      "src/pages/rsc.tsx": "export default function RscPage() { return null; }",
    });
    const config = createConfig({
      pages: {
        rsc: {
          component: "./src/pages/rsc.tsx",
          html: "./index.html",
          render: "rsc",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(plan.runtime.server?.rsc).toBe("/__evjs/rsc");
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        {
          name: "rsc-server",
          import: "./src/pages/rsc.tsx",
          environment: "server",
          runtime: "node",
          kind: "page-server",
          owner: { pageId: "rsc" },
        },
        {
          name: "rsc-rsc",
          import: "./src/pages/rsc.tsx",
          environment: "server",
          runtime: "node",
          kind: "rsc-page",
          owner: { pageId: "rsc" },
        },
      ]),
    );
    expect(
      plan.entries.filter(
        (entry) =>
          entry.kind === "page-client" && entry.owner?.pageId === "rsc",
      ),
    ).toEqual([]);
    expect(plan.server.renderers).toEqual([
      {
        name: "rsc-server",
        import: "./src/pages/rsc.tsx",
        kind: "page-server",
        owner: { pageId: "rsc" },
      },
      {
        name: "rsc-rsc",
        import: "./src/pages/rsc.tsx",
        kind: "rsc-page",
        owner: { pageId: "rsc" },
      },
    ]);
  });

  it("collects RSC client and server references from imported modules", async () => {
    const cwd = await createFixture({
      "src/pages/rsc.tsx": `
        import ClientCard, { ClientWidget } from "./ClientCard";
        import { saveInsight } from "../actions";

        export default function RscPage() {
          void ClientCard;
          void ClientWidget;
          void saveInsight;
          return null;
        }
      `,
      "src/pages/ClientCard.tsx": `
        "use client";

        export default function ClientCard() {
          return null;
        }

        export function ClientWidget() {
          return null;
        }
      `,
      "src/actions.ts": `
        "use server";

        export async function saveInsight() {
          return { ok: true };
        }
      `,
    });
    const config = createConfig({
      pages: {
        rsc: {
          component: "./src/pages/rsc.tsx",
          html: "./index.html",
          render: "rsc",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });
    const output = linkBuildOutput({
      graph: analysis.graph,
      plan,
      clientEntryAssets: {
        "evjs-rsc-client": { js: ["evjs-rsc-client.js"], css: [] },
      },
      serverEntryAssets: {
        "rsc-rsc": { js: ["rsc-rsc.js"], css: [] },
      },
    });

    expect(analysis.graph.clientReferences).toEqual([
      {
        id: "src/pages/ClientCard.tsx#default",
        module: "src/pages/ClientCard.tsx",
        exportName: "default",
      },
      {
        id: "src/pages/ClientCard.tsx#ClientWidget",
        module: "src/pages/ClientCard.tsx",
        exportName: "ClientWidget",
      },
    ]);
    expect(analysis.graph.serverReferences).toEqual([
      {
        id: hashServerFunction("src/actions.ts", "saveInsight"),
        module: "src/actions.ts",
        exportName: "saveInsight",
      },
    ]);
    expect(output.rsc?.clientReferences).toEqual({
      "src/pages/ClientCard.tsx#default": {
        module: "src/pages/ClientCard.tsx",
        exportName: "default",
      },
      "src/pages/ClientCard.tsx#ClientWidget": {
        module: "src/pages/ClientCard.tsx",
        exportName: "ClientWidget",
      },
    });
    expect(output.rsc?.serverReferences).toEqual({
      [hashServerFunction("src/actions.ts", "saveInsight")]: {
        module: "src/actions.ts",
        exportName: "saveInsight",
      },
    });
    expect(output.pages.rsc.assets).toEqual({
      js: ["evjs-rsc-client.js"],
      css: [],
    });
    expect(output.pages.rsc.rendering).toEqual({
      mode: "rsc",
      component: "rsc",
      html: "server",
      streaming: true,
      hydrate: "load",
    });
  });

  it("derives orthogonal page rendering metadata for manifest consumers", async () => {
    const cwd = await createFixture({
      "src/pages/csr.tsx": "export default function Csr() { return null; }",
      "src/pages/ssr.tsx": "export default function Ssr() { return null; }",
      "src/pages/ssg.tsx": "export default function Ssg() { return null; }",
      "src/pages/ppr.tsx": "export default function Ppr() { return null; }",
      "src/pages/region.tsx":
        "export default function Region() { return null; }",
      "src/pages/rsc.tsx": "export default function Rsc() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        csr: {
          component: "./src/pages/csr.tsx",
          html: "./index.html",
          render: "csr",
        },
        ssr: {
          component: "./src/pages/ssr.tsx",
          html: "./index.html",
          render: "ssr",
          hydrate: "visible",
        },
        ssg: {
          component: "./src/pages/ssg.tsx",
          html: "./index.html",
          render: "ssg",
        },
        ppr: {
          component: "./src/pages/ppr.tsx",
          html: "./index.html",
          render: "ppr",
          ppr: {
            regions: {
              offer: {
                component: "./src/pages/region.tsx",
              },
            },
          },
        },
        rsc: {
          component: "./src/pages/rsc.tsx",
          html: "./index.html",
          render: "rsc",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });
    const output = linkBuildOutput({
      graph: analysis.graph,
      plan,
      clientEntryAssets: {
        csr: { js: ["csr.js"], css: [] },
        ssr: { js: ["ssr.js"], css: [] },
        "evjs-rsc-client": { js: ["evjs-rsc-client.js"], css: [] },
      },
    });

    expect(output.pages.csr.rendering).toEqual({
      mode: "csr",
      component: "client",
      html: "client",
      streaming: false,
      hydrate: "load",
    });
    expect(output.pages.ssr.rendering).toEqual({
      mode: "ssr",
      component: "server",
      html: "server",
      streaming: false,
      hydrate: "visible",
    });
    expect(output.pages.ssg.rendering).toEqual({
      mode: "ssg",
      component: "server",
      html: "static",
      prerender: "full",
      streaming: false,
      hydrate: "none",
    });
    expect(output.pages.ppr.rendering).toEqual({
      mode: "ppr",
      component: "server",
      html: "partial",
      prerender: "partial",
      streaming: false,
      hydrate: "none",
    });
    expect(output.pages.ppr.ppr?.delivery).toBe("merge");
    expect(output.pages.ppr.assets).toEqual({ js: [], css: [] });
    expect(output.pages.rsc.rendering).toEqual({
      mode: "rsc",
      component: "rsc",
      html: "server",
      streaming: true,
      hydrate: "load",
    });
  });

  it("diffs page entry and HTML additions for dev plan updates", async () => {
    const cwd = await createFixture({
      "src/pages/home/main.tsx": "console.log('home');",
      "src/pages/orders/main.tsx": "console.log('orders');",
      "index.html": '<div id="app"></div>',
    });
    const previousConfig = createConfig({
      serverEnabled: false,
      pages: {
        home: {
          entry: "./src/pages/home/main.tsx",
          html: "./index.html",
        },
      },
    });
    const nextConfig = createConfig({
      serverEnabled: false,
      pages: {
        home: {
          entry: "./src/pages/home/main.tsx",
          html: "./index.html",
        },
        orders: {
          entry: "./src/pages/orders/main.tsx",
          html: "./index.html",
        },
      },
    });

    const previousGraph = await createAppGraph(previousConfig, cwd);
    const nextGraph = await createAppGraph(nextConfig, cwd);
    const previousPlan = createBuildPlan(previousConfig, previousGraph.graph, {
      mode: "development",
    });
    const nextPlan = createBuildPlan(nextConfig, nextGraph.graph, {
      mode: "development",
    });
    const update = diffBuildPlan(previousPlan, nextPlan, "config");

    expect(update.entries.added).toEqual([
      {
        name: "orders",
        import: "./src/pages/orders/main.tsx",
        environment: "client",
        runtime: "browser",
        kind: "page-client",
        owner: { pageId: "orders" },
      },
    ]);
    expect(update.entries.removed).toEqual([]);
    expect(update.entries.changed).toEqual([]);
    expect(update.html.added).toEqual([
      {
        id: "orders",
        template: "./index.html",
        fileName: "orders.html",
        owner: { pageId: "orders" },
      },
    ]);
    expect(update.serverChanged).toBe(false);
  });

  it("extracts current route, server route, and server function metadata", async () => {
    const cwd = await createFixture({
      "src/main.tsx": `
        import { createRoute } from "@evjs/client";
        export const rootRoute = createRoute({
          path: "/",
          component: () => null,
        });
      `,
      "src/server.ts": `
        import "./api";
        import "./actions";
      `,
      "src/api.ts": `
        import { createRoute } from "@evjs/server";
        export const health = createRoute("/api/health", {
          GET: async () => Response.json({ ok: true }),
        });
      `,
      "src/actions.ts": `
        "use server";
        export async function saveOrder() {
          return { ok: true };
        }
      `,
    });
    const config = createConfig({
      server: {
        entry: "./src/server.ts",
        basePath: "/__evjs",
        functionRuntime: {
          endpoint: "/__evjs/fn",
          clientProxy: "@evjs/client",
          serverRegister: "@evjs/server/register",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.routes).toEqual([
      { id: "/", path: "/", appId: "default" },
    ]);
    expect(analysis.graph.serverRoutes).toEqual([
      {
        id: "src/api.ts:/api/health:GET",
        module: "src/api.ts",
        path: "/api/health",
        methods: ["GET"],
      },
    ]);
    expect(analysis.graph.serverFunctions).toEqual([
      {
        id: expect.any(String),
        module: "src/actions.ts",
        exportName: "saveOrder",
      },
    ]);
    expect(
      analysis.fileDependencies.map((file) => path.relative(cwd, file)),
    ).toEqual([
      "src/actions.ts",
      "src/api.ts",
      "src/main.tsx",
      "src/server.ts",
    ]);
  });

  it("does not scan unrelated source files outside explicit roots and imports", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "src/unused.ts": `
        "use server";
        export async function unused() {
          return null;
        }
      `,
    });
    const config = createConfig();
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.serverFunctions).toEqual([]);
    expect(
      analysis.fileDependencies.map((file) => path.relative(cwd, file)),
    ).toEqual([]);
  });

  it("collects explicit app route and remote declarations", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "src/pages/Dashboard.tsx":
        "export default function Dashboard() { return null; }",
      "src/routes.tsx": `
        import Dashboard from "./pages/Dashboard";
        import { defineReactRoutes, page, route } from "@evjs/client";
        void Dashboard;
        export default defineReactRoutes([
          route("/dashboard", {
            id: "dashboard",
            page: page("./pages/Dashboard.tsx"),
            render: "ssr",
            hydrate: "load",
          }),
        ]);
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        default: {
          entry: "./src/main.tsx",
          html: "./index.html",
          routes: "./src/routes.tsx",
        },
      },
      remotes: {
        crm: {
          manifest: "https://assets.example.com/crm/manifest.json",
          activeWhen: ["/crm/*"],
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.apps.default).toEqual({
      id: "default",
      entry: "./src/main.tsx",
      html: "./index.html",
      routes: "./src/routes.tsx",
    });
    expect(analysis.graph.routes).toEqual([
      {
        id: "dashboard",
        path: "/dashboard",
        appId: "default",
        pageId: "dashboard",
        module: "./src/pages/Dashboard.tsx",
        render: "ssr",
        hydrate: "load",
      },
    ]);
    expect(analysis.graph.pages).toEqual({
      dashboard: {
        id: "dashboard",
        routeId: "dashboard",
        component: "./src/pages/Dashboard.tsx",
        html: "./index.html",
        render: "ssr",
        hydrate: "load",
      },
    });
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        {
          name: "main",
          import: "./src/main.tsx",
          environment: "client",
          runtime: "browser",
          kind: "app-client",
          owner: { appId: "default" },
        },
        {
          name: "server",
          import: "@evjs/server/fetch",
          environment: "server",
          runtime: "node",
          kind: "server-runtime",
        },
        {
          name: "dashboard-server",
          import: "./src/pages/Dashboard.tsx",
          environment: "server",
          runtime: "node",
          kind: "page-server",
          owner: { pageId: "dashboard", routeId: "dashboard" },
        },
      ]),
    );
    expect(plan.server.renderers).toEqual([
      {
        name: "dashboard-server",
        import: "./src/pages/Dashboard.tsx",
        kind: "page-server",
        owner: { pageId: "dashboard", routeId: "dashboard" },
      },
    ]);
    expect(plan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { appId: "default" },
      },
    ]);
    expect(analysis.graph.remotes).toEqual({
      crm: {
        id: "crm",
        manifest: "https://assets.example.com/crm/manifest.json",
        activeWhen: ["/crm/*"],
      },
    });
    expect(
      analysis.fileDependencies.map((file) => path.relative(cwd, file)),
    ).toEqual(["src/routes.tsx"]);
  });

  it("creates remote-client entries for remote-only builds without app html", async () => {
    const cwd = await createFixture({
      "src/remote.ts": `
        export function mount() {}
        export function unmount() {}
      `,
      "src/unused.ts": "console.log('unused');",
    });
    const config = createConfig({
      serverEnabled: false,
      remote: {
        name: "crm",
        baseUrl: "https://assets.example.com/crm/",
        shared: {
          "remote-react": {
            shareKey: "react",
            requiredVersion: ">=19 <20",
            singleton: true,
            strictVersion: true,
            eager: true,
          },
        },
        entries: {
          customers: {
            app: "./src/remote.ts",
            activeWhen: ["/crm/*"],
            mount: "#remote-root",
          },
        },
      },
      server: {
        entry: undefined,
        basePath: "/__evjs",
        functionRuntime: {
          endpoint: "/__evjs/fn",
          clientProxy: "@evjs/client",
          serverRegister: "@evjs/server/register",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.apps).toEqual({});
    expect(analysis.graph.pages).toEqual({});
    expect(analysis.graph.remote).toEqual({
      name: "crm",
      baseUrl: "https://assets.example.com/crm/",
      shared: {
        "remote-react": {
          shareKey: "react",
          requiredVersion: ">=19 <20",
          singleton: true,
          strictVersion: true,
          eager: true,
        },
      },
      entries: {
        customers: {
          id: "customers",
          app: "./src/remote.ts",
          activeWhen: ["/crm/*"],
          mount: "#remote-root",
        },
      },
    });
    expect(plan.html).toEqual([]);
    expect(plan.remote).toEqual({
      name: "crm",
      baseUrl: "https://assets.example.com/crm/",
      shared: {
        "remote-react": {
          shareKey: "react",
          requiredVersion: ">=19 <20",
          singleton: true,
          strictVersion: true,
          eager: true,
        },
      },
      entries: {
        customers: {
          id: "customers",
          name: "crm-customers",
          app: "./src/remote.ts",
          activeWhen: ["/crm/*"],
          mount: "#remote-root",
        },
      },
    });
    expect(plan.entries).toEqual([
      {
        name: "crm-customers",
        import: "./src/remote.ts",
        environment: "client",
        runtime: "browser",
        kind: "remote-client",
        owner: {
          remoteId: "crm",
          remoteEntryId: "customers",
        },
        metadata: {
          type: "remote-client",
          app: "./src/remote.ts",
        },
      },
    ]);
    expect(
      analysis.fileDependencies.map((file) => path.relative(cwd, file)),
    ).toEqual([]);
  });

  it("allows explicit apps and configured pages to coexist", async () => {
    const cwd = await createFixture({
      "src/console/main.tsx": "console.log('console');",
      "src/pages/campaign.tsx":
        "export default function Campaign() { return null; }",
      "src/routes.tsx": `
        import { defineReactRoutes, route } from "@evjs/client";
        export default defineReactRoutes([
          route("/orders", { id: "orders" }),
        ]);
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        console: {
          entry: "./src/console/main.tsx",
          html: "./index.html",
          routes: "./src/routes.tsx",
        },
      },
      pages: {
        campaign: {
          component: "./src/pages/campaign.tsx",
          html: "./index.html",
          render: "csr",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(Object.keys(analysis.graph.apps)).toEqual(["console"]);
    expect(Object.keys(analysis.graph.pages)).toEqual(["campaign"]);
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        {
          name: "console",
          import: "./src/console/main.tsx",
          environment: "client",
          runtime: "browser",
          kind: "app-client",
          owner: { appId: "console" },
        },
        {
          name: "campaign",
          import: "./src/pages/campaign.tsx",
          environment: "client",
          runtime: "browser",
          kind: "page-client",
          owner: { pageId: "campaign" },
          metadata: {
            type: "react-component-page",
            component: "./src/pages/campaign.tsx",
            mount: "#app",
            hydrate: "load",
            render: "csr",
          },
        },
      ]),
    );
    expect(plan.html).toEqual([
      {
        id: "console",
        template: "./index.html",
        fileName: "console.html",
        owner: { appId: "console" },
      },
      {
        id: "campaign",
        template: "./index.html",
        fileName: "campaign.html",
        owner: { pageId: "campaign" },
      },
    ]);
  });

  it("keeps CSR route modules as route metadata without page build units", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "src/routes.tsx": `
        import { defineReactRoutes, page, route } from "@evjs/client";
        export default defineReactRoutes([
          route("/about", {
            id: "about",
            page: page("./pages/About.tsx"),
            render: "csr",
          }),
        ]);
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        default: {
          entry: "./src/main.tsx",
          html: "./index.html",
          routes: "./src/routes.tsx",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.pages).toEqual({});
    expect(analysis.graph.routes).toEqual([
      {
        id: "about",
        path: "/about",
        appId: "default",
        module: "./src/pages/About.tsx",
        render: "csr",
      },
    ]);
    expect(
      plan.entries.filter((entry) => entry.kind === "page-server"),
    ).toEqual([]);
    expect(plan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { appId: "default" },
      },
    ]);
  });

  it("keeps route app ownership with the app that declares the route source", async () => {
    const cwd = await createFixture({
      "src/console/main.tsx": "console.log('console');",
      "src/admin/main.tsx": "console.log('admin');",
      "src/console/routes.tsx": `
        import { defineReactRoutes, route } from "@evjs/client";
        export default defineReactRoutes([
          route("/orders", { id: "orders" }),
        ]);
      `,
      "src/admin/routes.tsx": `
        import { defineReactRoutes, route } from "@evjs/client";
        export default defineReactRoutes([
          route("/orders", { id: "admin.orders" }),
        ]);
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        console: {
          entry: "./src/console/main.tsx",
          html: "./index.html",
          routes: "./src/console/routes.tsx",
        },
        admin: {
          entry: "./src/admin/main.tsx",
          html: "./index.html",
          routes: "./src/admin/routes.tsx",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.routes).toEqual([
      { id: "admin.orders", path: "/orders", appId: "admin" },
      { id: "orders", path: "/orders", appId: "console" },
    ]);
  });

  it("creates stable route-derived page ids from paths when no route id is declared", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "src/routes.tsx": `
        import { defineReactRoutes, page, route } from "@evjs/client";
        export default defineReactRoutes([
          route("/", {
            page: page("./pages/Home.tsx"),
            render: "ssg",
          }),
          route("/orders/$orderId", {
            page: page("./pages/Order.tsx"),
            render: "ssr",
          }),
        ]);
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        default: {
          entry: "./src/main.tsx",
          html: "./index.html",
          routes: "./src/routes.tsx",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(Object.keys(analysis.graph.pages)).toEqual([
      "index",
      "orders_orderId",
    ]);
    expect(analysis.graph.routes).toEqual([
      {
        id: "/",
        path: "/",
        appId: "default",
        pageId: "index",
        module: "./src/pages/Home.tsx",
        render: "ssg",
      },
      {
        id: "/orders/$orderId",
        path: "/orders/$orderId",
        appId: "default",
        pageId: "orders_orderId",
        module: "./src/pages/Order.tsx",
        render: "ssr",
      },
    ]);
  });

  it("returns diagnostics for non-static framework-managed route modules", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "src/routes.tsx": `
        import { defineReactRoutes, page, route } from "@evjs/client";
        const modulePath = "./pages/Dynamic.tsx";
        export default defineReactRoutes([
          route("/dynamic", {
            id: "dynamic",
            page: page(modulePath),
            render: "ssr",
          }),
        ]);
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        default: {
          entry: "./src/main.tsx",
          html: "./index.html",
          routes: "./src/routes.tsx",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([
      expect.objectContaining({
        level: "error",
        file: "src/routes.tsx",
        message:
          '@evjs/client route() with render: "ssr" must declare page(componentPath) with a string literal component module path.',
      }),
    ]);
  });
});

async function createFixture(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-graph-plan-"));
  tempDirs.push(dir);

  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(dir, file);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content);
  }

  return dir;
}

type TestConfig = BuildPlanConfig & Pick<GraphConfig, "apps" | "remotes">;

function createConfig(overrides: Partial<TestConfig> = {}): TestConfig {
  return {
    entry: "./src/main.tsx",
    html: "./index.html",
    pages: undefined,
    serverEnabled: true,
    server: {
      entry: undefined,
      basePath: "/__evjs",
      functionRuntime: {
        endpoint: "/__evjs/fn",
        clientProxy: "@evjs/client",
        serverRegister: "@evjs/server/register",
      },
    },
    ...overrides,
  };
}
