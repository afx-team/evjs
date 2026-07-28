import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type BuildPlan,
  CONFIG_ROUTE_PROVIDER_ID,
  type CoreGraph,
  PAGE_ANCHOR_PROVIDER_ID,
} from "@evjs/shared/manifest";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  inspectFrameworkBuild,
  prepareFrameworkBuild,
} from "../src/_internal/build/commands.js";
import { createFrameworkIRView } from "../src/_internal/build/generated-contributions.js";
import { createCoreGraph } from "../src/_internal/build/graph/index.js";
import {
  applyPluginExtensions,
  collectPluginExtensionRegistry,
  createPluginExtensionResolutionSession,
  resolvePluginApplicationExtensions,
} from "../src/_internal/build/plugin-extensions.js";
import {
  type Config,
  type ConfigExtensionNamespace,
  resolveConfig,
  type StaticConfigCompatible,
} from "../src/config/index.js";
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

describe("plugin Application extensions", () => {
  it("keeps extension authoring types inside the static JSON boundary", () => {
    // biome-ignore lint/complexity/noBannedTypes: This test covers the broad `{}` loophole.
    type BroadEmptyObject = {};

    interface OptionalValue {
      enabled: boolean;
      label?: string;
      nested: {
        values: readonly number[];
      };
    }

    const plugin = definePlugin({
      name: "static-extension-types",
      describe(ctx) {
        expectTypeOf<StaticConfigCompatible<object>>().toEqualTypeOf<never>();
        expectTypeOf<
          StaticConfigCompatible<BroadEmptyObject>
        >().toEqualTypeOf<never>();

        ctx.applicationExtension<OptionalValue>({
          namespace: "@company/static-types",
          defaults: {
            enabled: true,
            nested: { values: [1, 2] },
          },
        });

        // @ts-expect-error Date cannot cross the static config boundary.
        ctx.pageExtension<Date>({
          namespace: "@company/date",
          defaults: new Date(),
        });
        // @ts-expect-error Map cannot cross the static config boundary.
        ctx.pageExtension<Map<string, string>>({
          namespace: "@company/map",
          defaults: new Map(),
        });
        // @ts-expect-error object does not prove a static JSON value shape.
        ctx.pageExtension<object>({
          namespace: "@company/object",
          defaults: {},
        });
        // @ts-expect-error {} does not prove a static JSON value shape.
        ctx.pageExtension<BroadEmptyObject>({
          namespace: "@company/empty-object",
          defaults: {},
        });
      },
    });

    expect(plugin.name).toBe("static-extension-types");
  });

  it("resolves Application and Page owners under one plugin namespace", () => {
    const validated: string[] = [];
    const plugin = definePlugin({
      name: "shared-owner",
      describe(ctx) {
        ctx.applicationExtension<
          { enabled: boolean; channel: string },
          { enabled?: boolean }
        >({
          namespace: "@company/shared",
          schemaVersion: "1",
          defaults: { enabled: false, channel: "web" },
          validate(value, context) {
            expect(Object.isFrozen(value)).toBe(true);
            expect(Object.isFrozen(context)).toBe(false);
            validated.push(`application:${context.applicationId}`);
          },
        });
        ctx.pageExtension({
          namespace: "@company/shared",
          schemaVersion: "1",
          defaults: ({ pageId }) => ({ pageId }),
          validate(_value, context) {
            validated.push(`page:${context.pageId}`);
          },
        });
      },
    });
    const registry = collectPluginExtensionRegistry([plugin]);
    const config = resolveConfig({
      routing: { mode: "spa" },
      extensions: {
        "@company/shared": { enabled: true },
      },
    });
    const application = resolvePluginApplicationExtensions(config, registry);

    expect(application).toEqual({
      "@company/shared": { enabled: true, channel: "web" },
    });
    expect(Object.isFrozen(application)).toBe(true);
    expect(Object.isFrozen(application["@company/shared"])).toBe(true);

    const resolved = applyPluginExtensions(createSpaGraph(), registry, {
      applicationExtensions: application,
    });
    expect(resolved.applications.default.extensions).toEqual({
      "@company/shared": { enabled: true, channel: "web" },
    });
    expect(resolved.pages.home.extensions).toEqual({
      "@company/shared": { pageId: "home" },
    });
    expect(resolved.extensions.namespaces["@company/shared"]).toEqual({
      producer: "shared-owner",
      owners: ["application", "page"],
      schemaVersion: "1",
    });
    expect(validated).toEqual(["application:default", "page:home"]);
  });

  it("resolves registered Route and Document inputs from explicit application routes", async () => {
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-route-document-extensions-"),
    );
    tempDirs.push(cwd);
    await Promise.all([
      fs.mkdir(path.join(cwd, "src/layouts"), { recursive: true }),
      fs.mkdir(path.join(cwd, "src/pages/home"), { recursive: true }),
    ]);
    await Promise.all([
      fs.writeFile(
        path.join(cwd, "index.html"),
        '<div id="app"></div>',
        "utf-8",
      ),
      fs.writeFile(
        path.join(cwd, "src/layouts/Section.tsx"),
        "export default function Section({ children }) { return children; }",
        "utf-8",
      ),
      fs.writeFile(
        path.join(cwd, "src/pages/home/page.tsx"),
        "export default function Home() { return null; }",
        "utf-8",
      ),
    ]);

    const observedRouteKinds: string[] = [];
    const plugin = definePlugin({
      name: "route-document-owner",
      describe(ctx) {
        ctx.routeExtension<
          { enabled: boolean; label: string },
          { label: string }
        >({
          namespace: "@company/navigation",
          schemaVersion: "1",
          defaults(context) {
            observedRouteKinds.push(context.target.kind);
            return { enabled: true, label: context.target.kind };
          },
          validate(value, context) {
            return (
              (value.enabled === true &&
                context.applicationId === "default" &&
                context.pattern.segments.length >= 0) ||
              "invalid route extension"
            );
          },
        });
        ctx.documentExtension<
          { enabled: boolean; theme: string },
          { theme: string }
        >({
          namespace: "@company/navigation",
          schemaVersion: "1",
          defaults: ({ owner }) => ({
            enabled: true,
            theme: owner.kind,
          }),
        });
      },
    });
    const config = resolveConfig({
      application: {
        document: {
          extensions: {
            "@company/navigation": { theme: "dark" },
          },
        },
        routes: [
          {
            path: "/",
            page: "home",
            layout: "@/layouts/Section",
            extensions: {
              "@company/navigation": { label: "Home" },
            },
          },
          {
            path: "/legacy",
            redirect: "/",
            extensions: {
              "@company/navigation": { label: "Legacy" },
            },
          },
          {
            path: "/section",
            extensions: {
              "@company/navigation": { label: "Section" },
            },
            routes: [{ path: "home", page: "home" }],
          },
        ],
      },
      plugins: [plugin],
    });
    const registry = collectPluginExtensionRegistry(config.plugins);
    const { graph } = await createCoreGraph(config, cwd, {
      pluginExtensions: registry,
    });

    expect(graph.extensions.namespaces["@company/navigation"]).toEqual({
      producer: "route-document-owner",
      owners: ["route", "document"],
      schemaVersion: "1",
    });
    const pageRoute = graph.routes.find(
      (route) => route.target.kind === "page",
    );
    expect(pageRoute?.extensions["@company/navigation"]).toEqual({
      enabled: true,
      label: "Home",
    });
    expect(pageRoute?.parentId).toBe(`${CONFIG_ROUTE_PROVIDER_ID}:route:0`);
    const layoutRoute = graph.routes.find(
      (route) => route.facets.layout === "./src/layouts/Section.tsx",
    );
    expect(layoutRoute?.extensions["@company/navigation"]).toEqual({
      enabled: true,
      label: "group",
    });
    const redirectRoute = graph.routes.find(
      (route) => route.target.kind === "redirect",
    );
    expect(redirectRoute?.extensions["@company/navigation"]).toEqual({
      enabled: true,
      label: "Legacy",
    });
    const sectionRoute = graph.routes.find(
      (route) =>
        route.target.kind === "group" &&
        route.pattern.segments.some(
          (segment) => segment.kind === "static" && segment.value === "section",
        ),
    );
    expect(sectionRoute?.extensions["@company/navigation"]).toEqual({
      enabled: true,
      label: "Section",
    });
    expect(graph.documents.index.extensions["@company/navigation"]).toEqual({
      enabled: true,
      theme: "dark",
    });
    expect(observedRouteKinds.sort()).toEqual([
      "group",
      "group",
      "page",
      "page",
      "redirect",
    ]);

    const unregistered = resolveConfig({
      application: {
        routes: [
          {
            path: "/",
            page: "home",
            extensions: {
              "@company/missing": true,
            },
          },
        ],
      },
    });
    await expect(createCoreGraph(unregistered, cwd)).rejects.toThrow(
      'application.routes[0].extensions uses extension namespace "@company/missing", but no plugin routeExtension() registered it',
    );
  });

  it("projects canonical page.config Route extensions without changing Page ownership", async () => {
    const cwd = await createCanonicalPageFixture(`
      export default {
        extensions: {
          "@company/access": { pageLabel: "Home Page" },
        },
        route: {
          extensions: {
            "@company/access": { policy: "canReadHome" },
          },
        },
      };
    `);
    const plugin = definePlugin({
      name: "canonical-page-route-owner",
      describe(ctx) {
        ctx.pageExtension({
          namespace: "@company/access",
          schemaVersion: "1",
        });
        ctx.routeExtension({
          namespace: "@company/access",
          schemaVersion: "1",
        });
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
      try {
        const manifest = JSON.parse(
          await fs.readFile(path.join(cwd, ".ev/manifest.json"), "utf-8"),
        ) as { graph: CoreGraph };
        expect(manifest.graph.pages.home.extensions["@company/access"]).toEqual(
          {
            pageLabel: "Home Page",
          },
        );
        const route = manifest.graph.routes.find(
          (candidate) =>
            candidate.target.kind === "page" &&
            candidate.target.pageId === "home",
        );
        expect(route?.extensions["@company/access"]).toEqual({
          policy: "canReadHome",
        });
        expect(manifest.graph.extensions.namespaces["@company/access"]).toEqual(
          {
            producer: "canonical-page-route-owner",
            owners: ["page", "route"],
            schemaVersion: "1",
          },
        );
      } finally {
        await prepared.dispose();
      }
    }
  });

  it("projects page.config Document extensions only to Page-owned Documents", async () => {
    const cwd = await createCanonicalPageFixture(`
      export default {
        document: {
          aliases: ["home.html"],
          extensions: {
            "@company/html": { theme: "dark" },
          },
        },
      };
    `);
    const plugin = definePlugin({
      name: "canonical-page-document-owner",
      describe(ctx) {
        ctx.documentExtension({
          namespace: "@company/html",
          defaults: ({ aliases }) => ({
            theme: "light",
            enabled: true,
            aliasCount: aliases?.length ?? 0,
          }),
        });
      },
    });

    const prepared = await prepareFrameworkBuild(
      {
        routing: { mode: "mpa" },
        plugins: [plugin],
      },
      { cwd },
    );
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(cwd, ".ev/manifest.json"), "utf-8"),
      ) as { graph: CoreGraph };
      expect(manifest.graph.documents.home.extensions["@company/html"]).toEqual(
        {
          theme: "dark",
          enabled: true,
          aliasCount: 1,
        },
      );
      expect(manifest.graph.extensions.namespaces["@company/html"]).toEqual({
        producer: "canonical-page-document-owner",
        owners: ["document"],
      });
    } finally {
      await prepared.dispose();
    }

    const spaSsgCwd = await createCanonicalPageFixture(`
      export default {
        render: "ssg",
        document: {
          aliases: ["home.html"],
          extensions: {
            "@company/html": { theme: "dark" },
          },
        },
      };
    `);
    const spaSsgPrepared = await prepareFrameworkBuild(
      {
        routing: { mode: "spa" },
        plugins: [plugin],
      },
      { cwd: spaSsgCwd },
    );
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(spaSsgCwd, ".ev/manifest.json"), "utf-8"),
      ) as { graph: CoreGraph };
      const pageDocument = Object.values(manifest.graph.documents).find(
        (document) =>
          document.owner.kind === "page" && document.owner.pageId === "home",
      );
      expect(pageDocument).toMatchObject({
        aliases: ["home.html"],
        extensions: {
          "@company/html": {
            theme: "dark",
            enabled: true,
            aliasCount: 1,
          },
        },
      });
    } finally {
      await spaSsgPrepared.dispose();
    }

    const defaultsOnlySpaSsgCwd = await createCanonicalPageFixture(`
      export default {
        render: "ssg",
      };
    `);
    const defaultsOnlySpaSsgPrepared = await prepareFrameworkBuild(
      {
        routing: { mode: "spa" },
        plugins: [plugin],
      },
      { cwd: defaultsOnlySpaSsgCwd },
    );
    try {
      const manifest = JSON.parse(
        await fs.readFile(
          path.join(defaultsOnlySpaSsgCwd, ".ev/manifest.json"),
          "utf-8",
        ),
      ) as { graph: CoreGraph };
      const pageDocument = Object.values(manifest.graph.documents).find(
        (document) =>
          document.owner.kind === "page" && document.owner.pageId === "home",
      );
      expect(pageDocument).toMatchObject({
        output: "home/index.html",
        extensions: {
          "@company/html": {
            theme: "light",
            enabled: true,
            aliasCount: 0,
          },
        },
      });
      expect(pageDocument).not.toHaveProperty("aliases");
    } finally {
      await defaultsOnlySpaSsgPrepared.dispose();
    }

    await expect(
      prepareFrameworkBuild(
        {
          routing: { mode: "spa" },
          plugins: [plugin],
        },
        { cwd },
      ),
    ).rejects.toThrow(
      "document requires an independently materialized Page Document",
    );
  });

  it("rejects unregistered and multiply-targeted page.config Route extensions", async () => {
    const cwd = await createCanonicalPageFixture(`
      export default {
        route: {
          extensions: {
            "@company/access": { policy: "canReadHome" },
          },
        },
      };
    `);
    const config = resolveConfig({
      application: {
        routes: [
          { path: "/", page: "home" },
          { path: "/start", page: "home" },
        ],
      },
      plugins: [
        definePlugin({
          name: "route-owner",
          describe(ctx) {
            ctx.routeExtension({ namespace: "@company/access" });
          },
        }),
      ],
    });

    await expect(
      createCoreGraph(config, cwd, {
        pluginExtensions: collectPluginExtensionRegistry(config.plugins),
      }),
    ).rejects.toThrow(
      'is ambiguous because Page "home" is targeted by 2 semantic Routes',
    );

    const unregistered = resolveConfig({
      application: {
        routes: [{ path: "/", page: "home" }],
      },
    });
    await expect(createCoreGraph(unregistered, cwd)).rejects.toThrow(
      "no plugin routeExtension() registered it",
    );
  });

  it("rejects unknown Application namespaces and missing Applications", () => {
    expect(() =>
      resolvePluginApplicationExtensions(
        resolveConfig({
          routing: { mode: "spa" },
          extensions: { "@company/missing": true },
        }),
        collectPluginExtensionRegistry([]),
      ),
    ).toThrow("no plugin applicationExtension() registered it");

    const plugin = definePlugin({
      name: "application-only",
      describe(ctx) {
        ctx.applicationExtension({
          namespace: "@company/application-only",
        });
      },
    });
    expect(() =>
      resolvePluginApplicationExtensions(
        resolveConfig({
          conventions: false,
          extensions: { "@company/application-only": true },
        }),
        collectPluginExtensionRegistry([plugin]),
      ),
    ).toThrow("project has no framework Application");
  });

  it("rejects duplicate owners and inconsistent shared schema versions", () => {
    expect(() =>
      collectPluginExtensionRegistry([
        definePlugin({
          name: "duplicate-owner",
          describe(ctx) {
            ctx.applicationExtension({ namespace: "@company/duplicate" });
            ctx.applicationExtension({ namespace: "@company/duplicate" });
          },
        }),
      ]),
    ).toThrow("more than once");

    expect(() =>
      collectPluginExtensionRegistry([
        definePlugin({
          name: "schema-conflict",
          describe(ctx) {
            ctx.applicationExtension({
              namespace: "@company/schema",
              schemaVersion: "1",
            });
            ctx.pageExtension({
              namespace: "@company/schema",
              schemaVersion: "2",
            });
          },
        }),
      ]),
    ).toThrow("must use one schemaVersion");
  });

  it("requires one pre-setup Application snapshot and never merges it twice", async () => {
    let mergeCalls = 0;
    const plugin = definePlugin({
      name: "single-application-resolution",
      describe(ctx) {
        ctx.applicationExtension<{ count: number }, { increment: number }>({
          namespace: "@company/single-resolution",
          defaults: { count: 1 },
          merge(defaults, configured) {
            mergeCalls += 1;
            return {
              count: (defaults?.count ?? 0) + configured.increment,
            };
          },
        });
      },
    });
    const config = resolveConfig({
      routing: { mode: "spa" },
      extensions: {
        "@company/single-resolution": { increment: 2 },
      },
      plugins: [plugin],
    });
    const registry = collectPluginExtensionRegistry(config.plugins);

    await expect(
      createCoreGraph(config, process.cwd(), {
        pluginExtensions: registry,
      }),
    ).rejects.toThrow("resolved before plugin setup");
    expect(mergeCalls).toBe(0);

    const applicationExtensions = resolvePluginApplicationExtensions(
      config,
      registry,
    );
    expect(mergeCalls).toBe(1);

    const analysis = await createCoreGraph(config, process.cwd(), {
      pluginExtensions: registry,
      applicationExtensions,
    });
    expect(mergeCalls).toBe(1);
    expect(
      analysis.graph.applications.default.extensions[
        "@company/single-resolution"
      ],
    ).toEqual({ count: 3 });
  });

  it("does not require an Application snapshot when the graph has no Application", async () => {
    const plugin = definePlugin({
      name: "application-extension-without-application",
      describe(ctx) {
        ctx.applicationExtension({
          namespace: "@company/no-application",
          defaults: { enabled: true },
        });
      },
    });
    const config = resolveConfig({
      conventions: false,
      plugins: [plugin],
    });
    const registry = collectPluginExtensionRegistry(config.plugins);

    const analysis = await createCoreGraph(config, process.cwd(), {
      pluginExtensions: registry,
    });

    expect(analysis.graph.applications).toEqual({});
    expect(
      analysis.graph.extensions.namespaces["@company/no-application"],
    ).toEqual({
      producer: "application-extension-without-application",
      owners: ["application"],
    });
  });

  it("exposes one Application extension contract across SPA, MPA, and explicit route trees", async () => {
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-application-extension-"),
    );
    tempDirs.push(cwd);
    await fs.mkdir(path.join(cwd, "src/pages"), { recursive: true });
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
    ]);

    const setupValues: unknown[] = [];
    const contributionValues: unknown[] = [];
    const routingModes: string[] = [];
    const manifestValues: unknown[] = [];
    const plugin = definePlugin({
      name: "setup-application-extension",
      describe(ctx) {
        ctx.applicationExtension({
          namespace: "@company/setup",
          defaults: { enabled: false, channel: "web" },
        });
      },
      setup(ctx) {
        setupValues.push(ctx.config.extensions["@company/setup"]);
      },
      contributions(ctx) {
        contributionValues.push(
          ctx.framework.applications[0]?.extensions["@company/setup"],
        );
        routingModes.push(
          ctx.framework.applications[0]?.routingMode ?? "missing",
        );
      },
    });

    const sources: Config[] = [
      { routing: { mode: "spa" } },
      { routing: { mode: "mpa" } },
      {
        application: {
          routes: [{ path: "/", component: "./page" }],
        },
      },
    ];
    for (const source of sources) {
      const prepared = await prepareFrameworkBuild(
        {
          ...source,
          extensions: {
            "@company/setup": { enabled: true },
          },
          plugins: [plugin],
        },
        { cwd },
      );
      try {
        const manifest = JSON.parse(
          await fs.readFile(path.join(cwd, ".ev/manifest.json"), "utf-8"),
        ) as { graph: CoreGraph };
        manifestValues.push(
          manifest.graph.applications.default.extensions["@company/setup"],
        );
        expect(manifest.graph.extensions.namespaces["@company/setup"]).toEqual({
          producer: "setup-application-extension",
          owners: ["application"],
        });
      } finally {
        await prepared.dispose();
      }
    }

    expect(setupValues).toHaveLength(3);
    expect(setupValues.every((value) => Object.isFrozen(value))).toBe(true);
    expect(setupValues).toEqual([
      { enabled: true, channel: "web" },
      { enabled: true, channel: "web" },
      { enabled: true, channel: "web" },
    ]);
    expect(contributionValues).toEqual(setupValues);
    expect(manifestValues).toEqual(setupValues);
    expect(routingModes).toEqual(["spa", "mpa", "spa"]);
  });

  it("uses the same resolved Application snapshot in inspect setup and graph", async () => {
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-inspect-application-extension-"),
    );
    tempDirs.push(cwd);
    await fs.mkdir(path.join(cwd, "src/pages"), { recursive: true });
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
    ]);

    const setupValues: unknown[] = [];
    let mergeCalls = 0;
    const plugin = definePlugin({
      name: "inspect-application-extension",
      describe(ctx) {
        ctx.applicationExtension<
          { enabled: boolean; mergeCall: number },
          { enabled: boolean }
        >({
          namespace: "@company/inspect",
          defaults: { enabled: false, mergeCall: 0 },
          merge(_defaults, configured) {
            mergeCalls += 1;
            return { ...configured, mergeCall: mergeCalls };
          },
        });
      },
      setup(ctx) {
        setupValues.push(ctx.config.extensions["@company/inspect"]);
      },
    });

    const result = await inspectFrameworkBuild(
      {
        routing: { mode: "spa" },
        extensions: {
          "@company/inspect": { enabled: true },
        },
        plugins: [plugin],
      },
      { cwd },
    );

    expect(result.diagnostics).toEqual([]);
    expect(mergeCalls).toBe(1);
    expect(setupValues).toEqual([{ enabled: true, mergeCall: 1 }]);
    expect(
      result.graph.applications.default.extensions["@company/inspect"],
    ).toEqual(setupValues[0]);
  });
});

describe("plugin Page extensions", () => {
  it("reuses only unchanged Page inputs within one resolution session", () => {
    const calls = { defaults: 0, merge: 0, validate: 0 };
    const plugin = definePlugin({
      name: "page-resolution-session",
      describe(ctx) {
        ctx.pageExtension<
          { text: string; options: { a: number; b: number } },
          { text: string; options: { a: number; b: number } }
        >({
          namespace: "@company/session",
          defaults() {
            calls.defaults += 1;
            return { text: "Default", options: { a: 0, b: 0 } };
          },
          merge(_defaults, configured) {
            calls.merge += 1;
            return configured;
          },
          validate() {
            calls.validate += 1;
          },
        });
      },
    });
    const registry = collectPluginExtensionRegistry([plugin]);
    const extensionResolutionSession =
      createPluginExtensionResolutionSession(registry);
    expect(() =>
      applyPluginExtensions(
        createSpaGraph(),
        collectPluginExtensionRegistry([plugin]),
        { extensionResolutionSession },
      ),
    ).toThrow("must use the registry that created it");
    const resolve = (
      source: string,
      configured: {
        text: string;
        options: { a: number; b: number };
      },
    ) =>
      applyPluginExtensions(createSpaGraph(), registry, {
        canonicalPages: {
          home: {
            source,
            extensions: { "@company/session": configured },
          },
        },
        extensionResolutionSession,
      });

    const first = resolve("./src/pages/page.config.ts", {
      text: "Home",
      options: { a: 1, b: 2 },
    });
    (
      first.pages.home.extensions["@company/session"] as {
        text: string;
      }
    ).text = "mutated";
    const sameInput = resolve("./src/pages/page.config.ts", {
      text: "Home",
      options: { b: 2, a: 1 },
    });

    expect(sameInput.pages.home.extensions["@company/session"]).toEqual({
      text: "Home",
      options: { a: 1, b: 2 },
    });
    expect(calls).toEqual({ defaults: 1, merge: 1, validate: 1 });

    resolve("./src/pages/page.config.ts", {
      text: "Orders",
      options: { a: 1, b: 2 },
    });
    resolve("./src/pages/renamed.config.ts", {
      text: "Orders",
      options: { a: 1, b: 2 },
    });
    expect(calls).toEqual({ defaults: 3, merge: 3, validate: 3 });
  });

  it("keeps the failed inspect contribution on its original Page snapshot", async () => {
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-inspect-page-extension-failure-"),
    );
    tempDirs.push(cwd);
    await fs.mkdir(path.join(cwd, "src/pages"), { recursive: true });
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
        path.join(cwd, "src/pages/page.config.ts"),
        `export default {
          extensions: {
            "@company/inspect-page": { enabled: true },
          },
        };`,
        "utf-8",
      ),
    ]);

    let mergeCalls = 0;
    const plugin = definePlugin({
      name: "inspect-page-extension-failure",
      describe(ctx) {
        ctx.pageExtension<
          { enabled: boolean; generation: number },
          { enabled: boolean }
        >({
          namespace: "@company/inspect-page",
          merge(_defaults, configured) {
            mergeCalls += 1;
            return { ...configured, generation: mergeCalls };
          },
        });
      },
      contributions() {
        throw new Error("inspect contribution failed");
      },
    });

    const result = await inspectFrameworkBuild(
      {
        routing: { mode: "spa" },
        plugins: [plugin],
      },
      { cwd },
    );

    expect(mergeCalls).toBe(1);
    expect(
      result.graph.pages.index.extensions["@company/inspect-page"],
    ).toEqual({
      enabled: true,
      generation: 1,
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        source: "contributions",
        message: "inspect contribution failed",
      }),
    );
  });

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
    const resolved = applyPluginExtensions(createSpaGraph(), registry, {
      canonicalPages: {
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

    const resolved = applyPluginExtensions(
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

  it("resolves prototype-shaped owner ids without inherited config", () => {
    const graph = createSpaGraph();
    const home = graph.pages.home;
    const route = graph.routes[0];
    const document = graph.documents["app:default"];
    if (!home || !route || !document) {
      throw new Error("Expected the SPA Page, Route, and Document.");
    }
    graph.pages = {};
    Object.defineProperty(graph.pages, "constructor", {
      configurable: true,
      enumerable: true,
      value: { ...home, id: "constructor" },
      writable: true,
    });
    graph.applications.default.pageIds = ["constructor"];
    graph.applications.default.routeIds = ["constructor"];
    graph.applications.default.documentIds = ["constructor"];
    route.id = "constructor";
    route.target = { kind: "page", pageId: "constructor" };
    graph.documents = {};
    Object.defineProperty(graph.documents, "constructor", {
      configurable: true,
      enumerable: true,
      value: { ...document, id: "constructor" },
      writable: true,
    });

    const plugin = definePlugin({
      name: "prototype-shaped-owner-ids",
      describe(ctx) {
        ctx.pageExtension({
          namespace: "@company/page-theme",
          defaults: ({ pageId }) => ({ pageId, color: "blue" }),
        });
        ctx.routeExtension({
          namespace: "@company/route-theme",
          defaults: ({ routeId }) => ({ routeId, color: "blue" }),
        });
        ctx.documentExtension({
          namespace: "@company/document-theme",
          defaults: ({ documentId }) => ({ documentId, color: "blue" }),
        });
      },
    });
    const resolved = applyPluginExtensions(
      graph,
      collectPluginExtensionRegistry([plugin]),
      {
        canonicalPages: {},
        routeExtensions: {},
        documentExtensions: {},
      },
    );

    expect(
      Object.getOwnPropertyDescriptor(resolved.pages, "constructor")?.value
        .extensions["@company/page-theme"],
    ).toEqual({ pageId: "constructor", color: "blue" });
    expect(resolved.routes[0]?.extensions["@company/route-theme"]).toEqual({
      routeId: "constructor",
      color: "blue",
    });
    expect(
      Object.getOwnPropertyDescriptor(resolved.documents, "constructor")?.value
        .extensions["@company/document-theme"],
    ).toEqual({ documentId: "constructor", color: "blue" });
  });

  it("validates an isolated deeply frozen snapshot", () => {
    type ExtensionValue = {
      nested: { enabled: boolean };
      labels: string[];
    };
    const mergedValue: ExtensionValue = {
      nested: { enabled: true },
      labels: ["stable"],
    };
    const plugin = definePlugin({
      name: "isolated-validation",
      describe(ctx) {
        ctx.pageExtension<ExtensionValue, { enabled: boolean }>({
          namespace: "@company/isolated-validation",
          merge(_defaults, configured) {
            mergedValue.nested.enabled = configured.enabled;
            return mergedValue;
          },
          validate(value) {
            expect(value).not.toBe(mergedValue);
            expect(Object.isFrozen(value)).toBe(true);
            expect(Object.isFrozen(value.nested)).toBe(true);
            expect(Object.isFrozen(value.labels)).toBe(true);
            expect(() => {
              // @ts-expect-error validate receives a deeply read-only value.
              value.nested.enabled = false;
            }).toThrow(TypeError);
            expect(() => {
              // @ts-expect-error validate receives a read-only array.
              value.labels.push("mutated");
            }).toThrow(TypeError);

            // Even a side-channel reference to the merge result cannot change
            // the already-materialized extension value.
            mergedValue.nested.enabled = false;
            Object.defineProperty(mergedValue, "lossy", {
              enumerable: true,
              value: undefined,
            });
            return true;
          },
        });
      },
    });

    const resolved = applyPluginExtensions(
      createSpaGraph(),
      collectPluginExtensionRegistry([plugin]),
      {
        canonicalPages: {
          home: {
            source: "./src/pages/page.config.ts",
            extensions: {
              "@company/isolated-validation": { enabled: true },
            },
          },
        },
      },
    );

    expect(
      resolved.pages.home.extensions["@company/isolated-validation"],
    ).toEqual({
      nested: { enabled: true },
      labels: ["stable"],
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

    const resolved = applyPluginExtensions(
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
    if (!coreRoute) throw new Error("Expected client Route fixture.");
    coreRoute.extensions["@company/menu"] = { name: "Home" };
    coreRoute.facets.layout = "./src/layout.tsx";
    coreRoute.facets.wrappers.push("./src/wrapper.tsx");
    coreGraph.applications.default.layout = "./src/root-layout.tsx";
    const coreOnlyGroupId = "@evjs/provider/page-anchor:tenant-group";
    coreGraph.routes.unshift({
      id: coreOnlyGroupId,
      applicationId: "default",
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
      id: aliasRouteId,
      applicationId: "default",
      pattern: { segments: [{ kind: "static", value: "start" }] },
      target: { kind: "page", pageId: "home" },
      facets: { wrappers: [] },
      extensions: {},
      provenance: providerProvenance(PAGE_ANCHOR_PROVIDER_ID),
    });
    coreGraph.applications.default.routeIds.unshift(coreOnlyGroupId);
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
      routingMode: "spa",
      layout: "./src/root-layout.tsx",
      pageIds: ["home"],
      routeIds: [coreOnlyGroupId, "home", aliasRouteId],
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

    expect(
      view.routes.find((route) => route.id === coreOnlyGroupId),
    ).toMatchObject({
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
    expect(view.routes).toHaveLength(3);
  });

  it("does not leak a physical nested-layout parent into Core route views", () => {
    const coreGraph = createSpaGraph();
    const coreRoute = coreGraph.routes[0];
    if (!coreRoute) throw new Error("Expected client Route fixture.");
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

  it("rejects namespace conflicts and unknown declaration fields", () => {
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
              // @ts-expect-error raw config claims are not supported.
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
              // @ts-expect-error inert invalidation declarations are unsupported.
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
        ctx.pageExtension<unknown>({
          namespace: "@company/date",
          defaults: new Date(),
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
      applyPluginExtensions(
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
        ctx.pageExtension<unknown>({
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
        ctx.pageExtension<unknown>({
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
        ctx.pageExtension<unknown>({
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
      applyPluginExtensions(
        createSpaGraph(),
        collectPluginExtensionRegistry([plugin]),
        {
          canonicalPages: {
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
      applyPluginExtensions(
        createSpaGraph(),
        collectPluginExtensionRegistry([plugin]),
        {
          canonicalPages: {
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
      applyPluginExtensions(
        createSpaGraph(),
        collectPluginExtensionRegistry([plugin]),
      ),
    ).toThrow("must return true, false, a message, or undefined");
  });

  it("keeps canonical Page extensions and semantic routes materialization-neutral", async () => {
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
      throw new Error("Expected plugin observations for both routing modes.");
    }

    expect(mpa.pages).toEqual(spa.pages);
    expect(mpa.routes).toEqual(spa.routes);
    expect(spa.routes).toEqual([
      {
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
    const extensionEvents: string[] = [];
    let observed: unknown;
    const plugin = definePlugin<Record<string, never>>({
      name: "observable-extension",
      describe(ctx) {
        events.push("describe");
        ctx.pageExtension<{ text: string }, { text: string }>({
          namespace: "@company/title",
          defaults() {
            extensionEvents.push("defaults");
            return { text: "Untitled" };
          },
          merge(_defaults, configured) {
            extensionEvents.push("merge");
            return configured;
          },
          validate() {
            extensionEvents.push("validate");
          },
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
    expect(extensionEvents).toEqual(["defaults", "merge", "validate"]);
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
        routingMode: "spa",
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
