import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

  it("drains an old request and forwards queued requests once after replacement readiness", async () => {
    const cwd = await createServerProject();
    const requestLog = path.join(cwd, "requests.jsonl");
    const releaseSlowRequest = path.join(cwd, "release-slow-request");
    const candidateStarted = path.join(cwd, "candidate-started");
    const releaseCandidate = path.join(cwd, "release-candidate");
    const { execa: actualExeca } =
      await vi.importActual<typeof import("execa")>("execa");
    const children: Array<ReturnType<typeof actualExeca>> = [];
    const events: string[] = [];
    const requestAbort = new AbortController();
    let running: Promise<void> | undefined;
    let rebuild: (() => Promise<void>) | undefined;
    let origin = "";

    const serverSource = (revision: number) => `
const fs = require("node:fs");
const revision = ${revision};
if (revision > 0) {
  fs.writeFileSync(${JSON.stringify(candidateStarted)}, "started");
  while (!fs.existsSync(${JSON.stringify(releaseCandidate)})) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}
module.exports = {
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    const body = await request.text();
    fs.appendFileSync(${JSON.stringify(requestLog)}, JSON.stringify({ revision, method: request.method, pathname, body }) + "\\n");
    if (pathname === "/slow") {
      while (!fs.existsSync(${JSON.stringify(releaseSlowRequest)})) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    return new Response(request.method === "HEAD" ? null : JSON.stringify({ revision, body }), {
      headers: { "content-type": "application/json", "x-revision": String(revision) },
    });
  }
};
`;

    mockedExeca.state.spawn = (...args) => {
      const index = children.length;
      const [command, arguments_, options] = args;
      const child = Reflect.apply(actualExeca, undefined, [
        command,
        arguments_,
        { ...(options as object), cleanup: false },
      ]) as ReturnType<typeof actualExeca>;
      children.push(child);
      events.push(`start:${index}`);
      child.once("exit", () => events.push(`exit:${index}`));
      child.stdout?.on("data", (data: Buffer) => {
        if (data.toString().includes(API_READY_MARKER)) {
          events.push(`ready:${index}`);
        }
      });
      return child;
    };

    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "api-gateway-requests",
      capabilities: { build: { server: true, rsc: true, ppr: true } },
      async build() {
        return {};
      },
      async dev({ callbacks, config, plan }) {
        origin = `http://127.0.0.1:${config.server.dev.port}`;
        await emitServerBuild(
          cwd,
          plan,
          (facts) => callbacks.onBuildFacts(facts, { isRebuild: false }),
          serverSource(0),
        );
        await callbacks.onServerBundleReady();
        rebuild = async () => {
          await emitServerBuild(
            cwd,
            plan,
            (facts) => callbacks.onBuildFacts(facts, { isRebuild: true }),
            serverSource(1),
          );
          events.push("replacement-requested");
          await callbacks.onServerBundleReady();
        };
        events.push("initial-api-ready");
        return createTestDevController();
      },
    };

    const readRequests = async (): Promise<
      Array<{
        revision: number;
        method: string;
        pathname: string;
        body: string;
      }>
    > => {
      try {
        const source = await fs.promises.readFile(requestLog, "utf8");
        return source
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    };

    try {
      await fs.promises.symlink(
        fileURLToPath(new URL("../../../node_modules", import.meta.url)),
        path.join(cwd, "node_modules"),
        "dir",
      );
      running = dev(
        { output: { client: "dist/client", server: "dist/server" } },
        { cwd, bundler },
      );
      void running.catch(() => {});
      await waitForEvent(events, "initial-api-ready");
      const slowResponse = fetch(`${origin}/slow`, {
        signal: requestAbort.signal,
      }).then(async (response) => ({
        status: response.status,
        result: await response.json(),
      }));
      void slowResponse.catch(() => {});
      await vi.waitFor(async () => {
        expect(await readRequests()).toEqual([
          { revision: 0, method: "GET", pathname: "/slow", body: "" },
        ]);
      });

      if (!rebuild) throw new Error("Expected a rebuild callback.");
      const rebuilding = rebuild();
      void rebuilding.catch(() => {});
      await waitForEvent(events, "replacement-requested");
      // Allow admission to pause while the old response remains in flight.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(children).toHaveLength(1);
      expect(events).not.toContain("exit:0");

      const postBody = "queued:\n汉字\r\npayload";
      let completed = 0;
      const queued = [
        { method: "GET", pathname: "/queued-get" },
        { method: "HEAD", pathname: "/queued-head" },
        { method: "POST", pathname: "/queued-post", body: postBody },
      ].map(async ({ method, pathname, body }) => {
        const response = await fetch(`${origin}${pathname}`, {
          method,
          body,
          signal: requestAbort.signal,
        });
        const text = await response.text();
        completed++;
        return {
          method,
          status: response.status,
          revision: response.headers.get("x-revision"),
          text,
        };
      });
      for (const request of queued) void request.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(completed).toBe(0);
      expect(await readRequests()).toHaveLength(1);
      expect(events).not.toContain("exit:0");

      events.push("release:old-request");
      await fs.promises.writeFile(releaseSlowRequest, "release");
      await expect(slowResponse).resolves.toEqual({
        status: 200,
        result: { revision: 0, body: "" },
      });
      await waitForEvent(events, "start:1");
      await vi.waitFor(() =>
        expect(fs.existsSync(candidateStarted)).toBe(true),
      );
      expect(events).not.toContain("ready:1");
      expect(completed).toBe(0);
      await fs.promises.writeFile(releaseCandidate, "release");
      await rebuilding;

      const results = await Promise.all(queued);
      expect(
        results.map(({ method, status, revision }) => ({
          method,
          status,
          revision,
        })),
      ).toEqual([
        { method: "GET", status: 200, revision: "1" },
        { method: "HEAD", status: 200, revision: "1" },
        { method: "POST", status: 200, revision: "1" },
      ]);
      expect(results.find(({ method }) => method === "HEAD")?.text).toBe("");
      expect(
        JSON.parse(
          results.find(({ method }) => method === "POST")?.text ?? "null",
        ),
      ).toEqual({
        revision: 1,
        body: postBody,
      });
      expect(
        (await readRequests()).filter(({ method }) => method === "POST"),
      ).toEqual([
        {
          revision: 1,
          method: "POST",
          pathname: "/queued-post",
          body: postBody,
        },
      ]);
      const next = await fetch(`${origin}/after`, {
        signal: requestAbort.signal,
      });
      expect(next.status).toBe(200);
      await expect(next.json()).resolves.toEqual({ revision: 1, body: "" });
      expect(events.indexOf("start:1")).toBeGreaterThan(
        events.indexOf("release:old-request"),
      );
    } finally {
      await fs.promises.writeFile(releaseSlowRequest, "release");
      await fs.promises.writeFile(releaseCandidate, "release");
      requestAbort.abort();
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
