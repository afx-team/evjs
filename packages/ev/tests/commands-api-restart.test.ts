import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { BuildPlan } from "@evjs/shared/manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BundlerAdapter,
  BundlerBuildFacts,
  BundlerBuildFactsDisposition,
  BundlerDevController,
} from "../src/_internal/build/bundler/contracts.js";
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
  source = "export default { fetch() { return new Response('ok'); } };",
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
    source,
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

  it("drains requests and forwards queued GET, HEAD and POST once after readiness", async () => {
    const cwd = await createServerProject();
    const launchCwd = process.cwd();
    expect(cwd).not.toBe(launchCwd);
    const slowGate = path.join(cwd, "release-slow");
    const readyGate = path.join(cwd, "release-ready");
    const { execa } = await vi.importActual<typeof import("execa")>("execa");
    const children: Array<ReturnType<typeof execa>> = [];
    const events: string[] = [];
    const abort = new AbortController();
    let running: Promise<void> | undefined;
    let rebuild = async () => {};
    let origin = "";
    const source = (revision: number) => `
const fs = require("node:fs");
console.log("loading:${revision}");
console.log("cwd:" + process.cwd());
if (${revision}) while (!fs.existsSync(${JSON.stringify(readyGate)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
module.exports.fetch = async request => {
  const body = await request.text();
  if (request.method === "POST") console.log("post:" + JSON.stringify(body));
  if (new URL(request.url).pathname === "/slow") {
    console.log("slow-started");
    while (!fs.existsSync(${JSON.stringify(slowGate)})) await new Promise(resolve => setTimeout(resolve, 10));
  }
  return new Response(request.method === "HEAD" ? null : "${revision}:" + body, { headers: { "x-revision": "${revision}" } });
};`;
    mockedExeca.state.spawn = (command, arguments_, options) => {
      const child = Reflect.apply(execa, undefined, [
        command,
        arguments_,
        { ...(options as object), cleanup: false },
      ]) as ReturnType<typeof execa>;
      children.push(child);
      if (child.stdout)
        createInterface({ input: child.stdout }).on("line", (line) =>
          events.push(line),
        );
      return child;
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "api-gateway-requests",
      capabilities: { build: { server: true, rsc: true, ppr: true } },
      build: async () => ({}),
      async dev({ callbacks, config, plan }) {
        origin = `http://127.0.0.1:${config.server.dev.port}`;
        const build = async (revision: number) => {
          await emitServerBuild(
            cwd,
            plan,
            (facts) =>
              callbacks.onBuildFacts(facts, { isRebuild: revision > 0 }),
            source(revision),
          );
          events.push(`rebuild:${revision}`);
          await callbacks.onServerBundleReady();
        };
        await build(0);
        rebuild = () => build(1);
        return createTestDevController();
      },
    };
    const send = async (method = "GET", body?: string) => {
      const response = await fetch(origin, {
        method,
        body,
        signal: abort.signal,
      });
      expect(response.status).toBe(200);
      return `${response.headers.get("x-revision")}:${await response.text()}`;
    };
    try {
      await fs.promises.symlink(
        fileURLToPath(new URL("../../../node_modules", import.meta.url)),
        path.join(cwd, "node_modules"),
        "dir",
      );
      running = dev({}, { cwd, bundler });
      void running.catch(() => {});
      await waitForEvent(events, API_READY_MARKER);
      expect(events).toContain(`cwd:${launchCwd}`);
      const slow = fetch(`${origin}/slow`, { signal: abort.signal });
      void slow.catch(() => {});
      await waitForEvent(events, "slow-started");
      const rebuilding = rebuild();
      void rebuilding.catch(() => {});
      await waitForEvent(events, "rebuild:1");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(children).toHaveLength(1);
      let completed = 0;
      const body = "queued:\n汉字\r\npayload";
      const queued = [send(), send("HEAD"), send("POST", body)];
      for (const request of queued)
        void request.then(() => completed++).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(completed).toBe(0);
      expect(children).toHaveLength(1);
      await fs.promises.writeFile(slowGate, "release");
      await expect((await slow).text()).resolves.toBe("0:");
      await waitForEvent(events, "loading:1");
      expect(completed).toBe(0);
      await fs.promises.writeFile(readyGate, "release");
      await rebuilding;
      expect(events.filter((event) => event.startsWith("cwd:"))).toEqual([
        `cwd:${launchCwd}`,
        `cwd:${launchCwd}`,
      ]);
      await expect(Promise.all(queued)).resolves.toEqual([
        "1:1:",
        "1:",
        `1:1:${body}`,
      ]);
      await vi.waitFor(() =>
        expect(events.filter((event) => event.startsWith("post:"))).toEqual([
          `post:${JSON.stringify(body)}`,
        ]),
      );
    } finally {
      await fs.promises.writeFile(slowGate, "release");
      await fs.promises.writeFile(readyGate, "release");
      abort.abort();
      try {
        if (running) {
          process.emit("SIGINT");
          await running;
        }
      } finally {
        await Promise.all(
          children.map(async (child) => {
            child.kill("SIGKILL");
            await child.catch(() => {});
          }),
        );
        await fs.promises.rm(cwd, { recursive: true, force: true });
      }
    }
  }, 25_000);
});
