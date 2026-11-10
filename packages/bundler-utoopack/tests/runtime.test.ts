import type { ConfigComplete } from "@utoo/pack";
import { describe, expect, it, vi } from "vitest";
import type { UtoopackModuleReferenceConfig } from "../src/adapter/config/module-references.js";
import {
  runUtoopackBuild,
  runUtoopackDevServer,
} from "../src/adapter/execution/utoopack.js";

const PROJECT_PATH = "/workspace/apps/example";
const config = {} as ConfigComplete;

describe("Utoopack runtime invocation", () => {
  const referenceConfig: UtoopackModuleReferenceConfig = {
    entry: [],
    module: {
      references: [
        {
          resource: "/workspace/greeting.ts",
          references: [
            {
              id: "greeting",
              factory: {
                module: "/workspace/runtime.ts",
                export: "createReference",
              },
              data: null,
            },
          ],
          exports: [{ name: "Greeting", reference: "greeting" }],
        },
      ],
    },
  };

  it("rejects an unsupported runtime before it can build original source", () => {
    const build = vi.fn(async () => {});
    const serve = vi.fn(async () => {});
    expect(() =>
      runUtoopackBuild({ build }, referenceConfig, PROJECT_PATH),
    ).toThrow("moduleReferencesVersion=1");
    expect(() =>
      runUtoopackDevServer({ serve }, referenceConfig, PROJECT_PATH, {
        port: 3000,
      }),
    ).toThrow("moduleReferencesVersion=1");
    expect(build).not.toHaveBeenCalled();
    expect(serve).not.toHaveBeenCalled();
  });

  it("forwards references only to a compatible runtime", async () => {
    const build = vi.fn(async () => {});
    await runUtoopackBuild(
      { build, moduleReferencesVersion: 1 },
      referenceConfig,
      PROJECT_PATH,
    );
    expect(build).toHaveBeenCalledWith(
      { config: referenceConfig },
      PROJECT_PATH,
    );
  });

  it("anchors builds to the project and lets Utoopack discover the workspace root", async () => {
    const build = vi.fn(
      async (..._args: Parameters<typeof import("@utoo/pack")["build"]>) => {},
    );

    await runUtoopackBuild({ build }, config, PROJECT_PATH);

    expect(build).toHaveBeenCalledWith({ config }, PROJECT_PATH);
  });

  it("anchors dev to the project and lets Utoopack discover the workspace root", async () => {
    const serve = vi.fn(
      async (..._args: Parameters<typeof import("@utoo/pack")["serve"]>) => {},
    );
    const serverOptions = {
      port: 3000,
      https: false,
      hostname: "0.0.0.0",
      logServerInfo: false,
    };

    await runUtoopackDevServer({ serve }, config, PROJECT_PATH, serverOptions);

    expect(serve).toHaveBeenCalledWith(
      { config },
      PROJECT_PATH,
      undefined,
      serverOptions,
    );
  });
});
