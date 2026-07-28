import type { ConfigComplete } from "@utoo/pack";
import { describe, expect, it, vi } from "vitest";
import {
  runUtoopackBuild,
  runUtoopackDevServer,
} from "../src/adapter/runtime.js";

const PROJECT_PATH = "/workspace/apps/example";
const config = {} as ConfigComplete;

describe("Utoopack runtime invocation", () => {
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
