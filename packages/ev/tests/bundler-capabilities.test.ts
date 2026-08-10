import type { BuildPlan } from "@evjs/shared/manifest";
import { describe, expect, it } from "vitest";
import {
  assertBundlerBuildFactsContract,
  type BundlerCapabilities,
  getBundlerBuildCapabilityGaps,
  preflightBundlerBuild,
  resolveBundlerClientEntryAssets,
  resolveBundlerServerEntryAssets,
} from "../src/_internal/build/bundler.js";

const noCapabilities: BundlerCapabilities = {
  build: { server: false, rsc: false, ppr: false },
};

const allCapabilities: BundlerCapabilities = {
  build: { server: true, rsc: true, ppr: true },
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
});
