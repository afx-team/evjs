import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type BuildPlan,
  CONFIG_ROUTE_PROVIDER_ID,
  type CoreGraph,
  PAGE_ANCHOR_PROVIDER_ID,
} from "@evjs/shared/manifest";
import { afterEach, describe, expect, it } from "vitest";
import { prepareFrameworkBuild } from "../src/_internal/build/commands.js";
import { createFrameworkIRView } from "../src/_internal/build/generated-contributions.js";
import {
  applyPluginPageExtensions,
  collectPluginExtensionRegistry,
} from "../src/_internal/build/plugin-extensions.js";
import type { ConfigExtensionNamespace } from "../src/config/index.js";
import {
  definePlugin,
  type FrameworkIRView,
  type FrameworkPageAppRouteView,
} from "../src/plugin/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("plugin Page extensions", () => {
  it("resolves canonical Page config in dependency order", () => {
    const events: string[] = [];
    const dependent = definePlugin({
      name: "dependent",
      dependencies: ["base"],
      describe(ctx) {
        events.push("dependent");
        ctx.pageExtension<{ text: string; suffix: string }, string>({
          namespace: "@company/title",
          schemaVersion: "1",
          defaults: { text: "Default", suffix: "!" },
          merge(defaults, configured) {
            return {
              text: configured,
              suffix: defaults?.suffix ?? "!",
            };
          },
          validate(value) {
            return typeof value.text === "string" || "text must be a string";
          },
        });
      },
    });
    const base = definePlugin({
      name: "base",
      describe(ctx) {
        events.push("base");
        ctx.pageExtension({
          namespace: "@company/feature",
          defaults: { enabled: false, channel: "default" },
        });
      },
    });

    const registry = collectPluginExtensionRegistry([dependent, base]);
    const resolved = applyPluginPageExtensions(createSpaGraph(), registry, {
      canonical: {
        home: {
          source: "./src/pages/page.config.ts",
          metadata: undefined,
          render: undefined,
          hydrate: undefined,
          prerender: undefined,
          componentModel: undefined,
          extensions: {
            "@company/title": "Orders",
            "@company/feature": { enabled: true },
          },
        },
      },
    });

    expect(events).toEqual(["base", "dependent"]);
    expect(resolved.pages.home.extensions).toEqual({
      "@company/feature": {
        enabled: true,
        channel: "default",
      },
      "@company/title": { text: "Orders", suffix: "!" },
    });
    expect(resolved.extensions.namespaces["@company/title"]).toEqual({
      producer: "dependent",
      owners: ["page"],
      schemaVersion: "1",
    });
  });

  it("supports defaults-only Page extensions without a raw config claim", () => {
    const plugin = definePlugin({
      name: "defaults-only",
      describe(ctx) {
        ctx.pageExtension({
          namespace: "@company/theme",
          defaults: ({ pageId }) => ({ pageId, color: "blue" }),
          validate(value) {
            return value.color === "blue";
          },
        });
      },
    });

    const resolved = applyPluginPageExtensions(
      createSpaGraph(),
      collectPluginExtensionRegistry([plugin]),
    );

    expect(resolved.pages.home.extensions["@company/theme"]).toEqual({
      pageId: "home",
      color: "blue",
    });
    expect(resolved.extensions.namespaces["@company/theme"]).toEqual({
      producer: "defaults-only",
      owners: ["page"],
    });
  });

  it("materializes defaults without invoking merge when a Page omits the namespace", () => {
    let mergeCalls = 0;
    const validated: unknown[] = [];
    const plugin = definePlugin({
      name: "defaults-before-merge",
      describe(ctx) {
        ctx.pageExtension<
          { enabled: boolean; channel: string },
          { enabled?: boolean }
        >({
          namespace: "@company/defaults-before-merge",
          defaults: { enabled: false, channel: "web" },
          merge(defaults, configured) {
            mergeCalls += 1;
            return {
              enabled: configured.enabled ?? defaults?.enabled ?? false,
              channel: defaults?.channel ?? "web",
            };
          },
          validate(value) {
            validated.push(value);
          },
        });
      },
    });

    const resolved = applyPluginPageExtensions(
      createSpaGraph(),
      collectPluginExtensionRegistry([plugin]),
    );

    expect(mergeCalls).toBe(0);
    expect(resolved.pages.home.extensions).toEqual({
      "@company/defaults-before-merge": {
        enabled: false,
        channel: "web",
      },
    });
    expect(validated).toEqual([{ enabled: false, channel: "web" }]);
  });

  it("exposes resolved CoreGraph identity, composition, and extensions in contribution views", () => {
    const coreGraph = createSpaGraph();
    coreGraph.applications.default.extensions["@company/application"] = {
      locale: "zh-CN",
    };
    const coreRoute = coreGraph.routes[0];
    if (!coreRoute || coreRoute.realm !== "client") {
      throw new Error("Expected client Route fixture.");
    }
    coreRoute.extensions["@company/menu"] = { name: "Home" };
    coreRoute.facets.layout = "./src/layout.tsx";
    coreRoute.facets.wrappers.push("./src/wrapper.tsx");
    const rootRouteId = "@evjs/provider/page-anchor:root-layout";
    coreGraph.routes.unshift({
      realm: "client",
      id: rootRouteId,
      applicationId: "default",
      pattern: { segments: [] },
      target: { kind: "group" },
      facets: { layout: "./src/root-layout.tsx", wrappers: [] },
      extensions: {},
      provenance: {
        producer: { kind: "provider", id: PAGE_ANCHOR_PROVIDER_ID },
        source: "./src/root-layout.tsx",
      },
    });
    const coreOnlyGroupId = "@evjs/provider/page-anchor:tenant-group";
    coreGraph.routes.splice(1, 0, {
      realm: "client",
      id: coreOnlyGroupId,
      applicationId: "default",
      parentId: rootRouteId,
      pattern: {
        segments: [
          { kind: "param", name: "tenant" },
          { kind: "splat", name: "rest" },
        ],
      },
      target: { kind: "group" },
      facets: { wrappers: [] },
      extensions: {},
      provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
    });
    const aliasRouteId = "@evjs/provider/page-anchor:home-alias";
    coreGraph.routes.push({
      realm: "client",
      id: aliasRouteId,
      applicationId: "default",
      pattern: { segments: [{ kind: "static", value: "start" }] },
      target: { kind: "page", pageId: "home" },
      facets: { wrappers: [] },
      extensions: {},
      provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
    });
    coreGraph.applications.default.routeIds.unshift(
      rootRouteId,
      coreOnlyGroupId,
    );
    coreGraph.applications.default.routeIds.push(aliasRouteId);
    coreGraph.extensions.namespaces["@company/application"] = {
      producer: "config-route-provider",
      owners: ["application"],
    };
    coreGraph.extensions.namespaces["@company/menu"] = {
      producer: "config-route-provider",
      owners: ["route"],
    };
    const view = createFrameworkIRView(coreGraph, {
      entries: [],
    } as unknown as BuildPlan);

    expect(view.applications[0]).toEqual({
      id: "default",
      root: ".",
      topology: "spa",
      pageIds: ["home"],
      routeIds: [rootRouteId, coreOnlyGroupId, "home", aliasRouteId],
      documentIds: ["app:default"],
      extensions: {
        "@company/application": { locale: "zh-CN" },
      },
      provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
    });
    expect(view.pages[0]).toEqual({
      id: "home",
      applicationId: "default",
      source: {
        module: "./src/pages/page.tsx",
        scope: { kind: "directory", root: "./src/pages" },
        provider: PAGE_ANCHOR_PROVIDER_ID,
      },
      extensions: {},
      render: "csr",
      provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
    });
    expect(view.pages[0]).not.toHaveProperty("path");
    expect(view.pages[0]).not.toHaveProperty("routeId");
    expect(view.pages[0]).not.toHaveProperty("html");
    const homeRoute = view.routes.find((route) => route.id === "home");
    expect(homeRoute?.extensions).toEqual({
      "@company/menu": { name: "Home" },
    });
    expect(homeRoute).toMatchObject({
      target: { kind: "page", pageId: "home" },
      pattern: { segments: [] },
      facets: {
        layout: "./src/layout.tsx",
        wrappers: ["./src/wrapper.tsx"],
      },
    });
    expect(homeRoute).not.toHaveProperty("path");
    expect(homeRoute).not.toHaveProperty("module");
    expect(Object.isFrozen(homeRoute?.target)).toBe(true);

    const rootRoute = view.routes.find((route) => route.id === rootRouteId);
    expect(rootRoute).toMatchObject({
      realm: "client",
      id: rootRouteId,
      applicationId: "default",
      pattern: { segments: [] },
      target: { kind: "group" },
      facets: { layout: "./src/root-layout.tsx", wrappers: [] },
      provenance: {
        producer: { kind: "provider", id: PAGE_ANCHOR_PROVIDER_ID },
        source: "./src/root-layout.tsx",
      },
      extensions: {},
    });
    expect(
      view.routes.find((route) => route.id === coreOnlyGroupId),
    ).toMatchObject({
      realm: "client",
      parentId: rootRouteId,
      applicationId: "default",
      pattern: {
        segments: [
          { kind: "param", name: "tenant" },
          { kind: "splat", name: "rest" },
        ],
      },
      target: { kind: "group" },
    });
    expect(
      view.routes.find((route) => route.id === aliasRouteId),
    ).toMatchObject({
      target: { kind: "page", pageId: "home" },
      pattern: { segments: [{ kind: "static", value: "start" }] },
    });
    expect(view.routes).toHaveLength(4);
  });

  it("does not leak a physical nested-layout parent into Core route views", () => {
    const coreGraph = createSpaGraph();
    const coreRoute = coreGraph.routes[0];
    if (!coreRoute || coreRoute.realm !== "client") {
      throw new Error("Expected client Route fixture.");
    }
    coreRoute.pattern = {
      segments: [{ kind: "static", value: "users" }],
    };
    coreRoute.facets.layout = "./src/pages/users/layout.tsx";

    const view = createFrameworkIRView(coreGraph, {
      entries: [],
    } as unknown as BuildPlan);
    const route = view.routes.find((candidate) => candidate.id === "home");

    expect(route).not.toHaveProperty("parentId");
    expect(
      view.routes.some((candidate) => candidate.id === "users_layout"),
    ).toBe(false);
    expect(
      view.routes.every(
        (candidate) =>
          candidate.parentId === undefined ||
          view.routes.some((parent) => parent.id === candidate.parentId),
      ),
    ).toBe(true);
  });

  it("types Application entry routes with complete runtime semantics", () => {
    const routes: FrameworkPageAppRouteView[] = [
      {
        id: "account",
        path: "/account",
        kind: "group",
        target: { kind: "group" },
        wrappers: ["./src/wrappers/auth.tsx"],
        layout: false,
        errorModule: "./src/pages/error.tsx",
        notFoundModule: "./src/pages/not-found.tsx",
      },
      {
        id: "legacy-account",
        path: "/legacy-account",
        kind: "redirect",
        target: {
          kind: "redirect",
          to: { kind: "path", path: "/account" },
        },
      },
    ];

    expect(routes[0]).not.toHaveProperty("module");
    expect(routes[0]?.wrappers).toEqual(["./src/wrappers/auth.tsx"]);
    expect(routes[1]?.target).toEqual({
      kind: "redirect",
      to: { kind: "path", path: "/account" },
    });
  });

  it("rejects namespace conflicts and removed compatibility fields", () => {
    const plugin = (name: string, namespace: ConfigExtensionNamespace) =>
      definePlugin({
        name,
        describe(ctx) {
          ctx.pageExtension({ namespace });
        },
      });

    expect(() =>
      collectPluginExtensionRegistry([
        plugin("one", "@company/same"),
        plugin("two", "@company/same"),
      ]),
    ).toThrow('namespace "@company/same"');

    expect(() =>
      collectPluginExtensionRegistry([
        definePlugin({
          name: "removed-raw-key",
          describe(ctx) {
            ctx.pageExtension({
              namespace: "@company/removed",
              // @ts-expect-error raw Smallfish config claims were removed.
              rawKey: "legacy",
            });
          },
        }),
      ]),
    ).toThrow('unknown field "rawKey"');

    expect(() =>
      collectPluginExtensionRegistry([
        definePlugin({
          name: "removed-change",
          describe(ctx) {
            ctx.pageExtension({
              namespace: "@company/removed",
              // @ts-expect-error inert invalidation declarations were removed.
              change: "graph-refresh",
            });
          },
        }),
      ]),
    ).toThrow('unknown field "change"');
  });

  it("rejects non-serializable defaults and invalid resolved values", () => {
    const nonSerializable = definePlugin({
      name: "non-serializable",
      describe(ctx) {
        ctx.pageExtension({
          namespace: "@company/date",
          defaults: new Date() as never,
        });
      },
    });
    expect(() => collectPluginExtensionRegistry([nonSerializable])).toThrow(
      "must contain only arrays and plain objects",
    );

    const invalid = definePlugin({
      name: "invalid",
      describe(ctx) {
        ctx.pageExtension({
          namespace: "@company/invalid",
          defaults: { enabled: false },
          validate: () => "enabled must be true",
        });
      },
    });
    expect(() =>
      applyPluginPageExtensions(
        createSpaGraph(),
        collectPluginExtensionRegistry([invalid]),
      ),
    ).toThrow("enabled must be true");
  });

  it.each([
    [
      "symbol keys",
      Object.defineProperty({}, Symbol("hidden"), { value: true }),
    ],
    ["sparse arrays", new Array(1)],
    ["extra array properties", Object.assign(["value"], { metadata: true })],
  ])("rejects defaults with lossy JSON %s", (_label, defaults) => {
    const plugin = definePlugin({
      name: "lossy-json",
      describe(ctx) {
        ctx.pageExtension({
          namespace: "@company/lossy",
          defaults,
        });
      },
    });

    expect(() => collectPluginExtensionRegistry([plugin])).toThrow(
      /symbol field|sparse array hole|JSON array index/,
    );
  });

  it("rejects non-enumerable and accessor defaults without invoking getters", () => {
    const hiddenDefaults = {};
    Object.defineProperty(hiddenDefaults, "enabled", {
      enumerable: false,
      value: true,
    });
    const hiddenPlugin = definePlugin({
      name: "hidden-defaults",
      describe(ctx) {
        ctx.pageExtension({
          namespace: "@company/hidden-defaults",
          defaults: hiddenDefaults,
        });
      },
    });
    expect(() => collectPluginExtensionRegistry([hiddenPlugin])).toThrow(
      "must be an enumerable own data property",
    );

    let getterWasCalled = false;
    const accessorDefaults = {};
    Object.defineProperty(accessorDefaults, "enabled", {
      enumerable: true,
      get() {
        getterWasCalled = true;
        throw new Error("getter must not execute");
      },
    });
    const accessorPlugin = definePlugin({
      name: "accessor-defaults",
      describe(ctx) {
        ctx.pageExtension({
          namespace: "@company/accessor-defaults",
          defaults: accessorDefaults,
        });
      },
    });
    expect(() => collectPluginExtensionRegistry([accessorPlugin])).toThrow(
      "must be an enumerable own data property",
    );
    expect(getterWasCalled).toBe(false);
  });

  it.each([
    [
      "non-enumerable property",
      () => {
        const value = {};
        Object.defineProperty(value, "enabled", {
          enumerable: false,
          value: true,
        });
        return { value, getterWasCalled: () => false };
      },
    ],
    [
      "accessor property",
      () => {
        let called = false;
        const value = {};
        Object.defineProperty(value, "enabled", {
          enumerable: true,
          get() {
            called = true;
            throw new Error("getter must not execute");
          },
        });
        return { value, getterWasCalled: () => called };
      },
    ],
    [
      "extra array property",
      () => ({
        value: Object.assign(["value"], { metadata: true }),
        getterWasCalled: () => false,
      }),
    ],
  ] as const)("rejects merge results with a %s before validate", (_label, createValue) => {
    const result = createValue();
    let validateWasCalled = false;
    const plugin = definePlugin({
      name: "invalid-merge-result",
      describe(ctx) {
        ctx.pageExtension<unknown>({
          namespace: "@company/invalid-merge-result",
          defaults: { enabled: false },
          merge() {
            return result.value;
          },
          validate() {
            validateWasCalled = true;
          },
        });
      },
    });

    expect(() =>
      applyPluginPageExtensions(
        createSpaGraph(),
        collectPluginExtensionRegistry([plugin]),
        {
          canonical: {
            home: {
              source: "./src/pages/page.config.ts",
              extensions: {
                "@company/invalid-merge-result": { enabled: true },
              },
            },
          },
        },
      ),
    ).toThrow(/enumerable own data property|JSON array index/);
    expect(result.getterWasCalled()).toBe(false);
    expect(validateWasCalled).toBe(false);
  });

  it.each([
    "defaults",
    "merge",
    "validate",
  ] as const)("rejects asynchronous %s callbacks", (callback) => {
    const plugin = definePlugin({
      name: `async-${callback}`,
      describe(ctx) {
        ctx.pageExtension({
          namespace: `@company/async-${callback}`,
          defaults:
            callback === "defaults"
              ? ((async () => ({ enabled: true })) as never)
              : { enabled: false },
          merge:
            callback === "merge"
              ? ((async () => ({ enabled: true })) as never)
              : undefined,
          validate:
            callback === "validate" ? ((async () => true) as never) : undefined,
        });
      },
    });

    expect(() =>
      applyPluginPageExtensions(
        createSpaGraph(),
        collectPluginExtensionRegistry([plugin]),
        {
          canonical: {
            home: {
              source: "./src/pages/page.config.ts",
              extensions: {
                [`@company/async-${callback}`]: { enabled: true },
              },
            },
          },
        },
      ),
    ).toThrow(`${callback} callback must be synchronous`);
  });

  it("rejects unsupported validate callback results", () => {
    const plugin = definePlugin({
      name: "invalid-validate-result",
      describe(ctx) {
        ctx.pageExtension({
          namespace: "@company/invalid-validate-result",
          defaults: { enabled: true },
          validate: (() => ({ accepted: true })) as never,
        });
      },
    });

    expect(() =>
      applyPluginPageExtensions(
        createSpaGraph(),
        collectPluginExtensionRegistry([plugin]),
      ),
    ).toThrow("must return true, false, a message, or undefined");
  });

  it("keeps canonical Page extensions and semantic routes topology-neutral", async () => {
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-plugin-extensions-"),
    );
    tempDirs.push(cwd);
    await fs.mkdir(path.join(cwd, "src/pages/about"), { recursive: true });
    await Promise.all([
      fs.writeFile(
        path.join(cwd, "index.html"),
        '<div id="app"></div>',
        "utf-8",
      ),
      fs.writeFile(
        path.join(cwd, "src/pages/page.tsx"),
        "export default function Home() { return null; }",
        "utf-8",
      ),
      fs.writeFile(
        path.join(cwd, "src/pages/about/page.tsx"),
        "export default function About() { return null; }",
        "utf-8",
      ),
      fs.writeFile(
        path.join(cwd, "src/pages/about/page.config.ts"),
        `
          export default {
            extensions: {
              "@company/canonical-title": {
                text: "About",
                channel: "nested",
              },
            },
          };
        `,
        "utf-8",
      ),
    ]);

    const observations = new Map<
      "spa" | "mpa",
      ReturnType<typeof createCanonicalFrameworkSnapshot>
    >();
    const validatedPages: Array<{
      pageId: string;
      configSource?: string;
      text: unknown;
    }> = [];
    const plugin = definePlugin({
      name: "canonical-page-contract",
      describe(ctx) {
        ctx.pageExtension({
          namespace: "@company/canonical-title",
          defaults: {
            text: "Untitled",
            channel: "default",
          },
          validate(value, context) {
            validatedPages.push({
              pageId: context.pageId,
              configSource: context.configSource,
              text: value.text,
            });
            return typeof value.text === "string" || "text must be a string";
          },
        });
      },
      contributions(ctx) {
        const mode = ctx.config.routing?.mode;
        if (mode !== "spa" && mode !== "mpa") {
          throw new Error("Expected canonical SPA or MPA routing mode.");
        }
        observations.set(mode, createCanonicalFrameworkSnapshot(ctx.framework));
      },
    });

    for (const mode of ["spa", "mpa"] as const) {
      const prepared = await prepareFrameworkBuild(
        {
          routing: { mode },
          plugins: [plugin],
        },
        { cwd },
      );
      await prepared.dispose();
    }

    const spa = observations.get("spa");
    const mpa = observations.get("mpa");
    if (!spa || !mpa) {
      throw new Error("Expected plugin observations for both topologies.");
    }

    expect(mpa.pages).toEqual(spa.pages);
    expect(mpa.routes).toEqual(spa.routes);
    expect(spa.routes).toEqual([
      {
        realm: "client",
        id: "about",
        applicationId: "default",
        pattern: { segments: [{ kind: "static", value: "about" }] },
        target: { kind: "page", pageId: "about" },
        facets: { wrappers: [] },
        extensions: {},
        provenance: {
          producer: {
            kind: "provider",
            id: PAGE_ANCHOR_PROVIDER_ID,
          },
          source: "./src/pages/about/page.tsx",
        },
      },
      {
        realm: "client",
        id: "index",
        applicationId: "default",
        pattern: { segments: [] },
        target: { kind: "page", pageId: "index" },
        facets: { wrappers: [] },
        extensions: {},
        provenance: {
          producer: {
            kind: "provider",
            id: PAGE_ANCHOR_PROVIDER_ID,
          },
          source: "./src/pages/page.tsx",
        },
      },
    ]);
    expect(spa.pages).toEqual([
      {
        id: "about",
        applicationId: "default",
        source: {
          module: "./src/pages/about/page.tsx",
          config: "./src/pages/about/page.config.ts",
          scope: { kind: "directory", root: "./src/pages/about" },
          provider: PAGE_ANCHOR_PROVIDER_ID,
        },
        render: "csr",
        extensions: {
          "@company/canonical-title": {
            text: "About",
            channel: "nested",
          },
        },
        provenance: {
          producer: {
            kind: "provider",
            id: PAGE_ANCHOR_PROVIDER_ID,
          },
          source: "./src/pages/about/page.tsx",
        },
      },
      {
        id: "index",
        applicationId: "default",
        source: {
          module: "./src/pages/page.tsx",
          scope: { kind: "directory", root: "./src/pages" },
          provider: PAGE_ANCHOR_PROVIDER_ID,
        },
        render: "csr",
        extensions: {
          "@company/canonical-title": {
            text: "Untitled",
            channel: "default",
          },
        },
        provenance: {
          producer: {
            kind: "provider",
            id: PAGE_ANCHOR_PROVIDER_ID,
          },
          source: "./src/pages/page.tsx",
        },
      },
    ]);
    expect(validatedPages).toEqual(
      expect.arrayContaining([
        {
          pageId: "about",
          configSource: "./src/pages/about/page.config.ts",
          text: "About",
        },
        {
          pageId: "index",
          configSource: undefined,
          text: "Untitled",
        },
      ]),
    );
    expect(spa.documents).toEqual([
      {
        id: "index",
        template: "./index.html",
        output: "index.html",
        applicationId: "default",
        owner: { kind: "application" },
        bootstrap: { kind: "application" },
        extensions: {},
      },
    ]);
    expect(mpa.documents).toEqual([
      {
        id: "about",
        template: "./index.html",
        output: "about/index.html",
        applicationId: "default",
        owner: { kind: "page", pageId: "about" },
        bootstrap: { kind: "page", pageId: "about" },
        extensions: {},
      },
      {
        id: "index",
        template: "./index.html",
        output: "index.html",
        applicationId: "default",
        owner: { kind: "page", pageId: "index" },
        bootstrap: { kind: "page", pageId: "index" },
        extensions: {},
      },
    ]);
  });

  it("resolves colocated Page extensions while retaining an explicit application route tree", async () => {
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-plugin-extensions-"),
    );
    tempDirs.push(cwd);
    await fs.mkdir(path.join(cwd, "src/pages/dashboard"), {
      recursive: true,
    });
    await Promise.all([
      fs.writeFile(
        path.join(cwd, "index.html"),
        '<div id="app"></div>',
        "utf-8",
      ),
      fs.writeFile(
        path.join(cwd, "src/pages/dashboard/page.tsx"),
        "export default function Dashboard() { return null; }",
        "utf-8",
      ),
      fs.writeFile(
        path.join(cwd, "src/pages/dashboard/page.config.ts"),
        `
          export default {
            extensions: {
              "@company/menu": {
                label: "Dashboard",
                order: 2,
              },
            },
          };
        `,
        "utf-8",
      ),
    ]);

    let observed:
      | ReturnType<typeof createCanonicalFrameworkSnapshot>
      | undefined;
    const plugin = definePlugin({
      name: "explicit-route-page-config",
      describe(ctx) {
        ctx.pageExtension({
          namespace: "@company/menu",
          defaults: { label: "Untitled", order: 0 },
          validate(value) {
            return (
              (typeof value.label === "string" &&
                typeof value.order === "number") ||
              "menu fields must be typed"
            );
          },
        });
      },
      contributions(ctx) {
        observed = createCanonicalFrameworkSnapshot(ctx.framework);
      },
    });

    observed = undefined;
    const prepared = await prepareFrameworkBuild(
      {
        application: {
          routes: [{ path: "/dashboard", component: "dashboard/page" }],
        },
        plugins: [plugin],
      },
      { cwd },
    );

    try {
      const snapshot = observed as
        | ReturnType<typeof createCanonicalFrameworkSnapshot>
        | undefined;
      expect(snapshot).toBeDefined();
      if (!snapshot) {
        throw new Error("Plugin did not observe the framework snapshot.");
      }
      expect(snapshot.pages).toEqual([
        {
          id: "dashboard",
          applicationId: "default",
          source: {
            module: "./src/pages/dashboard/page.tsx",
            config: "./src/pages/dashboard/page.config.ts",
            scope: {
              kind: "directory",
              root: "./src/pages/dashboard",
            },
            provider: CONFIG_ROUTE_PROVIDER_ID,
          },
          render: "csr",
          extensions: {
            "@company/menu": {
              label: "Dashboard",
              order: 2,
            },
          },
          provenance: {
            producer: {
              kind: "provider",
              id: CONFIG_ROUTE_PROVIDER_ID,
            },
            source: "./src/pages/dashboard/page.tsx",
          },
        },
      ]);
      expect(snapshot.routes).toEqual([
        expect.objectContaining({
          pattern: {
            segments: [{ kind: "static", value: "dashboard" }],
          },
          target: { kind: "page", pageId: "dashboard" },
        }),
      ]);
      const manifest = JSON.parse(
        await fs.readFile(path.join(cwd, ".ev/manifest.json"), "utf-8"),
      ) as { graph: CoreGraph };
      expect(manifest.graph.pages.dashboard.source).toEqual({
        module: "./src/pages/dashboard/page.tsx",
        config: "./src/pages/dashboard/page.config.ts",
        scope: {
          kind: "directory",
          root: "./src/pages/dashboard",
        },
        provider: CONFIG_ROUTE_PROVIDER_ID,
      });
      const route = manifest.graph.routes.find(
        (candidate) =>
          candidate.realm === "client" &&
          candidate.target.kind === "page" &&
          candidate.target.pageId === "dashboard",
      );
      expect(route?.provenance).toEqual({
        producer: {
          kind: "provider",
          id: CONFIG_ROUTE_PROVIDER_ID,
        },
        source: "./src/pages/dashboard/page.tsx",
      });
    } finally {
      await prepared.dispose();
    }
  });

  it("keeps explicit-route Page rendering config in the SPA graph", async () => {
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-plugin-extensions-"),
    );
    tempDirs.push(cwd);
    await fs.mkdir(path.join(cwd, "src/pages/report"), { recursive: true });
    await Promise.all([
      fs.writeFile(
        path.join(cwd, "index.html"),
        '<div id="app"></div>',
        "utf-8",
      ),
      fs.writeFile(
        path.join(cwd, "src/pages/report/page.tsx"),
        "export default function Report() { return null; }",
        "utf-8",
      ),
      fs.writeFile(
        path.join(cwd, "src/pages/report/page.config.ts"),
        `
          export default {
            render: "ssr",
            hydrate: "none",
            prerender: { revalidate: 60 },
            rsc: true,
          };
        `,
        "utf-8",
      ),
    ]);

    const prepared = await prepareFrameworkBuild(
      {
        application: {
          routes: [{ path: "/report", page: "report" }],
        },
      },
      { cwd },
    );
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(cwd, ".ev/manifest.json"), "utf-8"),
      ) as { graph: CoreGraph };
      expect(manifest.graph.pages.report).toMatchObject({
        render: "ssr",
        componentModel: "rsc",
        hydrate: "none",
        prerender: { revalidate: 60 },
      });
      expect(manifest.graph.pages.report.extensions).toEqual({});
      expect(manifest.graph.extensions.namespaces).not.toHaveProperty(
        "@evjs/core/page-rendering",
      );
    } finally {
      await prepared.dispose();
    }
  });

  it("rejects orphan, duplicate, and invalid explicit-route Page configs", async () => {
    const cases = [
      {
        files: {
          "src/pages/home/page.tsx":
            "export default function Home() { return null; }",
          "src/pages/orphan/page.config.ts": "export default {};",
        },
        message:
          "is not colocated with a Page referenced by application.routes",
      },
      {
        files: {
          "src/pages/home/page.tsx":
            "export default function Home() { return null; }",
          "src/pages/home/page.config.ts": "export default {};",
          "src/pages/home/page.config.js": "export default {};",
        },
        message: "has more than one Page config module",
      },
      {
        files: {
          "src/pages/home/page.tsx":
            "export default function Home() { return null; }",
          "src/pages/home/page.config.ts":
            'export default { unsupported: true, extensions: { "@company/strict": { enabled: true } } };',
        },
        message: 'has unknown field "unsupported"',
      },
      {
        files: {
          "src/pages/home/page.tsx":
            "export default function Home() { return null; }",
          "src/pages/home/page.config.ts":
            'export default { render: "csr", rsc: true };',
        },
        message: 'uses RSC and must declare render: "ssr"',
      },
    ] as const;

    for (const fixture of cases) {
      const cwd = await fs.mkdtemp(
        path.join(os.tmpdir(), "evjs-plugin-extensions-"),
      );
      tempDirs.push(cwd);
      await Promise.all(
        Object.entries({
          "index.html": '<div id="app"></div>',
          ...fixture.files,
        }).map(async ([file, source]) => {
          const absolute = path.join(cwd, file);
          await fs.mkdir(path.dirname(absolute), { recursive: true });
          await fs.writeFile(absolute, source, "utf-8");
        }),
      );
      const plugin = definePlugin({
        name: "strict-explicit-route-page-config",
        describe(ctx) {
          ctx.pageExtension({
            namespace: "@company/strict",
          });
        },
      });

      await expect(
        prepareFrameworkBuild(
          {
            application: {
              routes: [{ path: "/", page: "home" }],
            },
            plugins: [plugin],
          },
          { cwd },
        ),
      ).rejects.toThrow(fixture.message);
    }
  });

  it("rejects an unregistered canonical Page extension namespace", async () => {
    const cwd = await createCanonicalPageFixture(`
      export default {
        extensions: {
          "@company/unregistered": { enabled: true },
        },
      };
    `);

    await expect(
      prepareFrameworkBuild(
        {
          routing: { mode: "spa" },
        },
        { cwd },
      ),
    ).rejects.toThrow(
      /uses extension namespace "@company\/unregistered".*no plugin pageExtension\(\) registered it/,
    );
  });

  it("runs plugin validation against canonical Page extension values", async () => {
    const cwd = await createCanonicalPageFixture(`
      export default {
        extensions: {
          "@company/title": { text: 42 },
        },
      };
    `);
    const plugin = definePlugin({
      name: "validated-title",
      describe(ctx) {
        ctx.pageExtension({
          namespace: "@company/title",
          defaults: { text: "Untitled" },
          validate(value) {
            return typeof value.text === "string" || "text must be a string";
          },
        });
      },
    });

    await expect(
      prepareFrameworkBuild(
        {
          routing: { mode: "spa" },
          plugins: [plugin],
        },
        { cwd },
      ),
    ).rejects.toThrow("text must be a string");
  });

  it("runs describe once before setup and exposes resolved extensions to contributions", async () => {
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-plugin-extensions-"),
    );
    tempDirs.push(cwd);
    await fs.mkdir(path.join(cwd, "src/pages/home"), { recursive: true });
    await fs.writeFile(
      path.join(cwd, "index.html"),
      '<div id="app"></div>',
      "utf-8",
    );
    await fs.writeFile(
      path.join(cwd, "src/pages/home/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await fs.writeFile(
      path.join(cwd, "src/pages/home/page.config.ts"),
      `export default {
        extensions: {
          "@company/title": { text: "Home" },
        },
      };`,
      "utf-8",
    );

    const events: string[] = [];
    let observed: unknown;
    const plugin = definePlugin<Record<string, never>>({
      name: "observable-extension",
      describe(ctx) {
        events.push("describe");
        ctx.pageExtension({
          namespace: "@company/title",
        });
      },
      setup() {
        events.push("setup");
      },
      contributions(ctx) {
        events.push("contributions");
        observed = ctx.framework.pages.find((page) => page.id === "home")
          ?.extensions?.["@company/title"];
        ctx.slot("resolve.alias").add({
          id: "force-alias-convergence",
          specifier: "@extension-test",
          replacement: "./src",
        });
      },
    });

    const prepared = await prepareFrameworkBuild(
      {
        routing: { mode: "spa" },
        plugins: [plugin],
      },
      { cwd },
    );

    expect(events[0]).toBe("describe");
    expect(events[1]).toBe("setup");
    expect(events.filter((event) => event === "describe")).toHaveLength(1);
    expect(events.filter((event) => event === "contributions").length).toBe(2);
    expect(observed).toEqual({ text: "Home" });
    await prepared.dispose();
  });
});

async function createCanonicalPageFixture(pageConfigSource: string) {
  const cwd = await fs.mkdtemp(
    path.join(os.tmpdir(), "evjs-plugin-extensions-"),
  );
  tempDirs.push(cwd);
  await fs.mkdir(path.join(cwd, "src/pages/home"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(cwd, "index.html"), '<div id="app"></div>', "utf-8"),
    fs.writeFile(
      path.join(cwd, "src/pages/home/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    ),
    fs.writeFile(
      path.join(cwd, "src/pages/home/page.config.ts"),
      pageConfigSource,
      "utf-8",
    ),
  ]);
  return cwd;
}

function createSpaGraph(): CoreGraph {
  return {
    rootDir: ".",
    applications: {
      default: {
        id: "default",
        root: ".",
        topology: "spa",
        pageIds: ["home"],
        routeIds: ["home"],
        documentIds: ["app:default"],
        extensions: {},
        provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
      },
    },
    pages: {
      home: {
        id: "home",
        applicationId: "default",
        render: "csr",
        source: {
          module: "./src/pages/page.tsx",
          scope: { kind: "directory", root: "./src/pages" },
          provider: PAGE_ANCHOR_PROVIDER_ID,
        },
        extensions: {},
        provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
      },
    },
    routes: [
      {
        realm: "client",
        id: "home",
        applicationId: "default",
        pattern: { segments: [] },
        target: { kind: "page", pageId: "home" },
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
  return { producer: { kind: "provider" as const, id } };
}

function createCanonicalFrameworkSnapshot(framework: FrameworkIRView) {
  return {
    pages: framework.pages
      .map((page) => ({
        id: page.id,
        applicationId: page.applicationId,
        source: page.source,
        render: page.render,
        ...(page.metadata ? { metadata: page.metadata } : {}),
        extensions: page.extensions,
        provenance: page.provenance,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    routes: framework.routes
      .map((route) => ({
        realm: route.realm,
        id: route.id,
        applicationId: route.applicationId,
        ...(route.parentId ? { parentId: route.parentId } : {}),
        pattern: route.pattern,
        target: route.target,
        facets: route.facets,
        extensions: route.extensions,
        provenance: route.provenance,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    documents: framework.documents
      .map((document) => ({
        id: document.id,
        template: document.template,
        output: document.output,
        applicationId: document.applicationId,
        owner: document.owner,
        bootstrap: document.bootstrap,
        extensions: document.extensions,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}
