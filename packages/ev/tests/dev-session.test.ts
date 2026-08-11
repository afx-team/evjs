import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  BundlerAdapter,
  BundlerDevContext,
  BundlerDevController,
} from "../src/_internal/build/bundler.js";
import { withActiveBundler } from "../src/_internal/build/bundler-config.js";
import {
  formatDevPageUrls,
  startDevSession,
} from "../src/_internal/build/dev-session.js";
import { createCoreGraph } from "../src/_internal/build/graph/index.js";
import { createBuildPlan } from "../src/_internal/build/plan/index.js";
import { resolveConfig } from "../src/config/index.js";
import type { Plugin } from "../src/plugin/index.js";

const capabilities = {
  build: { server: true, rsc: true, ppr: true },
} as const;

interface ControlledBundler {
  readonly adapter: BundlerAdapter<Record<string, never>>;
  readonly contexts: BundlerDevContext<Record<string, never>>[];
  readonly events: string[];
}

const temporaryProjects = new Set<string>();
let buildId = 0;

function createControlledBundler(
  origins: readonly string[] = [],
): ControlledBundler {
  const contexts: BundlerDevContext<Record<string, never>>[] = [];
  const events: string[] = [];
  const adapter: BundlerAdapter<Record<string, never>> = {
    name: "controlled-session",
    capabilities,
    async build() {
      return {};
    },
    async dev(context): Promise<BundlerDevController> {
      const index = contexts.length + 1;
      contexts.push(context);
      events.push(`start:${index}`);
      let closed = false;
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      return {
        origin:
          origins[index - 1] ?? `http://localhost:${context.config.dev.port}`,
        done,
        async close() {
          if (closed) return;
          closed = true;
          events.push(`close:${index}`);
          resolveDone();
        },
      };
    },
  };
  return { adapter, contexts, events };
}

async function createProject(): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-session-"));
  temporaryProjects.add(cwd);
  await fs.writeFile(
    path.join(cwd, "package.json"),
    `${JSON.stringify({ name: "dev-session-test", private: true })}\n`,
  );
  return cwd;
}

async function createSessionInput(
  cwd: string,
  bundler: BundlerAdapter<Record<string, never>>,
  plugins: Plugin<Record<string, never>>[] = [],
) {
  const config = withActiveBundler(
    resolveConfig<Record<string, never>>({
      conventions: false,
      plugins,
    }),
    bundler,
  );
  const analysis = await createCoreGraph(config, cwd);
  const plan = createBuildPlan(config, analysis.graph, {
    buildId: `dev-session-${++buildId}`,
    mode: "development",
  });
  return { config, graph: analysis.graph, plan };
}

async function start(
  cwd: string,
  controlled: ControlledBundler,
  plugins: Plugin<Record<string, never>>[] = [],
) {
  const input = await createSessionInput(cwd, controlled.adapter, plugins);
  return startDevSession({
    ...input,
    bundler: controlled.adapter,
    cwd,
    registerExitCleanup() {
      return () => {};
    },
    registerWatchFile() {},
  });
}

afterEach(async () => {
  await Promise.all(
    [...temporaryProjects].map((cwd) =>
      fs.rm(cwd, { recursive: true, force: true }),
    ),
  );
  temporaryProjects.clear();
});

describe("immutable dev session", () => {
  it("formats server-rendered MPA Pages with their Document URLs", async () => {
    const cwd = await createProject();
    const controlled = createControlledBundler();
    const input = await createSessionInput(cwd, controlled.adapter);
    input.config.routing = {
      mode: "mpa",
      html: "./index.html",
      mount: "#app",
      routes: [
        {
          id: "report",
          path: "/report",
          module: "./src/pages/report/page.tsx",
        },
      ],
    };
    input.plan.server.documents = [
      {
        pageId: "report",
        documentId: "report",
        applicationId: "default",
        template: "./index.html",
        fileName: "report.html",
        mount: "#app",
      },
    ];

    expect(
      formatDevPageUrls("http://localhost:3000", input.config, input.plan),
    ).toEqual([{ pageId: "report", url: "http://localhost:3000/report.html" }]);
  });

  it("discards old build facts that arrive after a replacement session starts", async () => {
    const cwd = await createProject();
    const controlled = createControlledBundler();
    const oldSession = await start(cwd, controlled);
    await oldSession.close();
    const newSession = await start(cwd, controlled);

    await expect(
      controlled.contexts[0]?.callbacks.onBuildFacts({}, { isRebuild: true }),
    ).resolves.toBe("discarded");
    await expect(
      controlled.contexts[1]?.callbacks.onBuildFacts({}, { isRebuild: false }),
    ).resolves.toBe("published");
    expect(controlled.contexts[1]?.signal.aborted).toBe(false);
    expect(controlled.events).toEqual(["start:1", "close:1", "start:2"]);

    await newSession.close();
  });

  it("runs plugin setup and dispose exactly once for each session", async () => {
    const cwd = await createProject();
    const controlled = createControlledBundler();
    const events: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      id: "session-lifecycle",
      setup() {
        events.push("setup");
        return {
          dispose() {
            events.push("dispose");
          },
        };
      },
    };

    const first = await start(cwd, controlled, [plugin]);
    await first.close();
    const second = await start(cwd, controlled, [plugin]);
    await second.close();

    expect(events).toEqual(["setup", "dispose", "setup", "dispose"]);
  });

  it("reports the actual client origin once for each immutable session", async () => {
    const cwd = await createProject();
    const controlled = createControlledBundler([
      "dev-server-one",
      "https://localhost:4312",
    ]);
    const events: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      id: "dev-server-ready",
      setup() {
        events.push("setup");
        return {
          devServerReady(ctx) {
            events.push(`ready:${ctx.origin}`);
          },
          dispose() {
            events.push("dispose");
          },
        };
      },
    };

    const first = await start(cwd, controlled, [plugin]);
    await first.activate();
    await expect(
      controlled.contexts[0]?.callbacks.onBuildFacts({}, { isRebuild: false }),
    ).resolves.toBe("published");
    await expect(
      controlled.contexts[0]?.callbacks.onBuildFacts({}, { isRebuild: true }),
    ).resolves.toBe("published");
    await first.close();

    const second = await start(cwd, controlled, [plugin]);
    await second.activate();
    await second.close();

    expect(events).toEqual([
      "setup",
      "ready:dev-server-one",
      "dispose",
      "setup",
      "ready:https://localhost:4312",
      "dispose",
    ]);
  });

  it("does not order devServerReady before the initial output hooks", async () => {
    const cwd = await createProject();
    const base = createControlledBundler(["http://localhost:4314"]);
    const events: string[] = [];
    const controlled: ControlledBundler = {
      ...base,
      adapter: {
        ...base.adapter,
        async dev(context) {
          await context.callbacks.onBuildFacts({}, { isRebuild: false });
          return base.adapter.dev(context);
        },
      },
    };
    const plugin: Plugin<Record<string, never>> = {
      id: "ready-build-order",
      setup() {
        return {
          beforeBuild() {
            events.push("beforeBuild");
          },
          afterBuild() {
            events.push("afterBuild");
          },
          devServerReady() {
            events.push("devServerReady");
          },
        };
      },
    };

    const session = await start(cwd, controlled, [plugin]);
    await session.activate();
    await session.close();

    expect(events).toEqual(["beforeBuild", "afterBuild", "devServerReady"]);
  });

  it("closes the controller and disposes plugins when devServerReady fails", async () => {
    const cwd = await createProject();
    const controlled = createControlledBundler(["http://localhost:4313"]);
    const events: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      id: "failing-dev-server-ready",
      setup() {
        return {
          devServerReady() {
            events.push("ready");
            throw new Error("ready failed");
          },
          dispose() {
            events.push("dispose");
          },
        };
      },
    };

    const session = await start(cwd, controlled, [plugin]);
    await expect(session.activate()).rejects.toThrow("ready failed");
    await session.close();

    expect(controlled.events).toEqual(["start:1", "close:1"]);
    expect(events).toEqual(["ready", "dispose"]);
  });
});
