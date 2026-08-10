import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BuildPlan } from "@evjs/shared/manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BundlerAdapter,
  BundlerBuildFacts,
  BundlerBuildFactsDisposition,
  BundlerDevController,
} from "../src/_internal/build/bundler.js";
import { dev } from "../src/_internal/build/commands.js";

const API_READY_MARKER = "__EVJS_API_READY__";
const updateTimeoutMs = 10_000;

function createTestDevController(): BundlerDevController {
  let closed = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  return {
    origin: "http://localhost:4123",
    done,
    async close() {
      if (closed) return;
      closed = true;
      resolveDone();
    },
  };
}

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
  };
}

async function emitServerBuild(
  cwd: string,
  plan: BuildPlan,
  onBuildFacts: (
    facts: BundlerBuildFacts,
  ) => BundlerBuildFactsDisposition | Promise<BundlerBuildFactsDisposition>,
): Promise<void> {
  const facts = createServerFacts(plan);
  const runtimeEntry = plan.entries.find(
    (entry) => entry.kind === "server-runtime",
  );
  if (!runtimeEntry) throw new Error("Expected a server runtime entry.");
  const serverEntry = facts.serverEntryAssets?.[runtimeEntry.name]?.js[0];
  if (!serverEntry) throw new Error("Expected a server entry asset.");
  await writeFile(
    path.resolve(cwd, plan.output.serverDir, serverEntry),
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

describe("immutable dev API process coverage", () => {
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
      capabilities: { build: { server: true, rsc: true, ppr: true } },
      async build() {
        return {};
      },
      async dev({ callbacks, plan }) {
        await emitServerBuild(cwd, plan, (facts) =>
          callbacks.onBuildFacts(facts, { isRebuild: false }),
        );
        await callbacks.onServerBundleReady();
        return createTestDevController();
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

  it("replaces the API process after a rebuild in the same session", async () => {
    const cwd = await createServerProject();
    const events: string[] = [];
    const processKinds = ["initial", "rebuilt"] as const;
    let processIndex = 0;
    mockedExeca.state.spawn = () => {
      const id = processKinds[processIndex++];
      if (!id) throw new Error("Unexpected additional API process.");
      const child = createFakeApiProcess(id, events);
      events.push(`start:${id}`);
      queueMicrotask(() => child.reportReady());
      return child;
    };

    let rebuild: (() => Promise<void>) | undefined;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "api-session-rebuild",
      capabilities: { build: { server: true, rsc: true, ppr: true } },
      async build() {
        return {};
      },
      async dev({ callbacks, plan }) {
        await emitServerBuild(cwd, plan, (facts) =>
          callbacks.onBuildFacts(facts, { isRebuild: false }),
        );
        await callbacks.onServerBundleReady();
        events.push("initial-api-ready");
        rebuild = async () => {
          await emitServerBuild(cwd, plan, (facts) =>
            callbacks.onBuildFacts(facts, { isRebuild: true }),
          );
          await callbacks.onServerBundleReady();
          events.push("rebuilt-api-ready");
        };
        return createTestDevController();
      },
    };

    const running = dev(
      { output: { client: "dist/client", server: "dist/server" } },
      { cwd, bundler },
    );
    await waitForEvent(events, "initial-api-ready");
    if (!rebuild) throw new Error("Expected a rebuild callback.");
    await rebuild();
    process.emit("SIGINT");

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Dev API shutdown timed out.")),
          updateTimeoutMs,
        ),
      ),
    ]);

    expect(events.filter((event) => event.startsWith("start:"))).toEqual([
      "start:initial",
      "start:rebuilt",
    ]);
    expect(events.indexOf("kill:initial:SIGTERM")).toBeLessThan(
      events.indexOf("start:rebuilt"),
    );
    expect(events).toContain("ready:rebuilt");
    expect(events).toContain("rebuilt-api-ready");
    expect(events).toContain("kill:rebuilt:SIGTERM");
  });
});
