import { describe, expect, it } from "vitest";
import type { CoreGraph } from "../src/manifest/index.js";
import {
  assertCoreGraph,
  assertPluginId,
  CONFIG_ROUTE_PROVIDER_ID,
  coreRoutePatternShape,
  coreRoutePatternsEqual,
  isCoreRoutePatternPrefix,
  PAGE_ANCHOR_PROVIDER_ID,
  resolveCorePageOwner,
} from "../src/manifest/index.js";

const WINDOWS_DEVICE_PLUGIN_IDS = [
  "aux",
  "con",
  "nul",
  "prn",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
];

describe("assertPluginId", () => {
  it.each([
    "analytics",
    "com0",
    "com10",
    "com1-tools",
    "con-tools",
    "error-reporting",
    "lpt0",
    "lpt10",
  ])('accepts canonical plugin id "%s"', (id) => {
    expect(() => assertPluginId(id, "plugin.id")).not.toThrow();
  });

  it.each([
    "@company/analytics",
    "1analytics",
    "-analytics",
    "Analytics",
    "analytics-",
    "analytics--reporting",
    "analytics.reporting",
    "analytics_plugin",
  ])('rejects non-canonical plugin id "%s"', (id) => {
    expect(() => assertPluginId(id, "plugin.id")).toThrow(
      "must be a lowercase plugin id",
    );
  });

  it.each([
    "__proto__",
    "constructor",
    "prototype",
    ...WINDOWS_DEVICE_PLUGIN_IDS,
  ])('rejects reserved plugin id "%s"', (id) => {
    expect(() => assertPluginId(id, "plugin.id")).toThrow(
      "reserved object key or Windows device basename",
    );
  });
});

describe("assertCoreGraph", () => {
  it("accepts a graph with consistent semantic ownership indexes", () => {
    expect(() =>
      assertCoreGraph(createValidGraph(), "coreGraph"),
    ).not.toThrow();
  });

  it("accepts strict Page-owned title and named metadata", () => {
    const graph = createValidGraph();
    getPage(graph).metadata = {
      title: "",
      meta: {
        description: "",
        Robots: "noindex",
      },
    };

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it("accepts the optional Application layout module", () => {
    const graph = createValidGraph();
    getApplication(graph).layout = "./src/pages/layout.tsx";

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it("accepts normalized static Document aliases", () => {
    const graph = createValidGraph();
    getDocument(graph).aliases = ["legacy.html", "legacy/orders.html"];

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it("accepts a Plugin-owned Document", () => {
    const graph = createValidGraph();
    graph.plugins.entries["html-overlay"] = {};
    getDocument(graph).owner = {
      kind: "plugin",
      pluginId: "html-overlay",
    };
    getDocument(graph).provenance = {
      producer: { kind: "plugin", id: "html-overlay" },
    };

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it("rejects the removed Extension Document owner", () => {
    const graph = createValidGraph();
    Reflect.set(getDocument(graph), "owner", {
      kind: "extension",
      extensionId: "@company/html-overlay",
    });

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      'coreGraph.documents.app:default.owner.kind must be "application", "page", or "plugin"',
    );
  });

  it("requires a canonical Plugin Document owner id", () => {
    const graph = createValidGraph();
    getDocument(graph).owner = { kind: "plugin", pluginId: "" };

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      'coreGraph.documents.app:default.owner.pluginId "" must be a lowercase plugin id',
    );
  });

  it("rejects Plugin Document owners that are not installed", () => {
    const graph = createValidGraph();
    getDocument(graph).owner = { kind: "plugin", pluginId: "html-overlay" };

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      'coreGraph.documents.app:default.owner.pluginId "html-overlay" is not installed in coreGraph.plugins.entries',
    );
  });

  it("rejects Plugin provenance that is not installed", () => {
    const graph = createValidGraph();
    getApplication(graph).provenance = {
      producer: { kind: "plugin", id: "analytics" },
    };

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      'coreGraph.applications.default.provenance.producer.id "analytics" is not installed in coreGraph.plugins.entries',
    );
  });

  it("rejects uninstalled Plugin provenance on Routes", () => {
    const graph = createValidGraph();
    getClientRoute(graph).provenance = {
      producer: { kind: "plugin", id: "analytics" },
    };

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      'coreGraph.routes[0].provenance.producer.id "analytics" is not installed in coreGraph.plugins.entries',
    );
  });

  it("rejects uninstalled Plugin provenance on Documents", () => {
    const graph = createValidGraph();
    getDocument(graph).provenance = {
      producer: { kind: "plugin", id: "analytics" },
    };

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      'coreGraph.documents.app:default.provenance.producer.id "analytics" is not installed in coreGraph.plugins.entries',
    );
  });

  it("keeps Page provenance provider-owned", () => {
    const graph = createValidGraph();
    getPage(graph).provenance = {
      producer: { kind: "plugin", id: "analytics" },
    };

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      'coreGraph.pages.orders.provenance producer must be provider "@evjs/provider/page-anchor"',
    );
  });

  it.each([
    {
      label: "the canonical output",
      aliases: ["index.html"],
      message: /must differ from the canonical output "index\.html"/,
    },
    {
      label: "a duplicate",
      aliases: ["legacy.html", "legacy.html"],
      message: /duplicates alias "legacy\.html"/,
    },
    {
      label: "an unsafe path",
      aliases: ["../legacy.html"],
      message: /must not contain empty, "\.", or "\.\." segments/,
    },
    {
      label: "a non-HTML output",
      aliases: ["main.js"],
      message: /must end with "\.html" or "\.htm"/,
    },
  ])("rejects a Document alias that repeats $label", ({ aliases, message }) => {
    const graph = createValidGraph();
    getDocument(graph).aliases = aliases;

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(message);
  });

  it("rejects aliases that collide with another Document output", () => {
    const graph = createValidGraph();
    getDocument(graph).aliases = ["orders/index.html"];
    graph.documents.orders = {
      id: "orders",
      template: "./index.html",
      output: "orders/index.html",
      applicationId: "default",
      owner: { kind: "page", pageId: "orders" },
      bootstrap: { kind: "page", pageId: "orders" },
      provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
    };
    getApplication(graph).documentIds.push("orders");

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      /conflicts with alias owned by Document "app:default"/,
    );
  });

  it.each([
    "visible",
    "idle",
  ])("rejects the unsupported %s Page hydration mode", (hydrate) => {
    const graph = createValidGraph();
    Reflect.set(getPage(graph), "hydrate", hydrate);

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      '[evjs] coreGraph.pages.orders.hydrate must be "none" or "load".',
    );
  });

  it.each([
    "load",
    "none",
  ])("rejects CSR with Page hydration mode %s", (hydrate) => {
    const graph = createValidGraph();
    Reflect.set(getPage(graph), "hydrate", hydrate);

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      '[evjs] coreGraph.pages.orders.hydrate must be omitted when render is "csr".',
    );
  });

  it("validates Server Function nodes and rejects duplicate ids", () => {
    const graph = createValidGraph();
    graph.serverFunctions = [
      {
        id: "save-order",
        module: "src/actions.ts",
        exportName: "saveOrder",
      },
    ];
    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();

    Reflect.set(graph.serverFunctions[0] as object, "unexpected", true);
    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "[evjs] coreGraph.serverFunctions[0].unexpected is not supported.",
    );

    const duplicateGraph = createValidGraph();
    duplicateGraph.serverFunctions = [
      {
        id: "save-order",
        module: "src/actions.ts",
        exportName: "saveOrder",
      },
      {
        id: "save-order",
        module: "src/other-actions.ts",
        exportName: "saveOtherOrder",
      },
    ];
    expect(() => assertCoreGraph(duplicateGraph, "coreGraph")).toThrow(
      '[evjs] coreGraph.serverFunctions[1].id "save-order" must be unique.',
    );
  });

  it.each([
    "__proto__",
    "constructor",
    "toString",
  ])("treats the prototype-shaped Server Function id %s as data", (id) => {
    const graph = createValidGraph();
    graph.serverFunctions = [
      { id, module: "src/actions.ts", exportName: "first" },
    ];
    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();

    graph.serverFunctions.push({
      id,
      module: "src/other-actions.ts",
      exportName: "second",
    });
    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      `[evjs] coreGraph.serverFunctions[1].id "${id}" must be unique.`,
    );
  });

  it("validates Server Route nodes, methods, and route-shape uniqueness", () => {
    const graph = createValidGraph();
    graph.serverRoutes = [
      {
        id: "users:get",
        module: "src/apis/users/$userId.ts",
        path: "/users/:userId",
        methods: ["GET", "HEAD"],
      },
    ];
    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();

    const route = graph.serverRoutes[0];
    expect(route).toBeDefined();
    if (!route) throw new Error("Expected a Server Route fixture.");
    route.methods = ["get"];
    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      'coreGraph.serverRoutes[0].methods[0] "get" is not a supported HTTP method',
    );

    const duplicateShapeGraph = createValidGraph();
    duplicateShapeGraph.serverRoutes = [
      {
        id: "users:get",
        module: "src/apis/users/$userId.ts",
        path: "/users/:userId",
        methods: ["GET"],
      },
      {
        id: "users:update",
        module: "src/apis/users/$accountId.ts",
        path: "/users/:accountId",
        methods: ["POST"],
      },
    ];
    expect(() => assertCoreGraph(duplicateShapeGraph, "coreGraph")).toThrow(
      'coreGraph.serverRoutes[1].path "/users/:accountId" has the same route shape as "/users/:userId"',
    );
  });

  it("validates client and server reference node elements", () => {
    const graph = createValidGraph();
    graph.clientReferences = [
      {
        id: "src/ClientCard.tsx#default",
        module: "src/ClientCard.tsx",
        exportName: "default",
      },
    ];
    graph.serverReferences = [
      {
        id: "save-order",
        module: "src/actions.ts",
        exportName: "saveOrder",
      },
    ];
    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();

    Reflect.set(graph.clientReferences[0] as object, "unexpected", true);
    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "[evjs] coreGraph.clientReferences[0].unexpected is not supported.",
    );

    const invalidGraph = createValidGraph();
    invalidGraph.serverReferences = [
      {
        id: "save-order",
        module: "src/actions.ts",
        exportName: " saveOrder ",
      },
    ];
    expect(() => assertCoreGraph(invalidGraph, "coreGraph")).toThrow(
      "coreGraph.serverReferences[0].exportName must not contain leading or trailing whitespace",
    );
  });

  it("validates Page prerender and PPR configuration structures", () => {
    const graph = createValidGraph();
    const page = getPage(graph);
    page.render = "ssr";
    page.hydrate = "none";
    page.prerender = {
      partial: true,
      delivery: "stream",
      revalidate: 60,
    };
    page.ppr = {
      delivery: "stream",
      revalidate: false,
      regions: {
        region_offer: {
          component: "./src/pages/orders/Offer.region.tsx",
          fallback: "./src/pages/orders/OfferFallback.tsx",
          cache: { revalidate: 30 },
        },
        region_summary: {
          component: "./src/pages/orders/Summary.region.tsx",
          cache: "no-store",
        },
      },
    };

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it.each([
    [
      "a non-boolean partial prerender flag",
      (page: CoreGraph["pages"][string]) =>
        Reflect.set(page, "prerender", { partial: "yes" }),
      "coreGraph.pages.orders.prerender.partial must be a boolean",
    ],
    [
      "an unknown prerender field",
      (page: CoreGraph["pages"][string]) =>
        Reflect.set(page, "prerender", { revaidate: 60 }),
      "coreGraph.pages.orders.prerender.revaidate is not supported",
    ],
    [
      "an invalid PPR region id",
      (page: CoreGraph["pages"][string]) =>
        Reflect.set(page, "ppr", {
          regions: {
            "offer.v1": {
              component: "./src/pages/orders/Offer.region.tsx",
            },
          },
        }),
      'coreGraph.pages.orders.ppr.regions key "offer.v1" must contain only',
    ],
    [
      "a non-project PPR component path",
      (page: CoreGraph["pages"][string]) =>
        Reflect.set(page, "ppr", {
          regions: {
            offer: { component: "src/pages/orders/Offer.region.tsx" },
          },
        }),
      "coreGraph.pages.orders.ppr.regions.offer.component must be a normalized project-relative path",
    ],
    [
      "a non-positive PPR cache revalidate",
      (page: CoreGraph["pages"][string]) =>
        Reflect.set(page, "ppr", {
          regions: {
            offer: {
              component: "./src/pages/orders/Offer.region.tsx",
              cache: { revalidate: 0 },
            },
          },
        }),
      "coreGraph.pages.orders.ppr.regions.offer.cache.revalidate must be a positive integer",
    ],
  ])("rejects $label", (_label, mutate, message) => {
    const graph = createValidGraph();
    mutate(getPage(graph));

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(message);
  });

  it("rejects application entries outside the canonical route graph", () => {
    const graph = createValidGraph();
    Reflect.set(
      graph.applications.default as object,
      "entry",
      "./src/main.tsx",
    );

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "[evjs] coreGraph.applications.default.entry is not supported.",
    );
  });

  it.each([
    [
      "a non-string title",
      { title: 42 },
      "coreGraph.pages.orders.metadata.title must be a string",
    ],
    [
      "an explicitly undefined title",
      { title: undefined },
      "coreGraph.pages.orders.metadata.title must be a string",
    ],
    [
      "a non-object meta map",
      { meta: [] },
      "coreGraph.pages.orders.metadata.meta must be a plain object",
    ],
    [
      "an explicitly undefined meta map",
      { meta: undefined },
      "coreGraph.pages.orders.metadata.meta must be a plain object",
    ],
    [
      "an empty meta name",
      { meta: { "": "orders" } },
      "metadata.meta keys must be non-empty strings",
    ],
    [
      "an untrimmed meta name",
      { meta: { " description": "orders" } },
      'metadata.meta key " description" must not include leading or trailing whitespace',
    ],
    [
      "a non-string meta value",
      { meta: { description: true } },
      "metadata.meta.description must be a string",
    ],
    [
      "ASCII case-insensitive duplicate meta names",
      { meta: { Description: "orders", description: "history" } },
      'metadata.meta keys "Description" and "description" conflict',
    ],
    [
      "an unknown metadata field",
      { description: "orders" },
      'coreGraph.pages.orders.metadata has unknown field "description"',
    ],
    [
      "an unsafe meta name",
      { meta: { constructor: "orders" } },
      "metadata.meta.constructor is not a safe metadata field",
    ],
  ])("rejects $label", (_label, metadata, message) => {
    const graph = createValidGraph();
    Reflect.set(getPage(graph), "metadata", metadata);

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(message);
  });

  it("rejects Page metadata accessors without invoking them", () => {
    const graph = createValidGraph();
    const meta = {};
    let getterWasCalled = false;
    Object.defineProperty(meta, "description", {
      enumerable: true,
      get() {
        getterWasCalled = true;
        throw new Error("getter must not execute");
      },
    });
    getPage(graph).metadata = { meta };

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "coreGraph.pages.orders.metadata.meta.description must be an enumerable own data property",
    );
    expect(getterWasCalled).toBe(false);
  });

  it("rejects symbol Page metadata fields", () => {
    const graph = createValidGraph();
    const meta = { description: "orders" };
    Reflect.set(meta, Symbol("private"), "secret");
    getPage(graph).metadata = { meta };

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "coreGraph.pages.orders.metadata.meta contains an unsupported symbol field",
    );
  });

  it("rejects a client route targeting a Page from another Application", () => {
    const graph = createValidGraph();
    graph.applications.admin = {
      id: "admin",
      root: "./src/admin",
      routingMode: "spa",
      pageIds: ["admin-settings"],
      routeIds: [],
      documentIds: [],
      plugins: {},
      provenance: providerProvenance("@evjs/provider/config-route"),
    };
    graph.pages["admin-settings"] = {
      id: "admin-settings",
      applicationId: "admin",
      source: {
        module: "./src/admin/settings/page.tsx",
        scope: {
          kind: "directory",
          root: "./src/admin/settings",
        },
        provider: PAGE_ANCHOR_PROVIDER_ID,
      },
      render: "csr",
      plugins: {},
      provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
    };
    const route = graph.routes[0];
    if (route) route.target = { kind: "page", pageId: "admin-settings" };

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      '[evjs] coreGraph.routes[0].target.pageId "admin-settings" belongs to application "admin", not route application "default".',
    );
  });

  it.each([
    "__proto__",
    "constructor",
    "prototype",
    "_splat",
  ])('rejects reserved param name "%s"', (name) => {
    const graph = createValidGraph();
    getClientRoute(graph).pattern.segments = [{ kind: "param", name }];

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      `[evjs] coreGraph.routes[0].pattern.segments[0].name must not use reserved page route param name "${name}".`,
    );
  });

  it("only accepts the normalized _splat name for splat segments", () => {
    const graph = createValidGraph();
    getClientRoute(graph).pattern.segments = [
      { kind: "static", value: "docs" },
      { kind: "splat", name: "rest" },
    ];

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      '[evjs] coreGraph.routes[0].pattern.segments[1].name must be "_splat" for a splat segment.',
    );

    getClientRoute(graph).pattern.segments[1] = {
      kind: "splat",
      name: "_splat",
    };
    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it.each([
    ["CoreGraph", (graph: CoreGraph) => graph],
    ["Application", (graph: CoreGraph) => graph.applications.default],
    ["Page", (graph: CoreGraph) => graph.pages.orders],
    ["Page source", (graph: CoreGraph) => graph.pages.orders?.source],
    ["Page scope", (graph: CoreGraph) => graph.pages.orders?.source.scope],
    ["client Route", (graph: CoreGraph) => getClientRoute(graph)],
    ["route pattern", (graph: CoreGraph) => getClientRoute(graph).pattern],
    [
      "route segment",
      (graph: CoreGraph) => getClientRoute(graph).pattern.segments[0],
    ],
    ["client route target", (graph: CoreGraph) => getClientRoute(graph).target],
    ["route location", (graph: CoreGraph) => addRedirect(graph)],
    ["route facets", (graph: CoreGraph) => getClientRoute(graph).facets],
    ["Document", (graph: CoreGraph) => graph.documents["app:default"]],
    [
      "document owner",
      (graph: CoreGraph) => graph.documents["app:default"]?.owner,
    ],
    [
      "document bootstrap",
      (graph: CoreGraph) => graph.documents["app:default"]?.bootstrap,
    ],
    ["provenance", (graph: CoreGraph) => graph.pages.orders?.provenance],
    [
      "provenance producer",
      (graph: CoreGraph) => graph.pages.orders?.provenance.producer,
    ],
    ["plugin catalog", (graph: CoreGraph) => graph.plugins],
    [
      "plugin catalog entry",
      (graph: CoreGraph) => addPluginCatalogEntry(graph),
    ],
    [
      "plugin Page contract",
      (graph: CoreGraph) => addPluginCatalogEntry(graph).page,
    ],
    [
      "plugin setting",
      (graph: CoreGraph) => {
        addPluginCatalogEntry(graph);
        getPage(graph).plugins.example = { enabled: true, options: {} };
        return getPage(graph).plugins.example;
      },
    ],
  ] as const)("rejects unknown fields on %s objects", (_label, select) => {
    const graph = createValidGraph();
    const subject = select(graph);
    expect(subject).toBeDefined();
    Reflect.set(subject as object, "unexpected", true);

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      /\.unexpected is not supported\.$/,
    );
  });

  it("rejects unknown symbol fields", () => {
    const graph = createValidGraph();
    Reflect.set(getClientRoute(graph).facets, Symbol("unexpected"), true);

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "[evjs] coreGraph.routes[0].facets contains an unsupported symbol field.",
    );
  });

  it("rejects non-enumerable and accessor properties before reading them", () => {
    const nonEnumerableGraph = createValidGraph();
    Object.defineProperty(getPage(nonEnumerableGraph), "plugins", {
      configurable: true,
      enumerable: false,
      value: {},
      writable: true,
    });
    expect(() => assertCoreGraph(nonEnumerableGraph, "coreGraph")).toThrow(
      "coreGraph.pages.orders.plugins must be an enumerable own data property",
    );

    const accessorGraph = createValidGraph();
    let getterWasCalled = false;
    Object.defineProperty(getPage(accessorGraph), "id", {
      configurable: true,
      enumerable: true,
      get() {
        getterWasCalled = true;
        throw new Error("getter must not execute");
      },
    });
    expect(() => assertCoreGraph(accessorGraph, "coreGraph")).toThrow(
      "coreGraph.pages.orders.id must be an enumerable own data property",
    );
    expect(getterWasCalled).toBe(false);
  });

  it.each([
    ["routes", (graph: CoreGraph) => graph.routes],
    [
      "route segments",
      (graph: CoreGraph) => getClientRoute(graph).pattern.segments,
    ],
    [
      "Application Page ids",
      (graph: CoreGraph) => getApplication(graph).pageIds,
    ],
    [
      "route wrappers",
      (graph: CoreGraph) => getClientRoute(graph).facets.wrappers,
    ],
  ] as const)("rejects extra properties on %s arrays", (_label, select) => {
    const graph = createValidGraph();
    Reflect.set(select(graph), "extra", true);

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "is not a supported array index",
    );
  });

  it("requires schema fields to be own properties", () => {
    const graph = createValidGraph();
    Reflect.deleteProperty(graph, "rootDir");

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "[evjs] coreGraph.rootDir must be an own property.",
    );

    const nestedGraph = createValidGraph();
    const source = nestedGraph.pages.orders?.source;
    expect(source).toBeDefined();
    Reflect.deleteProperty(source as object, "provider");

    expect(() => assertCoreGraph(nestedGraph, "coreGraph")).toThrow(
      "[evjs] coreGraph.pages.orders.source.provider must be an own property.",
    );
  });

  it("rejects Map, Date, and class instances as schema objects", () => {
    class GraphInstance {}

    const instance = Object.assign(new GraphInstance(), createValidGraph());
    for (const value of [new Map(), new Date(), instance]) {
      expect(() => assertCoreGraph(value, "coreGraph")).toThrow(
        "[evjs] coreGraph must be a plain object.",
      );
    }
  });

  it("accepts null-prototype schema objects", () => {
    const graph = createValidGraph();
    const page = getPage(graph);
    page.source = Object.assign(
      Object.create(null) as object,
      page.source,
    ) as CoreGraph["pages"][string]["source"];
    const nullPrototypeGraph = Object.assign(
      Object.create(null) as object,
      graph,
    );

    expect(() =>
      assertCoreGraph(nullPrototypeGraph, "coreGraph"),
    ).not.toThrow();
  });

  it("accepts Application enablement and independent Page plugin settings", () => {
    const graph = createValidGraph();
    graph.plugins.entries.example = {
      application: { schemaVersion: "1" },
      page: {
        schemaVersion: "2",
        defaultable: true,
      },
    };
    getApplication(graph).plugins.example = {
      enabled: true,
    };
    getPage(graph).plugins.example = {
      enabled: true,
      options: { channel: "checkout" },
    };

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it("rejects Page plugin options when the plugin is disabled", () => {
    const graph = createValidGraph();
    addPluginCatalogEntry(graph);
    const setting: CoreGraph["pages"][string]["plugins"][string] = {
      enabled: false,
    };
    Reflect.set(setting, "options", { channel: "checkout" });
    getPage(graph).plugins.example = setting as never;

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "coreGraph.pages.orders.plugins.example.options must be omitted when enabled is false",
    );
  });

  it("requires Page plugin options when the plugin is enabled", () => {
    const graph = createValidGraph();
    addPluginCatalogEntry(graph);
    getPage(graph).plugins.example = { enabled: true } as never;

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      'for Page "orders" plugin "example" options are required when enabled',
    );
  });

  it("keeps private Application plugin options out of CoreGraph", () => {
    const graph = createValidGraph();
    addPluginCatalogEntry(graph);
    const setting = { enabled: true };
    Reflect.set(setting, "options", { secret: "must-not-leak" });
    getApplication(graph).plugins.example = setting;

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "coreGraph.applications.default.plugins.example.options is not supported",
    );
  });

  it("accepts null-prototype Page plugin options", () => {
    const graph = createValidGraph();
    addPluginCatalogEntry(graph);
    const options = Object.assign(Object.create(null) as object, {
      enabled: true,
      nested: Object.assign(Object.create(null) as object, { mode: "safe" }),
    }) as Record<string, never>;
    getPage(graph).plugins.example = { enabled: true, options };

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it("keeps Page plugin option fields open when values are static JSON", () => {
    const graph = createValidGraph();
    addPluginCatalogEntry(graph);
    getPage(graph).plugins.example = {
      enabled: true,
      options: {
        arbitraryField: true,
        nested: { values: [1, "two", null] },
      },
    };

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it.each([
    "__proto__",
    "constructor",
    "prototype",
  ])('rejects unsafe Page plugin option key "%s"', (key) => {
    const graph = createValidGraph();
    addPluginCatalogEntry(graph);
    const options = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(options, key, {
      enumerable: true,
      value: true,
    });
    getPage(graph).plugins.example = {
      enabled: true,
      options: options as Record<string, never>,
    };

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      `coreGraph.pages.orders.plugins.example.options.${key} is not a safe config field`,
    );
  });

  it.each([
    ["undefined", undefined],
    ["non-finite number", Number.NaN],
    ["function", () => undefined],
    ["symbol", Symbol("value")],
    ["bigint", BigInt(1)],
    ["Date", new Date()],
    ["Map", new Map([["key", "value"]])],
    ["class instance", new (class PluginValue {})()],
  ])("rejects non-static Page plugin option %s values", (_label, value) => {
    const graph = createValidGraph();
    addPluginCatalogEntry(graph);
    getPage(graph).plugins.example = {
      enabled: true,
      options: { value } as never,
    };

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      /JSON-serializable|finite number|arrays and plain objects/,
    );
  });

  it("rejects cyclic Page plugin option values", () => {
    const graph = createValidGraph();
    addPluginCatalogEntry(graph);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    getPage(graph).plugins.example = {
      enabled: true,
      options: cycle as Record<string, never>,
    };

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "must not contain cycles",
    );
  });

  it("rejects non-enumerable and accessor Page plugin options without invoking getters", () => {
    const nonEnumerableGraph = createValidGraph();
    addPluginCatalogEntry(nonEnumerableGraph);
    const hiddenOptions = {};
    Object.defineProperty(hiddenOptions, "hidden", {
      enumerable: false,
      value: true,
    });
    getPage(nonEnumerableGraph).plugins.example = {
      enabled: true,
      options: hiddenOptions,
    };
    expect(() => assertCoreGraph(nonEnumerableGraph, "coreGraph")).toThrow(
      "must be an enumerable own data property",
    );

    const accessorGraph = createValidGraph();
    addPluginCatalogEntry(accessorGraph);
    let getterWasCalled = false;
    const accessorOptions = {};
    Object.defineProperty(accessorOptions, "computed", {
      enumerable: true,
      get() {
        getterWasCalled = true;
        throw new Error("getter must not execute");
      },
    });
    getPage(accessorGraph).plugins.example = {
      enabled: true,
      options: accessorOptions,
    };
    expect(() => assertCoreGraph(accessorGraph, "coreGraph")).toThrow(
      "must be an enumerable own data property",
    );
    expect(getterWasCalled).toBe(false);
  });

  it("requires Page plugin options to be plain objects", () => {
    const graph = createValidGraph();
    addPluginCatalogEntry(graph);
    const setting = { enabled: true };
    Reflect.set(setting, "options", ["not", "an", "object"]);
    getPage(graph).plugins.example = setting as never;

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "coreGraph.pages.orders.plugins.example.options must be a plain object",
    );
  });

  it("rejects the removed Page plugin config field", () => {
    const graph = createValidGraph();
    addPluginCatalogEntry(graph);
    const setting = { enabled: true };
    Reflect.set(setting, "config", { channel: "legacy" });
    getPage(graph).plugins.example = setting as never;

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "coreGraph.pages.orders.plugins.example.config is not supported",
    );
  });

  it("rejects array accessors without invoking them", () => {
    const graph = createValidGraph();
    let getterWasCalled = false;
    Object.defineProperty(graph.routes, 0, {
      configurable: true,
      enumerable: true,
      get() {
        getterWasCalled = true;
        throw new Error("getter must not execute");
      },
    });

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "coreGraph.routes[0] must be an enumerable own data property",
    );
    expect(getterWasCalled).toBe(false);
  });

  it("rejects settings for uninstalled plugins or plugins without a Page contract", () => {
    const graph = createValidGraph();
    getPage(graph).plugins.example = { enabled: true } as never;

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      'uses plugin id "example", but that plugin is not installed',
    );

    graph.plugins.entries.example = {
      application: {},
    };
    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "does not declare a Page contract",
    );
  });

  it("validates catalog ids and contracts", () => {
    const graph = createValidGraph();
    graph.plugins.entries.analytics = {
      page: { defaultable: false },
    };
    graph.plugins.entries.monitor = {
      application: {},
    };

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();

    const invalidIdGraph = createValidGraph();
    const entries = Object.create(null) as Record<string, unknown>;
    entries["invalid.key"] = {};
    invalidIdGraph.plugins.entries = entries as never;
    expect(() => assertCoreGraph(invalidIdGraph, "coreGraph")).toThrow(
      "must be a lowercase plugin id",
    );

    const invalidContractGraph = createValidGraph();
    const entry = addPluginCatalogEntry(invalidContractGraph);
    Reflect.set(entry.page as object, "defaultable", "yes");
    expect(() => assertCoreGraph(invalidContractGraph, "coreGraph")).toThrow(
      "coreGraph.plugins.entries.example.page.defaultable must be a boolean",
    );
  });

  it("rejects legacy catalog value ids and non-boolean enabled flags", () => {
    const legacyIdGraph = createValidGraph();
    Reflect.set(legacyIdGraph.plugins.entries, "example", {
      id: "@company/example-plugin",
    });
    expect(() => assertCoreGraph(legacyIdGraph, "coreGraph")).toThrow(
      "coreGraph.plugins.entries.example.id is not supported",
    );

    const invalidSettingGraph = createValidGraph();
    addPluginCatalogEntry(invalidSettingGraph);
    const setting = { enabled: true };
    Reflect.set(setting, "enabled", "yes");
    getPage(invalidSettingGraph).plugins.example = setting as never;
    expect(() => assertCoreGraph(invalidSettingGraph, "coreGraph")).toThrow(
      "coreGraph.pages.orders.plugins.example.enabled must be a boolean",
    );
  });

  it.each([
    "__proto__",
    "constructor",
    "prototype",
    ...WINDOWS_DEVICE_PLUGIN_IDS,
  ])('rejects reserved plugin catalog id "%s"', (id) => {
    const graph = createValidGraph();
    const entries = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(entries, id, {
      enumerable: true,
      value: {},
    });
    graph.plugins.entries = entries as never;

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "reserved object key or Windows device basename",
    );
  });

  it("rejects removed extension and Route/Document plugin bags", () => {
    const graph = createValidGraph();
    Reflect.set(graph, "extensions", { namespaces: {} });
    Reflect.set(getClientRoute(graph), "plugins", {});
    Reflect.set(getDocument(graph), "plugins", {});

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "coreGraph.extensions is not supported",
    );
  });

  it("resolves exact module owners before the deepest directory owner and excludes route facets", () => {
    const graph = createValidGraph();
    const rootPage = getPage(graph);
    rootPage.source.module = "./src/pages/page.tsx";
    rootPage.source.scope = { kind: "directory", root: "./src/pages" };
    addPage(graph, "users", {
      module: "./src/pages/users/page.tsx",
      scope: { kind: "directory", root: "./src/pages/users" },
    });
    addPage(graph, "shared", {
      module: "./src/pages/shared.tsx",
      scope: { kind: "module", file: "./src/pages/shared.tsx" },
    });
    getClientRoute(graph).facets.layout = "./src/pages/users/layout.tsx";

    expect(resolveCorePageOwner(graph, "./src/pages/helper.ts")).toBe(rootPage);
    expect(resolveCorePageOwner(graph, "./src/pages/users/helper.ts")?.id).toBe(
      "users",
    );
    expect(resolveCorePageOwner(graph, "./src/pages/shared.tsx")?.id).toBe(
      "shared",
    );
    expect(
      resolveCorePageOwner(graph, "./src/pages/users/layout.tsx"),
    ).toBeUndefined();
    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it("excludes the Application root layout from a root Page directory scope", () => {
    const graph = createValidGraph();
    const rootPage = getPage(graph);
    rootPage.source.module = "./src/pages/page.tsx";
    rootPage.source.scope = { kind: "directory", root: "./src/pages" };
    getApplication(graph).layout = "./src/pages/layout.tsx";

    expect(
      resolveCorePageOwner(graph, "./src/pages/layout.tsx"),
    ).toBeUndefined();
    expect(resolveCorePageOwner(graph, "./src/pages/model.ts")).toBe(rootPage);
    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it("rejects duplicate scopes while allowing parent and child directory carve-outs", () => {
    const graph = createValidGraph();
    const rootPage = getPage(graph);
    rootPage.source.module = "./src/pages/page.tsx";
    rootPage.source.scope = { kind: "directory", root: "./src/pages" };
    addPage(graph, "users", {
      module: "./src/pages/users/page.tsx",
      scope: { kind: "directory", root: "./src/pages/users" },
    });

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();

    addPage(graph, "duplicate-users", {
      module: "./src/pages/users/duplicate.tsx",
      scope: { kind: "directory", root: "./src/pages/users" },
    });
    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      'duplicates the directory scope owned by Page "users"',
    );

    const moduleGraph = createValidGraph();
    const module = getPage(moduleGraph).source.module;
    getPage(moduleGraph).source.scope = { kind: "module", file: module };
    addPage(moduleGraph, "duplicate-module", {
      module,
      scope: { kind: "module", file: module },
    });
    expect(() => assertCoreGraph(moduleGraph, "coreGraph")).toThrow(
      'duplicates the module scope owned by Page "orders"',
    );
  });

  it("requires every Page source module to resolve to that Page", () => {
    const graph = createValidGraph();
    const rootPage = getPage(graph);
    rootPage.source.module = "./src/pages/users/parent.tsx";
    rootPage.source.scope = { kind: "directory", root: "./src/pages" };
    addPage(graph, "users", {
      module: "./src/pages/users/page.tsx",
      scope: { kind: "directory", root: "./src/pages/users" },
    });

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      'resolves to Page "users", not Page "orders"',
    );

    const facetGraph = createValidGraph();
    getClientRoute(facetGraph).facets.error = getPage(facetGraph).source.module;
    expect(() => assertCoreGraph(facetGraph, "coreGraph")).toThrow(
      'resolves to no Page, not Page "orders"',
    );
  });

  it("requires module scopes to equal their source and directory scopes to contain it", () => {
    const moduleGraph = createValidGraph();
    getPage(moduleGraph).source.scope = {
      kind: "module",
      file: "./src/pages/orders/other.tsx",
    };
    expect(() => assertCoreGraph(moduleGraph, "coreGraph")).toThrow(
      "source.scope.file must equal coreGraph.pages.orders.source.module",
    );

    const directoryGraph = createValidGraph();
    getPage(directoryGraph).source.scope = {
      kind: "directory",
      root: "./src/pages/account",
    };
    expect(() => assertCoreGraph(directoryGraph, "coreGraph")).toThrow(
      "source.module must be lexically contained",
    );
  });

  it("rejects duplicate terminal route shapes but allows path groups", () => {
    const graph = createValidGraph();
    getClientRoute(graph).pattern.segments = [
      { kind: "static", value: "users" },
      { kind: "param", name: "id" },
    ];
    addClientRoute(graph, {
      id: "users-group",
      pattern: getClientRoute(graph).pattern,
      target: { kind: "group" },
    });
    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();

    addClientRoute(graph, {
      id: "users-redirect",
      pattern: {
        segments: [
          { kind: "static", value: "users" },
          { kind: "param", name: "userId" },
        ],
      },
      target: { kind: "redirect", to: { kind: "url", href: "/login" } },
    });
    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      'conflicts with Route "orders" in application "default"',
    );
  });

  it.each([
    ["raw ASCII", "users", "%75sers"],
    ["raw Unicode", "你好", "%E4%BD%A0%E5%A5%BD"],
  ])("rejects terminal Route shapes that differ only by a %s encoding alias", (_label, raw, encoded) => {
    const graph = createValidGraph();
    getClientRoute(graph).pattern.segments = [{ kind: "static", value: raw }];
    addClientRoute(graph, {
      id: "encoded-alias",
      pattern: { segments: [{ kind: "static", value: encoded }] },
      target: { kind: "redirect", to: { kind: "url", href: "/login" } },
    });

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      'conflicts with Route "orders" in application "default"',
    );
  });

  it("keeps encoded slash boundaries and double encoding distinct", () => {
    const graph = createValidGraph();
    for (const [id, segments] of [
      ["encoded-slash", ["files", "a%2Fb"]],
      ["path-boundary", ["files", "a", "b"]],
      ["single-encoding", ["tokens", "%2F"]],
      ["double-encoding", ["tokens", "%252F"]],
    ] as const) {
      addClientRoute(graph, {
        id,
        pattern: {
          segments: segments.map((value) => ({ kind: "static", value })),
        },
        target: { kind: "redirect", to: { kind: "url", href: "/login" } },
      });
    }

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it("uses one shared canonical Route pattern identity and prefix", () => {
    const raw = { segments: [{ kind: "static" as const, value: "users" }] };
    const encoded = {
      segments: [{ kind: "static" as const, value: "%75sers" }],
    };
    const encodedChild = {
      segments: [
        ...encoded.segments,
        { kind: "static" as const, value: "settings" },
      ],
    };

    expect(coreRoutePatternShape(raw)).toBe(coreRoutePatternShape(encoded));
    expect(coreRoutePatternsEqual(raw, encoded)).toBe(true);
    expect(isCoreRoutePatternPrefix(raw, encodedChild)).toBe(true);
    expect(
      isCoreRoutePatternPrefix(
        {
          segments: [
            { kind: "static", value: "files" },
            { kind: "static", value: "a%2Fb" },
          ],
        },
        {
          segments: [
            { kind: "static", value: "files" },
            { kind: "static", value: "a" },
            { kind: "static", value: "b" },
          ],
        },
      ),
    ).toBe(false);
    expect(
      coreRoutePatternsEqual(
        { segments: [{ kind: "static", value: "%2F" }] },
        { segments: [{ kind: "static", value: "%252F" }] },
      ),
    ).toBe(false);
  });

  it("allows a group parent and terminal empty child to share one pattern", () => {
    const graph = createValidGraph();
    const route = getClientRoute(graph);
    route.pattern = { segments: [] };
    addClientRoute(graph, {
      id: "root-group",
      pattern: { segments: [] },
      target: { kind: "group" },
    });
    route.parentId = "root-group";

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it("requires every client parent pattern to prefix its child pattern", () => {
    const graph = createValidGraph();
    const child = getClientRoute(graph);
    child.pattern = {
      segments: [
        { kind: "static", value: "orders" },
        { kind: "static", value: "history" },
      ],
    };
    const parent = addClientRoute(graph, {
      id: "account-layout",
      pattern: {
        segments: [{ kind: "static", value: "account" }],
      },
      target: { kind: "group" },
    });
    child.parentId = parent.id;

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      '[evjs] coreGraph.routes[0].pattern must start with parent Route "account-layout" pattern.',
    );

    parent.pattern = {
      segments: [{ kind: "static", value: "orders" }],
    };
    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it.each([
    "",
    ".",
    "..",
    "%2E",
    ".%2e",
    "%2E%2E",
    "a/b",
    "a\\b",
    "white space",
    "a?b",
    "a#b",
  ])('rejects unsafe static route segment "%s"', (value) => {
    const graph = createValidGraph();
    getClientRoute(graph).pattern.segments = [{ kind: "static", value }];

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow();
  });

  it.each([
    "%252E",
    "%252E%252E",
  ])('keeps double-encoded static dot segment "%s" distinct', (value) => {
    const graph = createValidGraph();
    getClientRoute(graph).pattern.segments = [{ kind: "static", value }];

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it("keeps structured static $literal segments distinct from params", () => {
    const graph = createValidGraph();
    getClientRoute(graph).pattern.segments = [
      { kind: "static", value: "$literal" },
    ];

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it.each([
    "",
    "/index.html",
    "C:/index.html",
    "nested\\index.html",
    "./index.html",
    "../index.html",
    "nested/./index.html",
    "nested//index.html",
    "index.html?lang=en",
    "index.html#main",
    "nested/",
  ])('rejects unsafe Document output "%s"', (output) => {
    const graph = createValidGraph();
    getDocument(graph).output = output;

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow();
  });

  it("accepts a normalized nested Document output", () => {
    const graph = createValidGraph();
    getDocument(graph).output = "nested/index.html";

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it.each([
    [
      "application root",
      (graph: CoreGraph): void => {
        getApplication(graph).root = "./src/../app";
      },
    ],
    [
      "page module",
      (graph: CoreGraph): void => {
        getPage(graph).source.module = "src/pages/orders/page.tsx";
      },
    ],
    [
      "page scope",
      (graph: CoreGraph): void => {
        getPage(graph).source.scope = {
          kind: "directory",
          root: "./src//pages",
        };
      },
    ],
    [
      "route facet",
      (graph: CoreGraph): void => {
        getClientRoute(graph).facets.wrappers = ["./src/pages/../wrapper.tsx"];
      },
    ],
    [
      "Document template",
      (graph: CoreGraph): void => {
        getDocument(graph).template = "../index.html";
      },
    ],
  ] as const)("rejects a non-canonical %s project path", (_label, mutate) => {
    const graph = createValidGraph();
    mutate(graph);

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow();
  });

  it.each([
    PAGE_ANCHOR_PROVIDER_ID,
    CONFIG_ROUTE_PROVIDER_ID,
  ])('accepts a canonical "%s" provider fixture', (provider) => {
    const graph = createValidGraph();
    const page = getPage(graph);
    page.source.provider = provider;
    page.provenance = providerProvenance(provider);
    if (provider !== PAGE_ANCHOR_PROVIDER_ID) {
      page.source.module = "./src/pages/orders/index.tsx";
    }

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });
});

function getClientRoute(graph: CoreGraph): CoreGraph["routes"][number] {
  const route = graph.routes[0];
  if (!route) throw new Error("Expected a client route fixture.");
  return route;
}

function getApplication(graph: CoreGraph): CoreGraph["applications"][string] {
  const application = graph.applications.default;
  if (!application) throw new Error("Expected an Application fixture.");
  return application;
}

function getPage(graph: CoreGraph): CoreGraph["pages"][string] {
  const page = graph.pages.orders;
  if (!page) throw new Error("Expected a Page fixture.");
  return page;
}

function getDocument(graph: CoreGraph): CoreGraph["documents"][string] {
  const document = graph.documents["app:default"];
  if (!document) throw new Error("Expected a Document fixture.");
  return document;
}

function addPage(
  graph: CoreGraph,
  id: string,
  source: Omit<CoreGraph["pages"][string]["source"], "provider"> & {
    provider?: string;
  },
): CoreGraph["pages"][string] {
  const page = {
    id,
    applicationId: "default",
    source: {
      ...source,
      provider: source.provider ?? PAGE_ANCHOR_PROVIDER_ID,
    },
    render: "csr" as const,
    plugins: {},
    provenance: providerProvenance(source.provider ?? PAGE_ANCHOR_PROVIDER_ID),
  };
  graph.pages[id] = page;
  getApplication(graph).pageIds.push(id);
  return page;
}

function addClientRoute(
  graph: CoreGraph,
  input: Pick<CoreGraph["routes"][number], "id" | "pattern" | "target">,
): CoreGraph["routes"][number] {
  const route: CoreGraph["routes"][number] = {
    applicationId: "default",
    facets: { wrappers: [] },
    provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
    ...input,
  };
  graph.routes.push(route);
  getApplication(graph).routeIds.push(route.id);
  return route;
}

function addRedirect(graph: CoreGraph): object {
  const location = { kind: "url" as const, href: "/login" };
  getClientRoute(graph).target = { kind: "redirect", to: location };
  return location;
}

function addPluginCatalogEntry(
  graph: CoreGraph,
): CoreGraph["plugins"]["entries"][string] {
  const entry: CoreGraph["plugins"]["entries"][string] = {
    page: { defaultable: true },
  };
  graph.plugins.entries.example = entry;
  return entry;
}

function createValidGraph(): CoreGraph {
  return {
    rootDir: "/project",
    applications: {
      default: {
        id: "default",
        root: ".",
        routingMode: "spa",
        pageIds: ["orders"],
        routeIds: ["orders"],
        documentIds: ["app:default"],
        plugins: {},
        provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
      },
    },
    pages: {
      orders: {
        id: "orders",
        applicationId: "default",
        source: {
          module: "./src/pages/orders/page.tsx",
          scope: {
            kind: "directory",
            root: "./src/pages/orders",
          },
          provider: PAGE_ANCHOR_PROVIDER_ID,
        },
        render: "csr",
        plugins: {},
        provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
      },
    },
    routes: [
      {
        id: "orders",
        applicationId: "default",
        pattern: {
          segments: [{ kind: "static", value: "orders" }],
        },
        target: { kind: "page", pageId: "orders" },
        facets: { wrappers: [] },
        provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
      },
    ],
    documents: {
      "app:default": {
        id: "app:default",
        template: "./index.html",
        output: "index.html",
        applicationId: "default",
        owner: { kind: "application" },
        mount: "#app",
        bootstrap: { kind: "application" },
        provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
      },
    },
    plugins: { entries: {} },
    serverFunctions: [],
    serverRoutes: [],
  };
}

function providerProvenance(id: string) {
  return {
    producer: {
      kind: "provider" as const,
      id,
    },
  };
}
