import { describe, expect, it } from "vitest";
import type { CoreGraph } from "../src/manifest/index.js";
import {
  assertCoreGraph,
  CONFIG_ROUTE_PROVIDER_ID,
  PAGE_ANCHOR_PROVIDER_ID,
  resolveCorePageOwner,
} from "../src/manifest/index.js";

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
      topology: "spa",
      pageIds: ["admin-settings"],
      routeIds: [],
      documentIds: [],
      extensions: {},
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
      extensions: {},
      provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
    };
    const route = graph.routes[0];
    if (route?.realm === "client") {
      route.target = { kind: "page", pageId: "admin-settings" };
    }

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
    ["document Route", (graph: CoreGraph) => addDocumentRoute(graph)],
    ["route pattern", (graph: CoreGraph) => getClientRoute(graph).pattern],
    [
      "route segment",
      (graph: CoreGraph) => getClientRoute(graph).pattern.segments[0],
    ],
    ["client route target", (graph: CoreGraph) => getClientRoute(graph).target],
    [
      "document route target",
      (graph: CoreGraph) => addDocumentRoute(graph).target,
    ],
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
    ["extension registry", (graph: CoreGraph) => graph.extensions],
    [
      "extension registry namespace",
      (graph: CoreGraph) => addExtensionNamespace(graph),
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
    Object.defineProperty(getPage(nonEnumerableGraph), "extensions", {
      configurable: true,
      enumerable: false,
      value: {},
      writable: true,
    });
    expect(() => assertCoreGraph(nonEnumerableGraph, "coreGraph")).toThrow(
      "coreGraph.pages.orders.extensions must be an enumerable own data property",
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
    [
      "extension registry owners",
      (graph: CoreGraph) => {
        graph.extensions.namespaces["example.plugin"] = {
          producer: "example-plugin",
          owners: ["page"],
        };
        return graph.extensions.namespaces["example.plugin"].owners;
      },
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

  it("accepts null-prototype extension JSON objects", () => {
    const graph = createValidGraph();
    const value = Object.assign(Object.create(null) as object, {
      enabled: true,
      nested: Object.assign(Object.create(null) as object, { mode: "safe" }),
    });
    graph.extensions.namespaces["example.plugin"] = {
      producer: "example-plugin",
      owners: ["page"],
    };
    getPage(graph).extensions["example.plugin"] = value;

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it("keeps extension payload fields open when values are JSON-serializable", () => {
    const graph = createValidGraph();
    getPage(graph).extensions = {
      "example.plugin": {
        arbitraryField: true,
        nested: { values: [1, "two", null] },
      },
    };
    graph.extensions.namespaces["example.plugin"] = {
      producer: "example-plugin",
      owners: ["page"],
    };

    expect(() => assertCoreGraph(graph, "coreGraph")).not.toThrow();
  });

  it.each([
    ["undefined", undefined],
    ["non-finite number", Number.NaN],
    ["function", () => undefined],
    ["symbol", Symbol("value")],
    ["bigint", BigInt(1)],
    ["Date", new Date()],
    ["Map", new Map([["key", "value"]])],
    ["class instance", new (class ExtensionValue {})()],
  ])("rejects non-serializable extension %s values", (_label, value) => {
    const graph = createValidGraph();
    graph.extensions.namespaces["example.plugin"] = {
      producer: "example-plugin",
      owners: ["page"],
    };
    getPage(graph).extensions["example.plugin"] = value;

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      /JSON-serializable|finite number|arrays and plain objects/,
    );
  });

  it("rejects cyclic extension values", () => {
    const graph = createValidGraph();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    graph.extensions.namespaces["example.plugin"] = {
      producer: "example-plugin",
      owners: ["page"],
    };
    getPage(graph).extensions["example.plugin"] = cycle;

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "must not contain cycles",
    );
  });

  it("rejects non-enumerable and accessor extension properties without invoking getters", () => {
    const nonEnumerableGraph = createValidGraph();
    nonEnumerableGraph.extensions.namespaces["example.plugin"] = {
      producer: "example-plugin",
      owners: ["page"],
    };
    const hiddenValue = {};
    Object.defineProperty(hiddenValue, "hidden", {
      enumerable: false,
      value: true,
    });
    getPage(nonEnumerableGraph).extensions["example.plugin"] = hiddenValue;
    expect(() => assertCoreGraph(nonEnumerableGraph, "coreGraph")).toThrow(
      "must be an enumerable own data property",
    );

    const accessorGraph = createValidGraph();
    accessorGraph.extensions.namespaces["example.plugin"] = {
      producer: "example-plugin",
      owners: ["page"],
    };
    let getterWasCalled = false;
    const accessorValue = {};
    Object.defineProperty(accessorValue, "computed", {
      enumerable: true,
      get() {
        getterWasCalled = true;
        throw new Error("getter must not execute");
      },
    });
    getPage(accessorGraph).extensions["example.plugin"] = accessorValue;
    expect(() => assertCoreGraph(accessorGraph, "coreGraph")).toThrow(
      "must be an enumerable own data property",
    );
    expect(getterWasCalled).toBe(false);
  });

  it.each([
    ["extra property", (array: unknown[]) => Reflect.set(array, "extra", true)],
    [
      "symbol property",
      (array: unknown[]) => Reflect.set(array, Symbol("extra"), true),
    ],
    [
      "non-enumerable index",
      (array: unknown[]) =>
        Object.defineProperty(array, 0, {
          configurable: true,
          enumerable: false,
          value: array[0],
          writable: true,
        }),
    ],
    [
      "accessor index",
      (array: unknown[]) =>
        Object.defineProperty(array, 0, {
          configurable: true,
          enumerable: true,
          get() {
            throw new Error("getter must not execute");
          },
        }),
    ],
    ["sparse index", (array: unknown[]) => Reflect.deleteProperty(array, 0)],
  ] as const)("rejects extension arrays with a %s", (_label, mutate) => {
    const graph = createValidGraph();
    graph.extensions.namespaces["example.plugin"] = {
      producer: "example-plugin",
      owners: ["page"],
    };
    const value: unknown[] = ["value"];
    mutate(value);
    getPage(graph).extensions["example.plugin"] = value;

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow();
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

  it("rejects unregistered or owner-incompatible extension bags", () => {
    const graph = createValidGraph();
    getPage(graph).extensions["example.plugin"] = { enabled: true };

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      'uses unregistered extension namespace "example.plugin"',
    );

    graph.extensions.namespaces["example.plugin"] = {
      producer: "example-plugin",
      owners: ["route"],
    };
    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      'does not allow owner "page"',
    );
  });

  it("rejects removed raw extension claims", () => {
    const graph = createValidGraph();
    graph.extensions.namespaces["@company/feature"] = {
      producer: "feature-plugin",
      owners: ["page"],
    };
    Reflect.set(graph.extensions.namespaces["@company/feature"], "raw", {
      namespace: "@evjs/compat/raw",
      key: "feature",
    });

    expect(() => assertCoreGraph(graph, "coreGraph")).toThrow(
      "coreGraph.extensions.namespaces.@company/feature.raw is not supported",
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

  it("rejects duplicate terminal route shapes but not groups or separate realms", () => {
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
    addDocumentRoute(graph).pattern = getClientRoute(graph).pattern;
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
      'conflicts with Route "orders" in application "default" and realm "client"',
    );
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

  it.each([
    "",
    ".",
    "..",
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

function getClientRoute(
  graph: CoreGraph,
): Extract<CoreGraph["routes"][number], { realm: "client" }> {
  const route = graph.routes.find((candidate) => candidate.realm === "client");
  if (!route || route.realm !== "client") {
    throw new Error("Expected a client route fixture.");
  }
  return route;
}

function addDocumentRoute(
  graph: CoreGraph,
): Extract<CoreGraph["routes"][number], { realm: "document" }> {
  const route: Extract<CoreGraph["routes"][number], { realm: "document" }> = {
    realm: "document",
    id: "document:default",
    applicationId: "default",
    pattern: { segments: [] },
    target: { kind: "document", documentId: "app:default" },
    extensions: {},
    provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
  };
  graph.routes.push(route);
  getApplication(graph).routeIds.push(route.id);
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
    extensions: {},
    provenance: providerProvenance(source.provider ?? PAGE_ANCHOR_PROVIDER_ID),
  };
  graph.pages[id] = page;
  getApplication(graph).pageIds.push(id);
  return page;
}

function addClientRoute(
  graph: CoreGraph,
  input: Pick<
    Extract<CoreGraph["routes"][number], { realm: "client" }>,
    "id" | "pattern" | "target"
  >,
): Extract<CoreGraph["routes"][number], { realm: "client" }> {
  const route: Extract<CoreGraph["routes"][number], { realm: "client" }> = {
    realm: "client",
    applicationId: "default",
    facets: { wrappers: [] },
    extensions: {},
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

function addExtensionNamespace(graph: CoreGraph): object {
  const namespace = {
    producer: "example-plugin",
    owners: ["page" as const],
  };
  graph.extensions.namespaces["example.plugin"] = namespace;
  return namespace;
}

function createValidGraph(): CoreGraph {
  return {
    rootDir: "/project",
    applications: {
      default: {
        id: "default",
        root: ".",
        topology: "spa",
        pageIds: ["orders"],
        routeIds: ["orders"],
        documentIds: ["app:default"],
        extensions: {},
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
        extensions: {},
        provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
      },
    },
    routes: [
      {
        realm: "client",
        id: "orders",
        applicationId: "default",
        pattern: {
          segments: [{ kind: "static", value: "orders" }],
        },
        target: { kind: "page", pageId: "orders" },
        facets: { wrappers: [] },
        extensions: {},
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
        extensions: {},
        provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
      },
    },
    extensions: { namespaces: {} },
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
