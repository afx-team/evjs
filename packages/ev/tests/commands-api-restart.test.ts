import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BuildPlan } from "@evjs/shared/manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BundlerAdapter,
  BundlerBuildFacts,
} from "../src/_internal/build/bundler.js";
import { dev } from "../src/_internal/build/commands.js";
import type { Config } from "../src/config/index.js";

const API_READY_MARKER = "__EVJS_API_READY__";
const updateTimeoutMs = 10_000;

const mockedExeca = vi.hoisted(() => {
  const state: {
    spawn?: (...args: unknown[]) => unknown;
  } = {};
  return {
    execa: vi.fn((...args: unknown[]) => {
      if (!state.spawn) throw new Error("Missing fake API process factory.");
      return state.spawn(...args);
    }),
    state,
  };
});

vi.mock("execa", () => ({ execa: mockedExeca.execa }));

interface FakeApiProcess extends Promise<void> {
  readonly id: string;
  readonly stderr: EventEmitter;
  readonly stdout: EventEmitter;
  emit: EventEmitter["emit"];
  kill(signal?: NodeJS.Signals): boolean;
  off: EventEmitter["off"];
  on: EventEmitter["on"];
  once: EventEmitter["once"];
  reportAddressInUse(): void;
  reportReady(): void;
}

function createFakeApiProcess(id: string, events: string[]): FakeApiProcess {
  const emitter = new EventEmitter();
  const stderr = new EventEmitter();
  const stdout = new EventEmitter();
  let rejectProcess!: (reason: unknown) => void;
  let settled = false;
  const completion = new Promise<void>((_resolve, reject) => {
    rejectProcess = reject;
  });

  return Object.assign(completion, {
    id,
    stderr,
    stdout,
    emit: emitter.emit.bind(emitter),
    off: emitter.off.bind(emitter),
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    reportReady() {
      events.push(`ready:${id}`);
      stdout.emit("data", Buffer.from(`${API_READY_MARKER}\n`));
    },
    reportAddressInUse() {
      events.push(`readiness-failed:${id}`);
      stderr.emit("data", Buffer.from("EADDRINUSE"));
    },
    kill(signal: NodeJS.Signals = "SIGTERM") {
      if (settled) return false;
      settled = true;
      events.push(`kill:${id}:${signal}`);
      emitter.emit("exit", null, signal);
      rejectProcess(new Error(`Process ${id} stopped with ${signal}.`));
      return true;
    },
  });
}

afterEach(() => {
  mockedExeca.execa.mockClear();
  mockedExeca.state.spawn = undefined;
  vi.restoreAllMocks();
});

async function createServerProject(): Promise<string> {
  const cwd = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "evjs-api-restart-"),
  );
  await writeFile(path.join(cwd, "index.html"), '<div id="app"></div>');
  await writeFile(
    path.join(cwd, "src/apis/health/api.ts"),
    "export const GET = () => Response.json({ ok: true });",
  );
  return cwd;
}

async function writeFile(file: string, source: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, source, "utf-8");
}

function createServerFacts(plan: BuildPlan): BundlerBuildFacts {
  const serverEntries = plan.entries.filter(
    (entry) => entry.environment === "server",
  );
  const runtimeEntry = serverEntries.find(
    (entry) => entry.kind === "server-runtime",
  );
  if (!runtimeEntry) throw new Error("Expected a server runtime entry.");
  return {
    serverEntryAssets: Object.fromEntries(
      serverEntries.map((entry) => [
        entry.name,
        { js: [`${entry.name}.js`], css: [] },
      ]),
    ),
    serverEntry: `${runtimeEntry.name}.js`,
    serverAssets: { js: [`${runtimeEntry.name}.js`], css: [] },
  };
}

async function emitServerBuild(
  cwd: string,
  plan: BuildPlan,
  onBuildFacts: (facts: BundlerBuildFacts) => void | Promise<void>,
): Promise<void> {
  const facts = createServerFacts(plan);
  if (!facts.serverEntry) throw new Error("Expected a server entry asset.");
  await writeFile(
    path.resolve(cwd, plan.output.serverDir, facts.serverEntry),
    "export default { fetch() { return new Response('ok'); } };",
  );
  await onBuildFacts(facts);
}

async function waitForEvent(events: string[], expected: string): Promise<void> {
  const startedAt = Date.now();
  while (!events.includes(expected)) {
    if (Date.now() - startedAt > updateTimeoutMs) {
      throw new Error(`Timed out waiting for ${expected}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("dev API restart rollback", () => {
  it("terminates a child that fails before reporting ready", async () => {
    const cwd = await createServerProject();
    const events: string[] = [];
    const child = createFakeApiProcess("failed", events);
    mockedExeca.state.spawn = () => {
      events.push("start:failed");
      queueMicrotask(() => child.reportAddressInUse());
      return child;
    };
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "api-readiness-failure",
      capabilities: {
        build: { server: true, rsc: true, ppr: true },
        dev: {
          html: true,
          entries: true,
          routes: true,
          server: true,
          resolution: true,
        },
      },
      async build() {
        return {};
      },
      async dev({ callbacks, plan }) {
        await emitServerBuild(cwd, plan, (facts) =>
          callbacks.onBuildFacts(facts),
        );
        await callbacks.onServerBundleReady();
      },
    };

    await expect(
      dev(
        { output: { client: "dist/client", server: "dist/server" } },
        { cwd, bundler },
      ),
    ).rejects.toThrow("API server port is already in use");

    expect(events).toEqual([
      "start:failed",
      "readiness-failed:failed",
      "kill:failed:SIGTERM",
    ]);
  });

  it("restores the previous API after a plan-update restart fails", async () => {
    const cwd = await createServerProject();
    const configFile = path.join(cwd, "ev.config.ts");
    await writeFile(configFile, "export default {};");
    const events: string[] = [];
    const processKinds = ["previous", "candidate", "restored"] as const;
    let processIndex = 0;
    mockedExeca.state.spawn = () => {
      const id = processKinds[processIndex++];
      if (!id) throw new Error("Unexpected additional API process.");
      const child = createFakeApiProcess(id, events);
      events.push(`start:${id}`);
      queueMicrotask(() => {
        if (id === "candidate") child.reportAddressInUse();
        else child.reportReady();
      });
      return child;
    };
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    let currentConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "api-update-rollback",
      capabilities: {
        build: { server: true, rsc: true, ppr: true },
        dev: {
          html: true,
          entries: true,
          routes: true,
          server: true,
          resolution: true,
        },
      },
      async build() {
        return {};
      },
      async dev({ callbacks, plan }) {
        await emitServerBuild(cwd, plan, (facts) =>
          callbacks.onBuildFacts(facts),
        );
        await callbacks.onServerBundleReady();
        events.push("initial-api-ready");
        return {
          async updatePlan() {
            await emitServerBuild(cwd, plan, (facts) =>
              callbacks.onBuildFacts(facts, { isRebuild: true }),
            );
            await callbacks.onServerBundleReady();
          },
        };
      },
    };

    const running = dev(currentConfig, {
      cwd,
      bundler,
      loadConfig() {
        return currentConfig;
      },
    });
    await waitForEvent(events, "initial-api-ready");
    await new Promise((resolve) => setTimeout(resolve, 100));
    currentConfig = {
      ...currentConfig,
      dev: {
        proxy: [{ context: ["/backend"], target: "https://example.com" }],
      },
    };
    await writeFile(configFile, "export default { dev: {} }; // changed");
    await waitForEvent(events, "ready:restored");
    process.emit("SIGINT");

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Dev API rollback timed out.")),
          updateTimeoutMs,
        ),
      ),
    ]);

    expect(events.filter((event) => event.startsWith("start:"))).toEqual([
      "start:previous",
      "start:candidate",
      "start:restored",
    ]);
    expect(events).toContain("kill:candidate:SIGTERM");
    expect(events.indexOf("kill:candidate:SIGTERM")).toBeLessThan(
      events.indexOf("start:restored"),
    );
    expect(events).toContain("kill:restored:SIGTERM");
  });
});
