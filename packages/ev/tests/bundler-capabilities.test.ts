import type { BuildPlan, BuildPlanUpdate } from "@evjs/shared/manifest";
import { describe, expect, it } from "vitest";
import {
  type BundlerCapabilities,
  getBundlerBuildCapabilityGaps,
  getBundlerDevCapabilityGaps,
  hasServerGeneratedRuntimeChange,
  isArtifactOnlyBuildPlanUpdate,
  preflightBundlerBuild,
  preflightBundlerDevUpdate,
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

  it("requires a fresh server compiler only when generated server runtime bytes change", () => {
    const previous = createGeneratedServerPlan("a".repeat(64));
    const nextRuntime = createGeneratedServerPlan("b".repeat(64));
    const nextDeclarationOnly = createGeneratedServerPlan("a".repeat(64), {
      declarationFile: "./src/.ev/types/database.d.ts",
    });

    expect(hasServerGeneratedRuntimeChange(previous, nextRuntime)).toBe(true);
    expect(hasServerGeneratedRuntimeChange(previous, nextDeclarationOnly)).toBe(
      false,
    );

    const runtimeUpdate = createGeneratedPlanUpdate(previous, nextRuntime);
    expect(isArtifactOnlyBuildPlanUpdate(runtimeUpdate)).toBe(false);
    expect(
      getBundlerDevCapabilityGaps(
        { capabilities: noCapabilities },
        runtimeUpdate,
      ).map((gap) => gap.capability),
    ).toContain("dev.server");

    const declarationUpdate = createGeneratedPlanUpdate(
      previous,
      nextDeclarationOnly,
    );
    expect(isArtifactOnlyBuildPlanUpdate(declarationUpdate)).toBe(true);
    expect(
      getBundlerDevCapabilityGaps(
        { capabilities: noCapabilities },
        declarationUpdate,
      ).map((gap) => gap.capability),
    ).not.toContain("dev.server");
  });

  it("fails closed when generated server runtime digest metadata is invalid", () => {
    expect(
      hasServerGeneratedRuntimeChange(
        createGeneratedServerPlan("a".repeat(64)),
        createGeneratedServerPlan("invalid"),
      ),
    ).toBe(true);
  });

  it("requires a fresh server compiler when a generated runtime path changes", () => {
    const previous = createGeneratedServerPlan("a".repeat(64));
    const next = createGeneratedServerPlan("a".repeat(64), {
      file: "./.ev/plugins/schema/database-collision.ts",
      specifier: "evjs:generated/schema/database-collision",
    });

    expect(hasServerGeneratedRuntimeChange(previous, next)).toBe(true);
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

function createGeneratedServerPlan(
  sourceHash: string,
  extra: {
    declarationFile?: string;
    file?: string;
    specifier?: string;
  } = {},
): BuildPlan {
  return {
    distDir: "dist",
    output: { clientDir: "client", serverDir: "server" },
    generated: {
      modules: [
        {
          key: "schema:database",
          scope: { kind: "server" },
          sourceHash,
          file: "./.ev/plugins/schema/database.ts",
          specifier: "evjs:generated/schema/database",
          extension: ".ts",
          ...extra,
        },
      ],
    },
  } as unknown as BuildPlan;
}

function createGeneratedPlanUpdate(
  previous: BuildPlan,
  next: BuildPlan,
): BuildPlanUpdate {
  return {
    reason: "plugin",
    previous,
    next,
    entries: { added: [], removed: [], changed: [] },
    html: { added: [], removed: [], changed: [] },
    generatedChanged: true,
    resolveChanged: false,
    runtimeChanged: false,
    deliveryChanged: false,
    serverCompilationChanged: false,
    serverDocumentsChanged: false,
    devRoutingChanged: false,
  };
}
