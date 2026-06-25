import { describe, expect, it } from "vitest";
import type {
  AppGraph,
  BuildOutput,
  BuildPlan,
} from "../src/manifest/index.js";
import {
  assertFrameworkManifestShape,
  createPublicManifest,
  createServerManifest,
  linkBuildOutput as linkManifestBuildOutput,
} from "../src/manifest/index.js";

function createMinimalBuildOutput(): BuildOutput {
  return {
    version: 1,
    buildId: "build",
    distDir: "dist",
    publicPath: "/",
    runtime: {
      server: {
        basePath: "/__evjs",
        fn: "/__evjs/fn",
      },
    },
    assets: {},
    apps: {},
    pages: {},
    routes: [],
    server: {
      entry: "server.js",
      assets: { js: ["server.js"], css: [] },
      functions: {},
      routes: [],
    },
  };
}

function createServerRuntimeEntry(): BuildPlan["entries"][number] {
  return {
    name: "server",
    import: "@evjs/ev/internal/server/fetch",
    environment: "server",
    runtime: "node",
    kind: "server-runtime",
  };
}

function createServerPlan(
  renderers?: BuildPlan["server"]["renderers"],
): BuildPlan["server"] {
  return {
    entry: "@evjs/ev/internal/server/fetch",
    ...(renderers ? { renderers } : {}),
  };
}

function createRuntimePlan(
  server?: Partial<NonNullable<BuildPlan["runtime"]["server"]>>,
): BuildPlan["runtime"] {
  return {
    publicPath: "/",
    server: {
      basePath: "/__evjs",
      fn: "/__evjs/fn",
      ...server,
    },
  };
}

function createDefaultServerEntryAssets(): {
  server: { js: string[]; css: string[] };
} {
  return {
    server: { js: ["server.js"], css: [] },
  };
}

function linkBuildOutput(
  input: Parameters<typeof linkManifestBuildOutput>[0],
): ReturnType<typeof linkManifestBuildOutput> {
  return linkManifestBuildOutput({
    serverEntryAssets: createDefaultServerEntryAssets(),
    ...input,
  });
}

describe("assertFrameworkManifestShape", () => {
  it("accepts generated framework manifests", () => {
    expect(() =>
      assertFrameworkManifestShape(createMinimalBuildOutput(), "manifest"),
    ).not.toThrow();
  });

  it("reports framework manifest shape errors with source paths", () => {
    expect(() =>
      assertFrameworkManifestShape(
        { ...createMinimalBuildOutput(), runtime: null },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.runtime must be an object.");

    expect(() =>
      assertFrameworkManifestShape(
        { ...createMinimalBuildOutput(), buildId: "" },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.buildId must be a non-empty string.");

    expect(() =>
      assertFrameworkManifestShape(
        { ...createMinimalBuildOutput(), buildId: "build.1" },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.buildId must contain only letters, numbers, underscores, or hyphens.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        { ...createMinimalBuildOutput(), distDir: "" },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.distDir must be a non-empty string.");

    expect(() =>
      assertFrameworkManifestShape(
        { ...createMinimalBuildOutput(), publicPath: "" },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.publicPath must be a non-empty string.");

    expect(() =>
      assertFrameworkManifestShape(
        { ...createMinimalBuildOutput(), publicPath: { mode: "asset" } },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.publicPath must be a non-empty string.");

    expect(() =>
      assertFrameworkManifestShape(
        { ...createMinimalBuildOutput(), paths: [] },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.paths must be an object.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          paths: { rootDir: "", publicDir: "dist/client" },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.paths.rootDir must be a non-empty string.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          paths: { rootDir: "dist", publicDir: " dist/client " },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.paths.publicDir must not contain leading or trailing whitespace.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          paths: {
            rootDir: "dist",
            publicDir: "dist/client",
            serverDir: "",
          },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.paths.serverDir must be a non-empty string.");

    expect(() =>
      assertFrameworkManifestShape(
        { ...createMinimalBuildOutput(), assets: [] },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.assets must be an object.");

    expect(() =>
      assertFrameworkManifestShape(
        { ...createMinimalBuildOutput(), assets: { main: [] } },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.assets.main must be an object.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          apps: {
            default: {
              assets: { js: [], css: [] },
              document: { fileName: "/index.html" },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.apps.default.document.fileName must be a relative output file path.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          assets: { "main.entry": { js: [], css: [] } },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.assets key "main.entry" must contain only letters, numbers, underscores, or hyphens.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          assets: { main: { js: "main.js", css: [] } },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.assets.main.js must be an array.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          assets: { main: { js: [" main.js "], css: [] } },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.assets.main.js item " main.js " must not contain leading or trailing whitespace.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          apps: { default: [] },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.apps.default must be an object.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          apps: {
            "admin.app": {
              assets: { js: [], css: [] },
              module: { type: "lifecycle", href: "admin.js" },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.apps key "admin.app" must contain only letters, numbers, underscores, or hyphens.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          apps: { default: { assets: { js: null, css: [] } } },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.apps.default.assets.js must be an array.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          apps: { default: { assets: { js: [], css: [] }, module: null } },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.apps.default.module must be an object.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          apps: {
            default: {
              assets: { js: [], css: [] },
              module: { type: "worker", href: "app.js" },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.apps.default.module.type must be "entry", "lifecycle", or "react-component".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          apps: {
            default: {
              assets: { js: [], css: [] },
              module: { type: "lifecycle", href: "" },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.apps.default.module.href must be a non-empty string.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: { home: { assets: { js: [], css: [""] } } },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.pages.home.assets.css must contain only non-empty strings.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            home: {
              assets: { js: [], css: [] },
              module: { type: "lifecycle", href: " home.js " },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.pages.home.module.href must not contain leading or trailing whitespace.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            home: {
              assets: { js: [], css: [] },
              module: {
                type: "lifecycle",
                href: "home.js",
                source: "",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.pages.home.module.source must be a non-empty string.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            home: {
              assets: { js: [], css: [] },
              render: "spa",
              rendering: {
                component: "client",
                html: "client",
                streaming: false,
                hydrate: "load",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.home.render must be "csr", "ssr", or "ssg".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            home: {
              assets: { js: [], css: [] },
              render: "ssr",
              rendering: null,
            },
          },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.pages.home.rendering must be an object.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            home: {
              assets: { js: [], css: [] },
              render: "ssr",
              rendering: {
                component: "worker",
                html: "server",
                streaming: false,
                hydrate: "load",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.home.rendering.component must be "client", "server", or "rsc".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            home: {
              assets: { js: [], css: [] },
              render: "ssr",
              rendering: {
                component: "server",
                html: "stream",
                streaming: false,
                hydrate: "load",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.home.rendering.html must be "client", "server", "static", or "partial".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            home: {
              assets: { js: [], css: [] },
              render: "ssr",
              rendering: {
                component: "server",
                html: "server",
                prerender: "incremental",
                streaming: false,
                hydrate: "load",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.home.rendering.prerender must be "full" or "partial".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            home: {
              assets: { js: [], css: [] },
              render: "ssr",
              rendering: {
                component: "server",
                html: "server",
                streaming: "yes",
                hydrate: "load",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.pages.home.rendering.streaming must be a boolean.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            home: {
              assets: { js: [], css: [] },
              render: "ssr",
              rendering: {
                component: "server",
                html: "server",
                streaming: false,
                hydrate: "viewport",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.home.rendering.hydrate must be "none", "load", "visible", or "idle".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            home: {
              assets: { js: [], css: [] },
              render: "ssr",
              componentModel: "server",
              rendering: {
                component: "server",
                html: "server",
                streaming: false,
                hydrate: "load",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.home.componentModel must be "client" or "rsc".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            home: {
              assets: { js: [], css: [] },
              render: "ssr",
              hydrate: "viewport",
              rendering: {
                component: "server",
                html: "server",
                streaming: false,
                hydrate: "load",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.home.hydrate must be "none", "load", "visible", or "idle".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            insights: {
              assets: { js: [], css: [] },
              render: "ssr",
              rendering: {
                component: "rsc",
                html: "server",
                streaming: true,
                hydrate: "none",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.insights.componentModel must be "rsc" when manifest.pages.insights.rendering.component is "rsc".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            insights: {
              assets: { js: [], css: [] },
              render: "ssr",
              componentModel: "rsc",
              rendering: {
                component: "server",
                html: "server",
                streaming: true,
                hydrate: "none",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.insights.rendering.component must be "rsc" when manifest.pages.insights.componentModel is "rsc".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            insights: {
              assets: { js: [], css: [] },
              render: "ssg",
              componentModel: "rsc",
              rendering: {
                component: "rsc",
                html: "server",
                streaming: true,
                hydrate: "none",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.insights.render must be "ssr" for RSC pages.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            insights: {
              assets: { js: [], css: [] },
              render: "ssr",
              componentModel: "rsc",
              rendering: {
                component: "rsc",
                html: "server",
                streaming: true,
                hydrate: "load",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.insights.rendering.hydrate must be "none" for RSC pages.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            insights: {
              assets: { js: [], css: [] },
              render: "ssr",
              componentModel: "rsc",
              hydrate: "load",
              rendering: {
                component: "rsc",
                html: "server",
                streaming: true,
                hydrate: "none",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.insights.hydrate must be "none" for RSC pages.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: { home: { assets: { js: [], css: [] }, path: "home" } },
        },
        "manifest",
      ),
    ).toThrow('[evjs] manifest.pages.home.path must start with "/".');

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            "dash.board": {
              assets: { js: [], css: [] },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages key "dash.board" must contain only letters, numbers, underscores, or hyphens.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            campaign: {
              assets: { js: [], css: [] },
              ppr: {
                delivery: "stream",
                shell: { js: "campaign-ppr-shell.js", css: [] },
                regions: {},
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.pages.campaign.ppr.shell.js must be an array.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            campaign: {
              assets: { js: [], css: [] },
              ppr: {
                delivery: "stream",
                shell: { js: [], css: [] },
                regions: [],
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.pages.campaign.ppr.regions must be an object.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            campaign: {
              assets: { js: [], css: [] },
              ppr: {
                delivery: "stream",
                shell: { js: [], css: [] },
                regions: {
                  "hero.v1": {
                    assets: { js: [], css: [] },
                  },
                },
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.campaign.ppr.regions key "hero.v1" must contain only letters, numbers, underscores, or hyphens.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            campaign: {
              assets: { js: [], css: [] },
              ppr: {
                delivery: "stream",
                shell: { js: [], css: [] },
                regions: {
                  offer: {
                    id: "offer",
                    assets: { js: [], css: [""] },
                  },
                },
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.pages.campaign.ppr.regions.offer.assets.css must contain only non-empty strings.",
    );

    const pprPage = (extra: Record<string, unknown> = {}) => ({
      assets: { js: [], css: [] },
      render: "ssr",
      rendering: {
        component: "server",
        html: "partial",
        prerender: "partial",
        streaming: false,
        hydrate: "none",
      },
      ppr: {
        delivery: "merge",
        shell: { js: [], css: [] },
        regions: {
          offer: {
            id: "offer",
            assets: { js: [], css: [] },
            cache: "no-store",
            hydrate: "visible",
          },
        },
      },
      ...extra,
    });

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            campaign: pprPage({
              ppr: {
                delivery: "flush",
                shell: { js: [], css: [] },
                regions: {},
              },
            }),
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.campaign.ppr.delivery must be "merge" or "stream".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            campaign: pprPage({
              ppr: {
                delivery: "merge",
                shell: { js: [], css: [] },
                regions: {
                  offer: {
                    id: "deal",
                    assets: { js: [], css: [] },
                  },
                },
              },
            }),
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.campaign.ppr.regions.offer.id must match region key "offer".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            campaign: pprPage({
              ppr: {
                delivery: "merge",
                shell: { js: [], css: [] },
                regions: {
                  offer: {
                    id: "offer",
                    assets: { js: [], css: [] },
                    cache: { revalidate: 0 },
                  },
                },
              },
            }),
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.pages.campaign.ppr.regions.offer.cache.revalidate must be a positive integer number of seconds.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            campaign: pprPage({
              ppr: {
                delivery: "merge",
                shell: { js: [], css: [] },
                regions: {
                  offer: {
                    id: "offer",
                    assets: { js: [], css: [] },
                    hydrate: "soon",
                  },
                },
              },
            }),
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.campaign.ppr.regions.offer.hydrate must be "none", "load", "visible", or "idle".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            campaign: pprPage({ render: "ssg" }),
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.campaign.render must be "ssr" for PPR pages.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            campaign: pprPage({
              rendering: {
                component: "server",
                html: "server",
                prerender: "partial",
                streaming: false,
                hydrate: "none",
              },
            }),
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.campaign.rendering.html must be "partial" for PPR pages.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            campaign: pprPage({
              ppr: {
                delivery: "stream",
                shell: { js: [], css: [] },
                regions: {},
              },
            }),
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.campaign.rendering.streaming must be true when manifest.pages.campaign.ppr.delivery is "stream".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            campaign: pprPage({ hydrate: "load" }),
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.campaign.hydrate must be "none" for PPR pages.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            campaign: pprPage({ componentModel: "rsc" }),
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.pages.campaign.ppr is not supported for RSC pages.",
    );

    const pprReferenceManifest = {
      ...createMinimalBuildOutput(),
      pages: {
        campaign: {
          assets: { js: [], css: [] },
          render: "ssr",
          rendering: {
            component: "server",
            html: "partial",
            prerender: "partial",
            streaming: false,
            hydrate: "none",
          },
          ppr: {
            delivery: "merge",
            shell: { js: [], css: [] },
            regions: {
              offer: {
                id: "offer",
                assets: { js: [], css: [] },
              },
            },
          },
        },
      },
      server: {
        assets: { js: [], css: [] },
        functions: {},
        routes: [],
      },
    };

    expect(() =>
      assertFrameworkManifestShape(pprReferenceManifest, "manifest"),
    ).toThrow(
      "[evjs] manifest.pages.campaign.ppr requires manifest.server.renderers for PPR server renderer references.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...pprReferenceManifest,
          server: {
            assets: { js: [], css: [] },
            renderers: {
              "campaign-ppr-shell": {
                kind: "ppr-shell",
                owner: { pageId: "campaign" },
                module: "./src/pages/Campaign.tsx",
                assets: { js: [], css: [] },
              },
            },
            functions: {},
            routes: [],
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.campaign.ppr.regions.offer requires a ppr-region manifest.server.renderers entry owned by page "campaign" region "offer".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...pprReferenceManifest,
          server: {
            assets: { js: [], css: [] },
            renderers: {
              "campaign-offer-ppr-region": {
                kind: "ppr-region",
                owner: { pageId: "campaign", regionId: "offer" },
                module: "./src/pages/Offer.region.tsx",
                assets: { js: [], css: [] },
              },
            },
            functions: {},
            routes: [],
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.campaign.ppr.shell requires a ppr-shell manifest.server.renderers entry owned by page "campaign".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          runtime: { server: { fn: "/__evjs/fn" } },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.runtime.server.basePath must be a non-empty pathname.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          routes: [null],
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.routes[0] must be an object.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          routes: [{ id: "", path: "/home" }],
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.routes[0].id must be a non-empty string.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          routes: [{ id: " home", path: "/home" }],
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.routes[0].id must not contain leading or trailing whitespace.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          routes: [{ id: "home", path: "home" }],
        },
        "manifest",
      ),
    ).toThrow('[evjs] manifest.routes[0].path must start with "/".');

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          routes: [
            { id: "home", path: "/home" },
            { id: "home", path: "/about" },
          ],
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.routes[1].id duplicates manifest.routes[0].id "home". Route ids must be unique.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          routes: [{ id: "user", path: "/users/:__proto__" }],
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.routes[0].path uses reserved dynamic param name "__proto__" in segment ":__proto__". Use a safe application-specific name.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          routes: [
            { id: "home", path: "/home" },
            { id: "home_trailing", path: "/home/" },
          ],
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.routes[1].path duplicates manifest.routes[0].path "/home". Page route paths must be unique.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          routes: [
            { id: "userById", path: "/users/$id" },
            { id: "userByUserId", path: "/users/$userId" },
          ],
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.routes[1].path has the same route shape as manifest.routes[0].path "/users/$id". Use one page route per URL shape.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            home: {
              assets: { js: [], css: [] },
              render: "csr",
              rendering: {
                component: "client",
                html: "client",
                streaming: false,
                hydrate: "load",
              },
            },
          },
          routes: [{ id: "home", path: "/home", pageId: " home" }],
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.routes[0].pageId must not contain leading or trailing whitespace.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          apps: {
            default: {
              assets: { js: [], css: [] },
            },
          },
          routes: [{ id: "home", path: "/home", appId: "default " }],
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.routes[0].appId must not contain leading or trailing whitespace.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          routes: [{ id: "home", path: "/home", pageId: "home" }],
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.routes[0].pageId "home" does not match any manifest.pages entry.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          routes: [{ id: "home", path: "/home", appId: "default" }],
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.routes[0].appId "default" does not match any manifest.apps entry.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          routes: [
            {
              id: "home",
              path: "/home",
              module: " ./src/pages/Home.tsx ",
            },
          ],
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.routes[0].module must not contain leading or trailing whitespace.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          routes: [{ id: "home", path: "/home", render: "spa" }],
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.routes[0].render must be "csr", "ssr", or "ssg".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          routes: [{ id: "home", path: "/home", hydrate: "hover" }],
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.routes[0].hydrate must be "none", "load", "visible", or "idle".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          routes: [{ id: "home", path: "/home", runtime: "worker" }],
        },
        "manifest",
      ),
    ).toThrow('[evjs] manifest.routes[0].runtime must be "node" or "edge".');

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            home: {
              assets: { js: [], css: [] },
              render: "csr",
              rendering: {
                component: "client",
                html: "client",
                streaming: false,
                hydrate: "load",
              },
              path: "/actual-home",
            },
          },
          routes: [{ id: "home", path: "/home", pageId: "home" }],
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.routes[0].path "/home" must match manifest.pages.home.path "/actual-home".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          pages: {
            home: {
              assets: { js: [], css: [] },
              render: "csr",
              rendering: {
                component: "client",
                html: "client",
                streaming: false,
                hydrate: "load",
              },
              path: "/home",
            },
          },
          routes: [
            { id: "home", path: "/home", pageId: "home", render: "ssr" },
          ],
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.routes[0].render must match manifest.pages.home.render "csr".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [" server.js "], css: [] },
            functions: {},
            routes: [],
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.server.assets.js item " server.js " must not contain leading or trailing whitespace.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            entry: " server.js ",
            assets: { js: [], css: [] },
            functions: {},
            routes: [],
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.server.entry must not contain leading or trailing whitespace.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            renderers: {
              dashboard: {
                kind: "worker",
                module: "./src/pages/Dashboard.tsx",
                assets: { js: [], css: [] },
              },
            },
            functions: {},
            routes: [],
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.server.renderers.dashboard.kind must be "page-server", "rsc-page", "ppr-shell", or "ppr-region".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            renderers: {
              "dashboard.server": {
                kind: "page-server",
                module: "./src/pages/Dashboard.tsx",
                assets: { js: [], css: [] },
              },
            },
            functions: {},
            routes: [],
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.server.renderers key "dashboard.server" must contain only letters, numbers, underscores, or hyphens.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            renderers: {
              dashboard: {
                kind: "page-server",
                module: "",
                assets: { js: [], css: [] },
              },
            },
            functions: {},
            routes: [],
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.server.renderers.dashboard.module must be a non-empty string.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            renderers: {
              dashboard: {
                kind: "page-server",
                module: "./src/pages/Dashboard.tsx",
                assets: { js: null, css: [] },
              },
            },
            functions: {},
            routes: [],
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.server.renderers.dashboard.assets.js must be an array.",
    );

    const page = (extra: Record<string, unknown> = {}) => ({
      assets: { js: [], css: [] },
      render: "ssr",
      rendering: {
        component: "server",
        html: "server",
        streaming: false,
        hydrate: "load",
      },
      ...extra,
    });
    const clientPage = () =>
      page({
        render: "csr",
        rendering: {
          component: "client",
          html: "client",
          streaming: false,
          hydrate: "load",
        },
      });
    const pageServerReferenceManifest = {
      ...createMinimalBuildOutput(),
      pages: {
        dashboard: page(),
        settings: clientPage(),
      },
      routes: [
        {
          id: "dashboard",
          path: "/dashboard",
          pageId: "dashboard",
        },
        {
          id: "settings",
          path: "/settings",
          pageId: "settings",
        },
      ],
      server: {
        assets: { js: [], css: [] },
        functions: {},
        routes: [],
      },
    };
    const rendererOwnerManifest = {
      ...createMinimalBuildOutput(),
      pages: {
        dashboard: page(),
        settings: page(),
        campaign: page({
          hydrate: "none",
          rendering: {
            component: "server",
            html: "partial",
            prerender: "partial",
            streaming: false,
            hydrate: "none",
          },
          ppr: {
            delivery: "merge",
            shell: { js: [], css: [] },
            regions: {
              hero: {
                id: "hero",
                assets: { js: [], css: [] },
              },
            },
          },
        }),
      },
      routes: [
        {
          id: "dashboard",
          path: "/dashboard",
          pageId: "dashboard",
        },
      ],
    };
    const server = (renderer: Record<string, unknown>) => ({
      assets: { js: [], css: [] },
      renderers: {
        dashboard: {
          kind: "page-server",
          module: "./src/pages/Dashboard.tsx",
          assets: { js: [], css: [] },
          ...renderer,
        },
      },
      functions: {},
      routes: [],
    });

    expect(() =>
      assertFrameworkManifestShape(pageServerReferenceManifest, "manifest"),
    ).toThrow(
      "[evjs] manifest.pages.dashboard requires manifest.server.renderers for page-server renderer references.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...pageServerReferenceManifest,
          server: {
            assets: { js: [], css: [] },
            renderers: {
              "settings-server": {
                kind: "page-server",
                owner: { pageId: "settings" },
                module: "./src/pages/Settings.tsx",
                assets: { js: [], css: [] },
              },
            },
            functions: {},
            routes: [],
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.pages.dashboard requires a page-server manifest.server.renderers entry owned by page "dashboard" or one of its routes.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...pageServerReferenceManifest,
          server: {
            assets: { js: [], css: [] },
            renderers: {
              "dashboard-route-server": {
                kind: "page-server",
                owner: { routeId: "dashboard" },
                module: "./src/pages/Dashboard.tsx",
                assets: { js: [], css: [] },
              },
            },
            functions: {},
            routes: [],
          },
        },
        "manifest",
      ),
    ).not.toThrow();

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...rendererOwnerManifest,
          server: server({ owner: { pageId: "missing" } }),
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.server.renderers.dashboard.owner.pageId "missing" does not match any manifest.pages entry.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...rendererOwnerManifest,
          server: server({ owner: { routeId: "missing" } }),
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.server.renderers.dashboard.owner.routeId "missing" does not match any manifest.routes entry.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...rendererOwnerManifest,
          server: server({
            owner: { pageId: "settings", routeId: "dashboard" },
          }),
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.server.renderers.dashboard.owner.routeId "dashboard" points to route pageId "dashboard", not owner.pageId "settings".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...rendererOwnerManifest,
          server: server({ owner: { appId: "admin" } }),
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.server.renderers.dashboard.owner.appId is not supported for server renderers. Use pageId, routeId, or regionId.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...rendererOwnerManifest,
          server: server({
            kind: "ppr-region",
            owner: { pageId: "campaign", regionId: "missing" },
          }),
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.server.renderers.dashboard.owner.regionId "missing" does not match any manifest.pages.campaign.ppr.regions entry.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...rendererOwnerManifest,
          server: server({ kind: "ppr-region" }),
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.server.renderers.dashboard.owner is required for ppr-region renderers.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            functions: {
              "fn:refund": {
                module: "./src/api/orders.server.ts",
                exportName: "refund",
                assets: { js: [], css: [] },
              },
            },
            routes: [],
          },
        },
        "manifest",
      ),
    ).not.toThrow();

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            functions: {
              "": {
                module: "./src/api/user.server.ts",
                exportName: "getUser",
                assets: { js: [], css: [] },
              },
            },
            routes: [],
          },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.server.functions must not contain empty keys.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            functions: {
              " getUser": {
                module: "./src/api/user.server.ts",
                exportName: "getUser",
                assets: { js: [], css: [] },
              },
            },
            routes: [],
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.server.functions key " getUser" must be a non-empty string without leading or trailing whitespace.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            functions: {
              getUser: {
                module: "",
                exportName: "getUser",
                assets: { js: [], css: [] },
              },
            },
            routes: [],
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.server.functions.getUser.module must be a non-empty string.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            functions: {
              getUser: {
                module: "./src/api/user.server.ts",
                exportName: "",
                assets: { js: [], css: [] },
              },
            },
            routes: [],
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.server.functions.getUser.exportName must be a non-empty string.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            functions: {
              getUser: {
                module: "./src/api/user.server.ts",
                exportName: "getUser",
                assets: { js: [], css: [""] },
              },
            },
            routes: [],
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.server.functions.getUser.assets.css must contain only non-empty strings.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            functions: {},
            routes: [
              {
                path: "/api/health",
                methods: ["GET"],
                assets: { js: "route.js", css: [] },
              },
            ],
          },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.server.routes[0].assets.js must be an array.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            functions: {},
            routes: [
              {
                path: "api/health",
                methods: ["GET"],
                assets: { js: [], css: [] },
              },
            ],
          },
        },
        "manifest",
      ),
    ).toThrow('[evjs] manifest.server.routes[0].path must start with "/".');

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            functions: {},
            routes: [
              {
                path: "/api/users/:__proto__",
                methods: ["GET"],
                assets: { js: [], css: [] },
              },
            ],
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.server.routes[0].path uses reserved dynamic param name "__proto__" in segment ":__proto__". Use a safe application-specific name.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            functions: {},
            routes: [
              {
                path: "/api/users",
                methods: ["GET"],
                assets: { js: [], css: [] },
              },
              {
                path: "/api/users",
                methods: ["POST"],
                assets: { js: [], css: [] },
              },
            ],
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.server.routes[1].path duplicates manifest.server.routes[0].path "/api/users". Server route paths must be unique.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            functions: {},
            routes: [
              {
                path: "/api/users/:id",
                methods: ["GET"],
                assets: { js: [], css: [] },
              },
              {
                path: "/api/users/:userId",
                methods: ["GET"],
                assets: { js: [], css: [] },
              },
            ],
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.server.routes[1].path has the same route shape as manifest.server.routes[0].path "/api/users/:id". Use one server route per URL shape.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            functions: {},
            routes: [
              {
                path: "/api/health",
                methods: "GET",
                assets: { js: [], css: [] },
              },
            ],
          },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.server.routes[0].methods must be an array.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            functions: {},
            routes: [
              {
                path: "/api/health",
                methods: [],
                assets: { js: [], css: [] },
              },
            ],
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.server.routes[0].methods must contain at least one HTTP method.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            functions: {},
            routes: [
              {
                path: "/api/health",
                methods: ["get"],
                assets: { js: [], css: [] },
              },
            ],
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.server.routes[0].methods item "get" is not a supported HTTP method. Supported methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          server: {
            assets: { js: [], css: [] },
            functions: {},
            routes: [
              {
                path: "/api/health",
                methods: ["GET", "GET"],
                assets: { js: [], css: [] },
              },
            ],
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.server.routes[0].methods must not contain duplicate method "GET".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          runtime: {
            server: {
              basePath: "/__evjs",
              fn: "__evjs/fn",
            },
          },
        },
        "manifest",
      ),
    ).toThrow('[evjs] manifest.runtime.server.fn must start with "/".');

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          runtime: {
            server: {
              basePath: "/__evjs",
              fn: "/__evjs/fn",
              ppr: " /__evjs/ppr ",
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.runtime.server.ppr must not contain leading or trailing whitespace.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          runtime: {
            server: {
              basePath: "/__evjs",
              fn: "/__evjs/fn",
            },
            transport: [],
          },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.runtime.transport must be an object.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          runtime: {
            server: {
              basePath: "/__evjs",
              fn: "/__evjs/fn",
            },
            transport: { baseUrl: "" },
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.runtime.transport.baseUrl must be a non-empty URL string.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          runtime: {
            server: {
              basePath: "/__evjs",
              fn: "/__evjs/fn",
            },
            transport: { baseUrl: "https://api.example.com " },
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.runtime.transport.baseUrl must not contain leading or trailing whitespace.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          runtime: {
            server: {
              basePath: "/__evjs",
              fn: "/__evjs/fn",
            },
            transport: { baseUrl: "http://[::1" },
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.runtime.transport.baseUrl must be a valid URL string.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          rsc: {
            endpoint: "/__evjs/rsc",
            pages: [],
          },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.rsc.pages must be an object.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          rsc: {
            endpoint: "/__evjs/rsc",
            pages: {
              insights: [],
            },
          },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.rsc.pages.insights must be an object.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          rsc: {
            endpoint: "/__evjs/rsc",
            pages: {
              insights: {
                renderer: "insights-rsc",
                assets: { js: [], css: [" insights.css "] },
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.rsc.pages.insights.assets.css item " insights.css " must not contain leading or trailing whitespace.',
    );

    const rscPage = () => ({
      assets: { js: [], css: [] },
      render: "ssr",
      componentModel: "rsc",
      rendering: {
        component: "rsc",
        html: "server",
        streaming: true,
        hydrate: "none",
      },
    });
    const rscReferenceManifest = {
      ...createMinimalBuildOutput(),
      pages: {
        dashboard: page(),
        insights: rscPage(),
      },
      routes: [
        {
          id: "dashboard",
          path: "/dashboard",
          pageId: "dashboard",
        },
        {
          id: "insights",
          path: "/insights",
          pageId: "insights",
        },
      ],
      server: {
        assets: { js: [], css: [] },
        renderers: {
          "insights-rsc": {
            kind: "rsc-page",
            owner: { pageId: "insights" },
            module: "./src/pages/Insights.tsx",
            assets: { js: [], css: [] },
          },
          "insights-page": {
            kind: "page-server",
            owner: { pageId: "insights" },
            module: "./src/pages/Insights.tsx",
            assets: { js: [], css: [] },
          },
          "dashboard-page": {
            kind: "page-server",
            owner: { pageId: "dashboard" },
            module: "./src/pages/Dashboard.tsx",
            assets: { js: [], css: [] },
          },
        },
        functions: {},
        routes: [],
      },
    };
    const rsc = (page: Record<string, unknown>) => ({
      endpoint: "/__evjs/rsc",
      pages: {
        insights: {
          renderer: "insights-rsc",
          assets: { js: [], css: [] },
          ...page,
        },
      },
    });

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          rsc: {
            endpoint: "/__evjs/rsc",
            clientReferences: {
              "src/pages/Client.tsx#default": {
                module: "src/pages/Client.tsx",
                exportName: "default",
              },
            },
            serverReferences: {
              "fn:saveInsight": {
                module: "src/actions.ts",
                exportName: "saveInsight",
              },
            },
            clientReferenceManifest: {},
            serverConsumerManifest: {},
          },
        },
        "manifest",
      ),
    ).not.toThrow();

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          rsc: {
            clientReferences: {
              "src/pages/Client.tsx#default": {
                module: "src/pages/Client.tsx",
                exportName: "default",
              },
            },
          },
        },
        "manifest",
      ),
    ).not.toThrow();

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          rsc: {
            endpoint: "/__evjs/rsc",
            clientReferences: [],
          },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.rsc.clientReferences must be an object.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          rsc: {
            endpoint: "/__evjs/rsc",
            clientReferences: {
              " src/pages/Client.tsx#default": {
                module: "src/pages/Client.tsx",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.rsc.clientReferences key " src/pages/Client.tsx#default" must not contain leading or trailing whitespace.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          rsc: {
            endpoint: "/__evjs/rsc",
            clientReferences: {
              "src/pages/Client.tsx#default": [],
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.rsc.clientReferences.src/pages/Client.tsx#default must be an object.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          rsc: {
            endpoint: "/__evjs/rsc",
            clientReferences: {
              "src/pages/Client.tsx#default": {
                module: " src/pages/Client.tsx ",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.rsc.clientReferences.src/pages/Client.tsx#default.module must not contain leading or trailing whitespace.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          rsc: {
            endpoint: "/__evjs/rsc",
            serverReferences: {
              "fn:saveInsight": {
                module: "src/actions.ts",
                exportName: "",
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.rsc.serverReferences.fn:saveInsight.exportName must be a non-empty string.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          rsc: {
            endpoint: "/__evjs/rsc",
            clientReferenceManifest: [],
          },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.rsc.clientReferenceManifest must be an object.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...createMinimalBuildOutput(),
          rsc: {
            endpoint: "/__evjs/rsc",
            serverConsumerManifest: [],
          },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.rsc.serverConsumerManifest must be an object.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...rscReferenceManifest,
          rsc: {
            pages: {
              insights: {
                renderer: "insights-rsc",
                assets: { js: [], css: [] },
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow("[evjs] manifest.rsc.endpoint must be a non-empty pathname.");

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...rscReferenceManifest,
          rsc: {
            endpoint: "/__evjs/rsc",
            pages: {
              missing: {
                assets: { js: [], css: [] },
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.rsc.pages.missing does not match any manifest.pages entry.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...rscReferenceManifest,
          rsc: {
            endpoint: "/__evjs/rsc",
            pages: {
              dashboard: {
                assets: { js: [], css: [] },
              },
            },
          },
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.rsc.pages.dashboard requires manifest.pages.dashboard.componentModel to be "rsc".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...rscReferenceManifest,
          rsc: rsc({ renderer: "missing-rsc" }),
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.rsc.pages.insights.renderer "missing-rsc" does not match any manifest.server.renderers entry.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...rscReferenceManifest,
          rsc: rsc({ renderer: undefined }),
        },
        "manifest",
      ),
    ).toThrow(
      "[evjs] manifest.rsc.pages.insights.renderer must be a non-empty string.",
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...rscReferenceManifest,
          rsc: rsc({ renderer: "insights-page" }),
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.rsc.pages.insights.renderer "insights-page" must reference an rsc-page server renderer.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...rscReferenceManifest,
          server: {
            ...rscReferenceManifest.server,
            renderers: {
              ...rscReferenceManifest.server.renderers,
              "insights-rsc": {
                kind: "rsc-page",
                module: "./src/pages/Insights.tsx",
                assets: { js: [], css: [] },
              },
            },
          },
          rsc: rsc({}),
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.rsc.pages.insights.renderer must reference an rsc-page manifest.server.renderers entry owned by page "insights".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...rscReferenceManifest,
          server: {
            ...rscReferenceManifest.server,
            renderers: {
              ...rscReferenceManifest.server.renderers,
              "insights-rsc": {
                kind: "rsc-page",
                owner: { pageId: "dashboard" },
                module: "./src/pages/Insights.tsx",
                assets: { js: [], css: [] },
              },
            },
          },
          rsc: rsc({}),
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.rsc.pages.insights.renderer must reference an rsc-page manifest.server.renderers entry owned by page "insights".',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...rscReferenceManifest,
          rsc: rsc({ routeId: "missing" }),
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.rsc.pages.insights.routeId "missing" does not match any manifest.routes entry.',
    );

    expect(() =>
      assertFrameworkManifestShape(
        {
          ...rscReferenceManifest,
          rsc: rsc({ routeId: "dashboard" }),
        },
        "manifest",
      ),
    ).toThrow(
      '[evjs] manifest.rsc.pages.insights.routeId "dashboard" points to route pageId "dashboard", not RSC page "insights".',
    );
  });
});

describe("linkBuildOutput", () => {
  it("links metadata-only RSC references without requiring a Flight endpoint", () => {
    const graph: AppGraph = {
      version: 1,
      rootDir: "/repo",
      apps: {},
      pages: {},
      routes: [],
      serverFunctions: [],
      serverRoutes: [],
      clientReferences: [
        {
          id: "src/pages/Client.tsx#default",
          module: "src/pages/Client.tsx",
          exportName: "default",
        },
      ],
    };
    const plan: BuildPlan = {
      version: 1,
      buildId: "build",
      mode: "production",
      distDir: "dist",
      output: { clientDir: "dist/client", serverDir: "dist/server" },
      entries: [createServerRuntimeEntry()],
      html: [],
      server: createServerPlan(),
      runtime: createRuntimePlan(),
    };

    const output = linkBuildOutput({ graph, plan });

    expect(output.rsc).toEqual({
      endpoint: undefined,
      pages: undefined,
      clientReferences: {
        "src/pages/Client.tsx#default": {
          module: "src/pages/Client.tsx",
          exportName: "default",
        },
      },
      serverReferences: undefined,
      clientReferenceManifest: undefined,
      serverConsumerManifest: undefined,
    });
    expect(() =>
      assertFrameworkManifestShape(output, "manifest"),
    ).not.toThrow();
  });

  it("links app runtime modules only when the client entry produced JavaScript", () => {
    const graph: AppGraph = {
      version: 1,
      rootDir: "/repo",
      apps: {
        admin: {
          id: "admin",
          entry: "./src/main.tsx",
          html: "./index.html",
        },
      },
      pages: {},
      routes: [],
      serverFunctions: [],
      serverRoutes: [],
    };
    const plan: BuildPlan = {
      version: 1,
      buildId: "build",
      mode: "production",
      distDir: "dist",
      output: { clientDir: "dist/client", serverDir: "dist/server" },
      entries: [
        createServerRuntimeEntry(),
        {
          name: "admin",
          import: "./src/main.tsx",
          environment: "client",
          runtime: "browser",
          kind: "app-client",
          owner: { appId: "admin" },
        },
      ],
      html: [
        {
          id: "admin",
          template: "./index.html",
          fileName: "admin.html",
          owner: { appId: "admin" },
        },
      ],
      server: createServerPlan(),
      runtime: createRuntimePlan(),
    };

    const output = linkBuildOutput({
      graph,
      plan,
      clientEntryAssets: {
        admin: { js: ["admin.js"], css: ["admin.css"] },
      },
    });
    expect(output.apps.admin.module).toEqual({
      type: "entry",
      href: "admin.js",
      source: "./src/main.tsx",
    });
    expect(output.apps.admin.document).toEqual({ fileName: "admin.html" });

    expect(() =>
      linkBuildOutput({
        graph,
        plan,
        clientEntryAssets: {
          admin: { js: [], css: ["admin.css"] },
        },
      }),
    ).toThrow(
      '[evjs] App "admin" did not produce a client JavaScript asset for build entry "admin".',
    );
  });

  it("fails when a page runtime module has no client JavaScript asset", () => {
    const graph: AppGraph = {
      version: 1,
      rootDir: "/repo",
      apps: {},
      pages: {
        home: {
          id: "home",
          component: "./src/Home.tsx",
          html: "./index.html",
          render: "csr",
        },
      },
      routes: [],
      serverFunctions: [],
      serverRoutes: [],
    };
    const plan: BuildPlan = {
      version: 1,
      buildId: "build",
      mode: "production",
      distDir: "dist",
      output: { clientDir: "dist/client", serverDir: "dist/server" },
      entries: [
        createServerRuntimeEntry(),
        {
          name: "home",
          import: "./src/Home.tsx",
          environment: "client",
          runtime: "browser",
          kind: "page-client",
          owner: { pageId: "home" },
        },
      ],
      html: [
        {
          id: "home",
          template: "./index.html",
          fileName: "home.html",
          owner: { pageId: "home" },
        },
      ],
      server: createServerPlan(),
      runtime: createRuntimePlan(),
    };

    expect(() =>
      linkBuildOutput({
        graph,
        plan,
        clientEntryAssets: {
          home: { js: [], css: ["home.css"] },
        },
      }),
    ).toThrow(
      '[evjs] Page "home" did not produce a client JavaScript asset for build entry "home".',
    );
  });

  it("links server runtime output only when the server entry produced JavaScript", () => {
    const graph: AppGraph = {
      version: 1,
      rootDir: "/repo",
      apps: {},
      pages: {},
      routes: [],
      serverFunctions: [],
      serverRoutes: [],
    };
    const plan: BuildPlan = {
      version: 1,
      buildId: "build",
      mode: "production",
      distDir: "dist",
      output: { clientDir: "dist/client", serverDir: "dist/server" },
      entries: [
        {
          name: "server",
          import: "@evjs/ev/internal/server/fetch",
          environment: "server",
          runtime: "node",
          kind: "server-runtime",
        },
      ],
      html: [],
      server: createServerPlan(),
      runtime: createRuntimePlan(),
    };

    const output = linkBuildOutput({
      graph,
      plan,
      serverEntryAssets: {
        server: { js: ["server.js"], css: ["server.css"] },
      },
    });
    expect(output.server.entry).toBe("server.js");
    expect(output.server.assets).toEqual({
      js: ["server.js"],
      css: ["server.css"],
    });

    expect(() =>
      linkBuildOutput({
        graph,
        plan,
        serverEntryAssets: {
          server: { js: [], css: ["server.css"] },
        },
      }),
    ).toThrow(
      '[evjs] Server runtime entry "server" did not produce a server JavaScript asset.',
    );
  });

  it("marks non-partial prerendered server pages as full prerender output", () => {
    const graph: AppGraph = {
      version: 1,
      rootDir: "/repo",
      apps: {},
      pages: {
        article: {
          id: "article",
          component: "./src/Article.tsx",
          html: "./index.html",
          render: "ssr",
          hydrate: "none",
          prerender: true,
        },
      },
      routes: [],
      serverFunctions: [],
      serverRoutes: [],
    };
    const plan: BuildPlan = {
      version: 1,
      buildId: "build",
      mode: "production",
      distDir: "dist",
      output: { clientDir: "dist/client", serverDir: "dist/server" },
      entries: [
        {
          name: "server",
          import: "@evjs/ev/internal/server/fetch",
          environment: "server",
          runtime: "node",
          kind: "server-runtime",
        },
        {
          name: "article-server",
          import: "./src/Article.tsx",
          environment: "server",
          runtime: "node",
          kind: "page-server",
          owner: { pageId: "article" },
        },
      ],
      html: [
        {
          id: "article",
          template: "./index.html",
          fileName: "article.html",
          owner: { pageId: "article" },
        },
      ],
      server: createServerPlan([
        {
          name: "article-server",
          import: "./src/Article.tsx",
          kind: "page-server",
          owner: { pageId: "article" },
        },
      ]),
      runtime: createRuntimePlan(),
    };

    const output = linkBuildOutput({
      graph,
      plan,
      serverEntryAssets: {
        server: { js: ["server.js"], css: [] },
        "article-server": { js: ["article-server.js"], css: [] },
      },
    });

    expect(output.pages.article.rendering).toEqual({
      component: "server",
      html: "server",
      prerender: "full",
      streaming: false,
      hydrate: "none",
    });
    expect(output.pages.article.document).toEqual({
      fileName: "article.html",
    });
  });

  it("exposes PPR shell CSS through page assets", () => {
    const graph: AppGraph = {
      version: 1,
      rootDir: "/repo",
      apps: {},
      pages: {
        campaign: {
          id: "campaign",
          component: "./src/Campaign.tsx",
          html: "./index.html",
          render: "ssr",
          hydrate: "visible",
          prerender: { partial: true },
          ppr: {
            delivery: "merge",
            regions: {},
          },
        },
      },
      routes: [
        {
          id: "campaign",
          path: "/campaign",
          pageId: "campaign",
        },
      ],
      serverFunctions: [],
      serverRoutes: [],
    };
    const plan: BuildPlan = {
      version: 1,
      buildId: "build",
      mode: "production",
      distDir: "dist",
      output: { clientDir: "dist/client", serverDir: "dist/server" },
      entries: [
        {
          name: "server",
          import: "@evjs/ev/internal/server/fetch",
          environment: "server",
          runtime: "node",
          kind: "server-runtime",
        },
        {
          name: "campaign-ppr-shell",
          import: "./src/Campaign.tsx",
          environment: "server",
          runtime: "node",
          kind: "ppr-shell",
          owner: { pageId: "campaign" },
        },
      ],
      html: [
        {
          id: "campaign",
          template: "./index.html",
          fileName: "campaign.html",
          owner: { pageId: "campaign" },
        },
      ],
      server: createServerPlan([
        {
          name: "campaign-ppr-shell",
          import: "./src/Campaign.tsx",
          kind: "ppr-shell",
          owner: { pageId: "campaign" },
        },
      ]),
      runtime: createRuntimePlan({ ppr: "/__evjs/ppr" }),
    };

    const output = linkBuildOutput({
      graph,
      plan,
      serverEntryAssets: {
        server: { js: ["server.js"], css: [] },
        "campaign-ppr-shell": {
          js: ["campaign-ppr-shell.js"],
          css: ["campaign-ppr-shell.css"],
        },
      },
    });

    expect(output.pages.campaign.assets).toEqual({
      js: [],
      css: ["campaign-ppr-shell.css"],
    });
    expect(output.pages.campaign.ppr?.shell).toEqual({
      js: ["campaign-ppr-shell.js"],
      css: ["campaign-ppr-shell.css"],
    });
    expect(output.pages.campaign.rendering).toEqual({
      component: "server",
      html: "partial",
      prerender: "partial",
      streaming: false,
      hydrate: "none",
    });
    expect(() =>
      assertFrameworkManifestShape(output, "manifest"),
    ).not.toThrow();
  });

  it("fails when an RSC page has no Flight endpoint", () => {
    const graph: AppGraph = {
      version: 1,
      rootDir: "/repo",
      apps: {},
      pages: {
        insights: {
          id: "insights",
          component: "./src/Insights.tsx",
          html: "./index.html",
          render: "ssr",
          componentModel: "rsc",
        },
      },
      routes: [],
      serverFunctions: [],
      serverRoutes: [],
    };
    const plan: BuildPlan = {
      version: 1,
      buildId: "build",
      mode: "production",
      distDir: "dist",
      output: { clientDir: "dist/client", serverDir: "dist/server" },
      entries: [
        {
          name: "server",
          import: "@evjs/ev/internal/server/fetch",
          environment: "server",
          runtime: "node",
          kind: "server-runtime",
        },
        {
          name: "insights-rsc",
          import: "./src/Insights.tsx",
          environment: "server",
          runtime: "node",
          kind: "rsc-page",
          owner: { pageId: "insights" },
        },
      ],
      html: [],
      server: createServerPlan(),
      runtime: createRuntimePlan(),
    };

    expect(() =>
      linkBuildOutput({
        graph,
        plan,
        serverEntryAssets: {
          server: { js: ["server.js"], css: [] },
          "insights-rsc": { js: ["insights-rsc.js"], css: [] },
        },
      }),
    ).toThrow(
      '[evjs] RSC page "insights" requires runtime.server.rsc before RSC manifest emission.',
    );
  });

  it("fails when an RSC page has no matching RSC server renderer", () => {
    const graph: AppGraph = {
      version: 1,
      rootDir: "/repo",
      apps: {},
      pages: {
        insights: {
          id: "insights",
          component: "./src/Insights.tsx",
          html: "./index.html",
          render: "ssr",
          componentModel: "rsc",
        },
      },
      routes: [],
      serverFunctions: [],
      serverRoutes: [],
    };
    const plan: BuildPlan = {
      version: 1,
      buildId: "build",
      mode: "production",
      distDir: "dist",
      output: { clientDir: "dist/client", serverDir: "dist/server" },
      entries: [
        {
          name: "server",
          import: "@evjs/ev/internal/server/fetch",
          environment: "server",
          runtime: "node",
          kind: "server-runtime",
        },
        {
          name: "insights-server",
          import: "./src/Insights.tsx",
          environment: "server",
          runtime: "node",
          kind: "page-server",
          owner: { pageId: "insights" },
        },
      ],
      html: [],
      server: createServerPlan(),
      runtime: createRuntimePlan({ rsc: "/__evjs/rsc" }),
    };

    expect(() =>
      linkBuildOutput({
        graph,
        plan,
        serverEntryAssets: {
          server: { js: ["server.js"], css: [] },
          "insights-server": { js: ["insights-server.js"], css: [] },
        },
      }),
    ).toThrow(
      '[evjs] RSC page "insights" did not declare a matching rsc-page server renderer.',
    );
  });

  it("fails when a PPR page has no matching PPR server renderers", () => {
    const graph: AppGraph = {
      version: 1,
      rootDir: "/repo",
      apps: {},
      pages: {
        campaign: {
          id: "campaign",
          component: "./src/Campaign.tsx",
          html: "./index.html",
          render: "ssr",
          prerender: { partial: true },
          ppr: {
            delivery: "merge",
            regions: {
              offer: {
                component: "./src/Offer.region.tsx",
              },
            },
          },
        },
      },
      routes: [],
      serverFunctions: [],
      serverRoutes: [],
    };
    const createPlan = (entries: BuildPlan["entries"]): BuildPlan => ({
      version: 1,
      buildId: "build",
      mode: "production",
      distDir: "dist",
      output: { clientDir: "dist/client", serverDir: "dist/server" },
      entries: [
        {
          name: "server",
          import: "@evjs/ev/internal/server/fetch",
          environment: "server",
          runtime: "node",
          kind: "server-runtime",
        },
        ...entries,
      ],
      html: [],
      server: createServerPlan(),
      runtime: createRuntimePlan({ ppr: "/__evjs/ppr" }),
    });

    expect(() =>
      linkBuildOutput({
        graph,
        plan: createPlan([
          {
            name: "campaign-offer-ppr-region",
            import: "./src/Offer.region.tsx",
            environment: "server",
            runtime: "node",
            kind: "ppr-region",
            owner: { pageId: "campaign", regionId: "offer" },
          },
        ]),
        serverEntryAssets: {
          server: { js: ["server.js"], css: [] },
          "campaign-offer-ppr-region": {
            js: ["campaign-offer-ppr-region.js"],
            css: [],
          },
        },
      }),
    ).toThrow(
      '[evjs] PPR page "campaign" did not declare a matching ppr-shell server renderer.',
    );

    expect(() =>
      linkBuildOutput({
        graph,
        plan: createPlan([
          {
            name: "campaign-ppr-shell",
            import: "./src/Campaign.tsx",
            environment: "server",
            runtime: "node",
            kind: "ppr-shell",
            owner: { pageId: "campaign" },
          },
        ]),
        serverEntryAssets: {
          server: { js: ["server.js"], css: [] },
          "campaign-ppr-shell": { js: ["campaign-ppr-shell.js"], css: [] },
        },
      }),
    ).toThrow(
      '[evjs] PPR page "campaign" region "offer" did not declare a matching ppr-region server renderer.',
    );
  });

  it("fails when a server-present plan has no server runtime entry", () => {
    const graph: AppGraph = {
      version: 1,
      rootDir: "/repo",
      apps: {},
      pages: {},
      routes: [],
      serverFunctions: [],
      serverRoutes: [],
    };
    const plan: BuildPlan = {
      version: 1,
      buildId: "build",
      mode: "production",
      distDir: "dist",
      output: { clientDir: "dist/client", serverDir: "dist/server" },
      entries: [],
      html: [],
      server: createServerPlan(),
      runtime: createRuntimePlan(),
    };

    expect(() =>
      linkBuildOutput({
        graph,
        plan,
        serverAssets: { js: ["server.js"], css: [] },
      }),
    ).toThrow("[evjs] Server build did not declare a server runtime entry.");
  });
});

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
          document: { fileName: "admin.html" },
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
          document: { fileName: "insights.html" },
          render: "ssr",
          componentModel: "rsc",
          rendering: {
            component: "rsc",
            html: "server",
            streaming: true,
            hydrate: "none",
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
          document: { fileName: "campaign.html" },
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

    expect(() =>
      assertFrameworkManifestShape(manifest, "public manifest", {
        serverFunctionModules: "optional",
        pageRendererReferences: "optional",
        pprRendererReferences: "optional",
        rscRendererReferences: "optional",
      }),
    ).not.toThrow();
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
    expect(manifest.apps.admin.document).toEqual({ fileName: "admin.html" });
    expect(manifest.pages.insights.document).toEqual({
      fileName: "insights.html",
    });
    expect(manifest.pages.campaign.assets).toEqual({ js: [], css: [] });
    expect(manifest.pages.campaign.document).toEqual({
      fileName: "campaign.html",
    });
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

describe("createServerManifest", () => {
  it("projects BuildOutput into the server manifest shape", () => {
    const output: BuildOutput = {
      ...createMinimalBuildOutput(),
      server: {
        entry: "server.js",
        assets: { js: ["server.js"], css: ["server.css"] },
        functions: {
          "fn:getUser": {
            assets: { js: ["users.server.js"], css: [] },
            module: "./src/api/users.server.ts",
            exportName: "getUser",
          },
        },
        routes: [
          {
            path: "/api/users",
            methods: ["GET", "POST"],
            assets: { js: ["users.routes.js"], css: [] },
          },
        ],
        renderers: {
          dashboard: {
            kind: "page-server",
            owner: { pageId: "dashboard" },
            module: "./src/pages/dashboard.tsx",
            assets: { js: ["dashboard-server.js"], css: [] },
          },
        },
      },
    };

    expect(createServerManifest(output)).toEqual({
      version: 1,
      entry: "server.js",
      assets: { js: ["server.js"], css: ["server.css"] },
      fns: {
        "fn:getUser": {
          assets: { js: ["users.server.js"], css: [] },
        },
      },
      routes: [
        {
          path: "/api/users",
          methods: ["GET", "POST"],
          assets: { js: ["users.routes.js"], css: [] },
        },
      ],
    });
  });

  it("projects the minimal server output into the server manifest shape", () => {
    expect(createServerManifest(createMinimalBuildOutput())).toEqual({
      version: 1,
      entry: "server.js",
      assets: { js: ["server.js"], css: [] },
      fns: {},
    });
  });
});
