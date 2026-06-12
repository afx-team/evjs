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

  it("creates a framework-managed SPA entry from page routes", async () => {
    const cwd = await createFixture({
      "src/layout.tsx": "export default function Root() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/users/$userId.tsx": `
        export function validateSearch(search: Record<string, unknown>) {
          return { tab: String(search.tab ?? "all") };
        }
        export default function User() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/pages/index.tsx",
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/pages/index.tsx",
        html: "./index.html",
        mount: "#app",
        rootModule: "./src/layout.tsx",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
          {
            id: "users_userId",
            path: "/users/$userId",
            module: "./src/pages/users/$userId.tsx",
          },
        ],
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.apps.default).toEqual({
      id: "default",
      entry: "./src/pages/index.tsx",
      html: "./index.html",
      mount: "#app",
    });
    expect(analysis.graph.routes).toEqual([
      {
        id: "index",
        path: "/",
        appId: "default",
        module: "./src/pages/index.tsx",
      },
      {
        id: "users_userId",
        path: "/users/$userId",
        appId: "default",
        module: "./src/pages/users/$userId.tsx",
      },
    ]);
    expect(plan.entries).toContainEqual({
      name: "main",
      import: "./src/pages/index.tsx",
      environment: "client",
      runtime: "browser",
      kind: "app-client",
      owner: { appId: "default" },
      metadata: {
        type: "pages-app",
        mount: "#app",
        rootModule: "./src/layout.tsx",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
          {
            id: "users_userId",
            path: "/users/$userId",
            module: "./src/pages/users/$userId.tsx",
          },
        ],
      },
    });
    expect(
      analysis.fileDependencies.map((file) => path.relative(cwd, file)),
    ).toEqual([
      "src/layout.tsx",
      "src/pages",
      "src/pages/index.tsx",
      "src/pages/users/$userId.tsx",
    ]);
  });

  it("creates router-free MPA page entries from page routes", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/about.tsx": "export default function About() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      routing: {
        mode: "mpa",
        dir: "./src/pages",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
          {
            id: "about",
            path: "/about",
            module: "./src/pages/about.tsx",
          },
        ],
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.apps).toEqual({});
    expect(analysis.graph.pages).toMatchObject({
      index: {
        id: "index",
        path: "/",
        component: "./src/pages/index.tsx",
        html: "./index.html",
        render: "csr",
        mount: "#app",
      },
      about: {
        id: "about",
        path: "/about",
        component: "./src/pages/about.tsx",
        html: "./index.html",
        render: "csr",
        mount: "#app",
      },
    });
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "index",
          import: "./src/pages/index.tsx",
          kind: "page-client",
          owner: { pageId: "index" },
          metadata: expect.objectContaining({
            type: "react-component-page",
            component: "./src/pages/index.tsx",
            route: { id: "index", path: "/" },
          }),
        }),
        expect.objectContaining({
          name: "about",
          import: "./src/pages/about.tsx",
          kind: "page-client",
          owner: { pageId: "about" },
          metadata: expect.objectContaining({
            type: "react-component-page",
            component: "./src/pages/about.tsx",
            route: { id: "about", path: "/about" },
          }),
        }),
      ]),
    );
    expect(plan.entries.some((entry) => entry.kind === "app-client")).toBe(
      false,
    );
    expect(plan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { pageId: "index" },
      },
      {
        id: "about",
        template: "./index.html",
        fileName: "about.html",
        owner: { pageId: "about" },
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

  it("reads render metadata from configured component page modules", async () => {
    const cwd = await createFixture({
      "src/pages/dashboard.tsx": `
        export const render = "ssr";
        export const hydrate = "load";
        export default function Dashboard() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        dashboard: {
          path: "/dashboard",
          component: "./src/pages/dashboard.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.pages.dashboard).toMatchObject({
      render: "ssr",
      hydrate: "load",
    });
    expect(plan.server.renderers).toContainEqual({
      name: "dashboard-server",
      import: "./src/pages/dashboard.tsx",
      kind: "page-server",
      owner: { pageId: "dashboard", routeId: "dashboard" },
    });
  });

  it("does not create a client runtime entry for static non-hydrated component pages", async () => {
    const cwd = await createFixture({
      "src/pages/pricing.tsx": `
        export const render = "ssg";
        export const hydrate = "none";
        export default function Pricing() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        pricing: {
          component: "./src/pages/pricing.tsx",
          html: "./index.html",
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

  it("plans PPR shell and region entries from Suspense page regions", async () => {
    const cwd = await createFixture({
      "src/campaign/Page.tsx": `
        import * as React from "react";
        const OfferRegion = React.lazy(() => import("./Offer.region"));
        export const render = "ssr";
        export const hydrate = "none";
        export const prerender = { partial: true } as const;
        export default function Page() {
          return (
            <React.Suspense fallback={<p>Loading offer</p>}>
              <OfferRegion />
            </React.Suspense>
          );
        }
      `,
      "src/campaign/Offer.region.tsx": `
        export const cache = "no-store";
        export const hydrate = "visible";
        export default function Offer() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(analysis.graph.pages.campaign.ppr).toEqual({
      delivery: "merge",
      regions: {
        offer: {
          component: "./src/campaign/Offer.region.tsx",
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
    ).toEqual(["src/campaign/Offer.region.tsx", "src/campaign/Page.tsx"]);
  });

  it("plans PPR regions from Suspense lazy boundaries in the page component tree", async () => {
    const cwd = await createFixture({
      "src/campaign/Page.tsx": `
        import CampaignSections from "./CampaignSections";

        export const render = "ssr";
        export const hydrate = "none";
        export const prerender = { partial: true } as const;
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
        export const cache = { revalidate: 30 } as const;
        export const hydrate = "none";
        export default function Offer() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.graph.pages.campaign.ppr).toEqual({
      delivery: "merge",
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
      "src/pages/Dashboard.tsx": `
        export const render = "ssr";
        export const hydrate = "load";
        export default function Dashboard() { return null; }
      `,
      "src/pages/Campaign.tsx": `
        import * as React from "react";
        const OfferRegion = React.lazy(() => import("./OfferRegion"));
        export const render = "ssr";
        export const hydrate = "none";
        export const prerender = { partial: true } as const;
        export default function Campaign() {
          return (
            <React.Suspense fallback={null}>
              <OfferRegion />
            </React.Suspense>
          );
        }
      `,
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
        },
        campaign: {
          path: "/campaign",
          component: "./src/pages/Campaign.tsx",
          html: "./index.html",
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
        render: "ssr",
        hydrate: "none",
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
      "src/campaign/Page.tsx": `
        export const render = "ssr";
        export const prerender = { partial: true } as const;
        export default function Page() { return null; }
      `,
    });
    const config = createConfig({
      serverEnabled: false,
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(() =>
      createBuildPlan(config, analysis.graph, { mode: "production" }),
    ).toThrow(
      'Page "campaign" uses partial prerendering but server is disabled',
    );
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
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    analysis.graph.pages.campaign.prerender = { partial: true };
    analysis.graph.pages.campaign.ppr = { regions: {} };

    expect(() =>
      createBuildPlan(config, analysis.graph, { mode: "production" }),
    ).toThrow(
      'Page "campaign" uses partial prerendering but does not declare a component page module',
    );
  });

  it("plans RSC pages as server renderers without a client page entry", async () => {
    const cwd = await createFixture({
      "src/pages/rsc.tsx": `
        export const render = "ssr";
        export const rsc = true;
        export default function RscPage() { return null; }
      `,
    });
    const config = createConfig({
      pages: {
        rsc: {
          component: "./src/pages/rsc.tsx",
          html: "./index.html",
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

        export const render = "ssr";
        export const rsc = true;
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
      component: "rsc",
      html: "server",
      streaming: true,
      hydrate: "load",
    });
  });

  it("derives orthogonal page rendering metadata for manifest consumers", async () => {
    const cwd = await createFixture({
      "src/pages/csr.tsx": `
        export const render = "csr";
        export default function Csr() { return null; }
      `,
      "src/pages/ssr.tsx": `
        export const render = "ssr";
        export const hydrate = "visible";
        export default function Ssr() { return null; }
      `,
      "src/pages/ssg.tsx": `
        export const render = "ssg";
        export default function Ssg() { return null; }
      `,
      "src/pages/ppr.tsx": `
        import * as React from "react";
        const OfferRegion = React.lazy(() => import("./region"));
        export const render = "ssr";
        export const hydrate = "none";
        export const prerender = { partial: true } as const;
        export default function Ppr() {
          return (
            <React.Suspense fallback={null}>
              <OfferRegion />
            </React.Suspense>
          );
        }
      `,
      "src/pages/region.tsx":
        "export default function Region() { return null; }",
      "src/pages/rsc.tsx": `
        export const render = "ssr";
        export const rsc = true;
        export default function Rsc() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        csr: {
          component: "./src/pages/csr.tsx",
          html: "./index.html",
        },
        ssr: {
          component: "./src/pages/ssr.tsx",
          html: "./index.html",
        },
        ssg: {
          component: "./src/pages/ssg.tsx",
          html: "./index.html",
        },
        ppr: {
          component: "./src/pages/ppr.tsx",
          html: "./index.html",
        },
        rsc: {
          component: "./src/pages/rsc.tsx",
          html: "./index.html",
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
      component: "client",
      html: "client",
      streaming: false,
      hydrate: "load",
    });
    expect(output.pages.ssr.rendering).toEqual({
      component: "server",
      html: "server",
      streaming: false,
      hydrate: "visible",
    });
    expect(output.pages.ssg.rendering).toEqual({
      component: "server",
      html: "static",
      prerender: "full",
      streaming: false,
      hydrate: "none",
    });
    expect(output.pages.ppr.rendering).toEqual({
      component: "server",
      html: "partial",
      prerender: "partial",
      streaming: false,
      hydrate: "none",
    });
    expect(output.pages.ppr.ppr?.delivery).toBe("merge");
    expect(output.pages.ppr.assets).toEqual({ js: [], css: [] });
    expect(output.pages.rsc.rendering).toEqual({
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

  it("extracts server route and server function metadata", async () => {
    const cwd = await createFixture({
      "src/main.tsx": `
        export const clientEntry = true;
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

    expect(analysis.graph.routes).toEqual([]);
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
    ).toEqual(["src/actions.ts", "src/api.ts", "src/server.ts"]);
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

  it("collects page route and remote declarations", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "src/pages/Dashboard.tsx": `
        export const render = "ssr";
        export const hydrate = "load";
        export default function Dashboard() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/main.tsx",
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/main.tsx",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "dashboard",
            path: "/dashboard",
            module: "./src/pages/Dashboard.tsx",
          },
        ],
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
      mount: "#app",
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
          metadata: {
            type: "pages-app",
            routes: [
              {
                id: "dashboard",
                path: "/dashboard",
                module: "./src/pages/Dashboard.tsx",
              },
            ],
            mount: "#app",
          },
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
    ).toEqual(["src/pages", "src/pages/Dashboard.tsx"]);
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
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        console: {
          entry: "./src/console/main.tsx",
          html: "./index.html",
        },
      },
      pages: {
        campaign: {
          component: "./src/pages/campaign.tsx",
          html: "./index.html",
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

  it("keeps CSR page route modules as route metadata without page build units", async () => {
    const cwd = await createFixture({
      "src/pages/About.tsx": "export default function About() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/pages/About.tsx",
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/pages/About.tsx",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "about",
            path: "/about",
            module: "./src/pages/About.tsx",
          },
        ],
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

  it("assigns page routes to the explicit SPA app entry", async () => {
    const cwd = await createFixture({
      "src/console/main.tsx": "console.log('console');",
      "src/admin/main.tsx": "console.log('admin');",
      "src/pages/orders.tsx": `
        export const render = "ssr";
        export default function Orders() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        console: {
          entry: "./src/console/main.tsx",
          html: "./index.html",
        },
        admin: {
          entry: "./src/admin/main.tsx",
          html: "./index.html",
        },
      },
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/console/main.tsx",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "orders",
            path: "/orders",
            module: "./src/pages/orders.tsx",
          },
        ],
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.apps).toEqual({
      console: {
        id: "console",
        entry: "./src/console/main.tsx",
        html: "./index.html",
      },
      admin: {
        id: "admin",
        entry: "./src/admin/main.tsx",
        html: "./index.html",
      },
    });
    expect(analysis.graph.routes).toEqual([
      {
        id: "orders",
        path: "/orders",
        appId: "console",
        pageId: "orders",
        module: "./src/pages/orders.tsx",
        render: "ssr",
      },
    ]);
    expect(plan.entries).toContainEqual({
      name: "console",
      import: "./src/console/main.tsx",
      environment: "client",
      runtime: "browser",
      kind: "app-client",
      owner: { appId: "console" },
      metadata: {
        type: "pages-app",
        routes: [
          {
            id: "orders",
            path: "/orders",
            module: "./src/pages/orders.tsx",
          },
        ],
        mount: "#app",
      },
    });
    expect(plan.entries).toContainEqual({
      name: "orders-server",
      import: "./src/pages/orders.tsx",
      environment: "server",
      runtime: "node",
      kind: "page-server",
      owner: { pageId: "orders", routeId: "orders" },
    });
  });

  it("treats app source files as plain app entries", async () => {
    const cwd = await createFixture({
      "src/apps/render-lab/app.tsx": `
        export default function RenderLabApp() {
          return null;
        }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        "render-lab": "./src/apps/render-lab/app.tsx",
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.apps).toEqual({
      "render-lab": {
        id: "render-lab",
        entry: "./src/apps/render-lab/app.tsx",
        html: "./index.html",
      },
    });
    expect(analysis.graph.routes).toEqual([]);
    expect(plan.entries).toContainEqual({
      name: "render-lab",
      import: "./src/apps/render-lab/app.tsx",
      environment: "client",
      runtime: "browser",
      kind: "app-client",
      owner: { appId: "render-lab" },
    });
    expect(plan.html).toContainEqual({
      id: "render-lab",
      template: "./index.html",
      fileName: "render-lab.html",
      owner: { appId: "render-lab" },
    });
  });

  it("creates stable route-derived page ids from page route paths", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": `
        export const render = "ssg";
        export default function Home() { return null; }
      `,
      "src/pages/orders/$orderId.tsx": `
        export const render = "ssr";
        export default function Order() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/pages/index.tsx",
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/pages/index.tsx",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
          {
            id: "orders_orderId",
            path: "/orders/$orderId",
            module: "./src/pages/orders/$orderId.tsx",
          },
        ],
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(Object.keys(analysis.graph.pages)).toEqual([
      "index",
      "orders_orderId",
    ]);
    expect(analysis.graph.routes).toEqual([
      {
        id: "index",
        path: "/",
        appId: "default",
        pageId: "index",
        module: "./src/pages/index.tsx",
        render: "ssg",
      },
      {
        id: "orders_orderId",
        path: "/orders/$orderId",
        appId: "default",
        pageId: "orders_orderId",
        module: "./src/pages/orders/$orderId.tsx",
        render: "ssr",
      },
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
