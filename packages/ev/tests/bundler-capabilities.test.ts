import type { BuildPlan, BuildPlanUpdate } from "@evjs/shared/manifest";
import { describe, expect, it } from "vitest";
import {
  assertBundlerBuildFactsContract,
  type BundlerCapabilities,
  getBundlerBuildCapabilityGaps,
  getBundlerDevCapabilityGaps,
  preflightBundlerBuild,
  preflightBundlerDevUpdate,
  resolveBundlerClientEntryAssets,
  resolveBundlerServerEntryAssets,
} from "../src/_internal/build/bundler.js";

const noCapabilities: BundlerCapabilities = {
  build: { server: false, rsc: false, ppr: false },
  dev: {
    html: false,
    entries: false,
    routes: false,
    server: false,
    resolution: false,
  },
};

const allCapabilities: BundlerCapabilities = {
  build: { server: true, rsc: true, ppr: true },
  dev: {
    html: true,
    entries: true,
    routes: true,
    server: true,
    resolution: true,
  },
};

describe("bundler capability preflight", () => {
  it.each([
    "serverEntry",
    "serverAssets",
    "serverModules",
  ] as const)("rejects removed %s build facts", (field) => {
    const facts: Record<string, unknown> = { [field]: {} };
    expect(() => assertBundlerBuildFactsContract(facts)).toThrow(
      `[evjs] Bundler build facts.${field} is no longer supported. Return every server entry through serverEntryAssets keyed by its exact BuildPlan name.`,
    );
  });

  it("requires exact server BuildPlan entry names", () => {
    const plan = {
      entries: [
        {
          name: "server",
          environment: "server",
          kind: "server-runtime",
        },
      ],
    } as unknown as BuildPlan;

    expect(() =>
      resolveBundlerServerEntryAssets(
        plan,
        { main: { js: ["server.js"], css: [] } },
        "Test stats",
      ),
    ).toThrow(
      '[evjs] Test stats do not identify server BuildPlan entrypoint "server" exactly; found entrypoints "main".',
    );
  });

  it.each([
    "__proto__",
    "constructor",
    "toString",
  ])("preserves the own prototype-shaped entry name %s in bundler facts", (entryName) => {
    const assets = { js: [`${entryName}.js`], css: [] };
    const available = Object.fromEntries([[entryName, assets]]);

    for (const environment of ["client", "server"] as const) {
      const plan = {
        entries: [{ name: entryName, environment }],
      } as unknown as BuildPlan;
      const resolved =
        environment === "client"
          ? resolveBundlerClientEntryAssets(plan, available, "Test stats")
          : resolveBundlerServerEntryAssets(plan, available, "Test stats");

      expect(Object.getPrototypeOf(resolved)).toBe(Object.prototype);
      expect(Object.hasOwn(resolved, entryName)).toBe(true);
      expect(Reflect.get(resolved, entryName)).toEqual(assets);
    }
  });

  it.each([
    "__proto__",
    "constructor",
    "toString",
  ])("does not resolve inherited entry assets for %s", (entryName) => {
    const inherited = Object.create(
      Object.fromEntries([[entryName, { js: [`${entryName}.js`], css: [] }]]),
    ) as Record<string, { js: string[]; css: string[] }>;

    for (const environment of ["client", "server"] as const) {
      const plan = {
        entries: [{ name: entryName, environment }],
      } as unknown as BuildPlan;
      expect(() =>
        environment === "client"
          ? resolveBundlerClientEntryAssets(plan, inherited, "Test stats")
          : resolveBundlerServerEntryAssets(plan, inherited, "Test stats"),
      ).toThrow(`BuildPlan entrypoint "${entryName}"`);
    }
  });

  it("derives server, RSC, and PPR build requirements from plan entries", () => {
    const plan = {
      entries: [
        {
          name: "orders-server",
          kind: "page-server",
          owner: { appId: "default", pageId: "orders" },
        },
        {
          name: "server",
          kind: "server-runtime",
          owner: { appId: "default" },
        },
        {
          name: "insights-rsc",
          kind: "rsc-page",
          owner: { appId: "default", pageId: "insights" },
        },
        {
          name: "campaign-shell",
          kind: "ppr-shell",
          owner: { appId: "default", pageId: "campaign" },
        },
      ],
    } as unknown as BuildPlan;

    expect(
      getBundlerBuildCapabilityGaps({ capabilities: noCapabilities }, plan).map(
        (gap) => gap.capability,
      ),
    ).toEqual(["build.server", "build.rsc", "build.ppr"]);
    expect(() =>
      preflightBundlerBuild(
        { name: "limited", capabilities: noCapabilities },
        plan,
      ),
    ).toThrow(
      'Bundler "limited" does not support the capabilities required by this framework plan',
    );
    expect(() =>
      preflightBundlerBuild(
        { name: "complete", capabilities: allCapabilities },
        plan,
      ),
    ).not.toThrow();
  });

  it("does not require server-rendered Page support for the server runtime alone", () => {
    const plan = {
      entries: [
        {
          name: "server",
          kind: "server-runtime",
          owner: { appId: "default" },
        },
      ],
    } as unknown as BuildPlan;

    expect(
      getBundlerBuildCapabilityGaps({ capabilities: noCapabilities }, plan),
    ).toEqual([]);
  });

  it("derives every dynamic dev requirement from a plan update", () => {
    const previous = {
      output: { clientDir: "client", serverDir: "server" },
      dev: { pages: [] },
      server: { routes: [] },
      rsc: undefined,
    } as unknown as BuildPlan;
    const next = {
      output: { clientDir: "next-client", serverDir: "next-server" },
      dev: { pages: [{ path: "/" }] },
      server: { routes: [{ path: "/api" }] },
      rsc: { clientEntry: "rsc" },
    } as unknown as BuildPlan;
    const update = {
      previous,
      next,
      entries: {
        added: [
          {
            name: "orders-server",
            environment: "server",
            kind: "page-server",
          },
        ],
        removed: [],
        changed: [],
      },
      html: { added: [], removed: [], changed: ["index"] },
      generatedChanged: true,
      resolveChanged: true,
      runtimeChanged: true,
      deliveryChanged: false,
      serverCompilationChanged: true,
      serverDocumentsChanged: true,
      devRoutingChanged: true,
    } as unknown as BuildPlanUpdate;

    expect(
      getBundlerDevCapabilityGaps({ capabilities: noCapabilities }, update).map(
        (gap) => gap.capability,
      ),
    ).toEqual([
      "dev.html",
      "dev.entries",
      "dev.routes",
      "dev.server",
      "dev.resolution",
    ]);
    expect(() =>
      preflightBundlerDevUpdate(
        { name: "limited", capabilities: noCapabilities },
        update,
      ),
    ).toThrow("dev.html");
    expect(() =>
      preflightBundlerDevUpdate(
        { name: "complete", capabilities: allCapabilities },
        update,
      ),
    ).not.toThrow();
  });

  it("treats server Document changes as artifact delivery, not compilation", () => {
    const plan = {
      distDir: "dist",
      output: { clientDir: "client", serverDir: "server" },
    } as unknown as BuildPlan;
    const update = {
      reason: "route-declaration",
      previous: plan,
      next: plan,
      entries: { added: [], removed: [], changed: [] },
      html: { added: [], removed: [], changed: [] },
      generatedChanged: false,
      resolveChanged: false,
      runtimeChanged: false,
      deliveryChanged: false,
      serverCompilationChanged: false,
      serverDocumentsChanged: true,
      devRoutingChanged: false,
    } as BuildPlanUpdate;

    expect(
      getBundlerDevCapabilityGaps({ capabilities: noCapabilities }, update).map(
        (gap) => gap.capability,
      ),
    ).toEqual(["dev.html"]);
  });

  it("keeps runtime and development routing changes fail-closed", () => {
    const plan = {
      distDir: "dist",
      output: { clientDir: "client", serverDir: "server" },
    } as unknown as BuildPlan;
    const update = {
      reason: "route-declaration",
      previous: plan,
      next: plan,
      entries: { added: [], removed: [], changed: [] },
      html: { added: [], removed: [], changed: [] },
      generatedChanged: false,
      resolveChanged: false,
      runtimeChanged: true,
      deliveryChanged: false,
      serverCompilationChanged: false,
      serverDocumentsChanged: false,
      devRoutingChanged: true,
    } as BuildPlanUpdate;

    expect(
      getBundlerDevCapabilityGaps({ capabilities: noCapabilities }, update).map(
        (gap) => gap.capability,
      ),
    ).toEqual(["dev.routes", "dev.server"]);
  });
});
