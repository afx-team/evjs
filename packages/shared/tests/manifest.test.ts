import { describe, expect, it } from "vitest";
import type { BuildOutput, RemoteManifest } from "../src/manifest/index.js";
import {
  createPublicManifest,
  linkRemoteManifest,
} from "../src/manifest/index.js";

describe("createPublicManifest", () => {
  it("redacts source and server-only build metadata from the browser manifest", () => {
    const output: BuildOutput = {
      version: 1,
      buildId: "build",
      distDir: "dist",
      publicPath: "/assets/",
      runtime: {
        server: {
          basePath: "/__evjs",
          fn: "/__evjs/fn",
          rsc: "/__evjs/rsc",
        },
      },
      assets: {
        dashboard: { js: ["dashboard.js"], css: ["dashboard.css"] },
      },
      apps: {
        admin: {
          assets: { js: ["admin.js"], css: [] },
          entry: "./src/main.tsx",
          module: {
            type: "entry",
            href: "admin.js",
            source: "./src/main.tsx",
          },
        },
      },
      pages: {
        insights: {
          assets: { js: ["evjs-rsc-client.js"], css: ["insights.css"] },
          render: "ssr",
          componentModel: "rsc",
          rendering: {
            component: "rsc",
            html: "server",
            streaming: true,
            hydrate: "load",
          },
          path: "/insights",
          routeId: "insights",
          component: "./src/pages/Insights.tsx",
          module: {
            type: "react-component",
            href: "evjs-rsc-client.js",
            source: "./src/pages/Insights.tsx",
          },
        },
        campaign: {
          assets: { js: [], css: [] },
          render: "ssr",
          prerender: { partial: true },
          rendering: {
            component: "server",
            html: "partial",
            prerender: "partial",
            streaming: true,
            hydrate: "none",
          },
          hydrate: "none",
          component: "./src/pages/Campaign.tsx",
          ppr: {
            delivery: "stream",
            shell: { js: ["campaign-ppr-shell.js"], css: [] },
            regions: {
              offer: {
                id: "offer",
                assets: { js: ["campaign-offer-ppr-region.js"], css: [] },
                component: "./src/pages/Offer.region.tsx",
                fallback: "./src/pages/OfferSkeleton.tsx",
                cache: "no-store",
              },
            },
          },
        },
      },
      routes: [
        {
          id: "insights",
          path: "/insights",
          pageId: "insights",
          module: "./src/pages/Insights.tsx",
          render: "ssr",
        },
      ],
      server: {
        entry: "server.js",
        assets: { js: ["server.js"], css: [] },
        renderers: {
          "insights-rsc": {
            kind: "rsc-page",
            owner: { pageId: "insights" },
            module: "./src/pages/Insights.tsx",
            assets: { js: ["insights-rsc.js"], css: ["insights.css"] },
          },
        },
        functions: {
          "fn:refund": {
            assets: { js: ["orders.server.js"], css: [] },
            module: "./src/api/orders.server.ts",
            exportName: "refund",
          },
        },
        routes: [
          {
            path: "/api/health",
            methods: ["GET"],
            assets: { js: ["health.routes.js"], css: [] },
          },
        ],
      },
      rsc: {
        endpoint: "/__evjs/rsc",
        pages: {
          insights: {
            renderer: "insights-rsc",
            assets: { js: ["insights-rsc.js"], css: ["insights.css"] },
            component: "./src/pages/Insights.tsx",
            routeId: "insights",
          },
        },
        clientReferences: {
          "src/pages/Client.tsx#default": {
            module: "src/pages/Client.tsx",
            exportName: "default",
          },
        },
        clientReferenceManifest: {
          "file:///Users/example/repo/src/pages/Client.tsx": {
            id: "client",
          },
        },
      },
      deployment: {
        platform: "node",
        source: "./src/server.ts",
        publicAsset: "dashboard.js",
      },
    };

    const manifest = createPublicManifest(output);
    const serialized = JSON.stringify(manifest);

    expect(serialized).not.toContain(".tsx");
    expect(serialized).not.toContain(".ts");
    expect(serialized).not.toContain("file://");
    expect(serialized).not.toContain("/Users/");
    expect(manifest.pages.insights.assets).toEqual({
      js: ["evjs-rsc-client.js"],
      css: ["insights.css"],
    });
    expect(manifest.pages.insights.module).toEqual({
      type: "react-component",
      href: "evjs-rsc-client.js",
    });
    expect(manifest.pages.campaign.assets).toEqual({ js: [], css: [] });
    expect(manifest.pages.campaign.hydrate).toBe("none");
    expect(manifest.pages.campaign.rendering.hydrate).toBe("none");
    expect(manifest.pages.campaign.ppr?.delivery).toBe("stream");
    expect(manifest.pages.campaign.ppr?.regions.offer).toEqual({
      id: "offer",
      assets: { js: [], css: [] },
      cache: "no-store",
    });
    expect(manifest.server?.entry).toBeUndefined();
    expect(manifest.server?.renderers).toBeUndefined();
    expect(manifest.server?.functions["fn:refund"]).toEqual({
      assets: { js: [], css: [] },
      exportName: "refund",
    });
    expect(manifest.rsc?.clientReferenceManifest).toBeUndefined();
    expect(manifest.rsc?.clientReferences).toBeUndefined();
    expect(manifest.rsc?.pages?.insights).toEqual({
      renderer: "insights-rsc",
      assets: { js: [], css: ["insights.css"] },
      routeId: "insights",
    });
    expect(manifest.deployment).toEqual({
      platform: "node",
      publicAsset: "dashboard.js",
    });
  });
});

describe("linkRemoteManifest", () => {
  it("does not publish remote source modules", () => {
    const manifest = linkRemoteManifest({
      plan: {
        version: 1,
        buildId: "build",
        mode: "production",
        distDir: "dist",
        serverEnabled: false,
        entries: [
          {
            name: "crm-default",
            import: "./src/remote/Crm.tsx",
            environment: "client",
            runtime: "browser",
            kind: "remote-client",
            owner: { remoteId: "crm", remoteEntryId: "default" },
          },
        ],
        html: [],
        server: { enabled: false },
        runtime: { publicPath: "/" },
        remote: {
          name: "crm",
          baseUrl: "https://assets.example.com/crm/",
          entries: {
            default: {
              id: "default",
              name: "crm-default",
              app: "./src/remote/Crm.tsx",
              activeWhen: ["/crm/*"],
            },
          },
        },
      },
      clientEntryAssets: {
        "crm-default": { js: ["crm-default.js"], css: ["crm-default.css"] },
      },
    }) as RemoteManifest;

    expect(manifest.entries.default.module).toEqual({
      type: "lifecycle",
      href: "crm-default.js",
    });
    expect(JSON.stringify(manifest)).not.toContain(".tsx");
  });
});
