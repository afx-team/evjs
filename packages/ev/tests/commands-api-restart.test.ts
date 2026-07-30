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
import type { Plugin } from "../src/plugin/index.js";

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
      async dev({ callbacks, plan, planGeneration }) {
        await emitServerBuild(cwd, plan, (facts) =>
          callbacks.onBuildFacts(facts, { planGeneration }),
        );
        await callbacks.onServerBundleReady({ planGeneration });
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
      async dev({ callbacks, plan, planGeneration }) {
        await emitServerBuild(cwd, plan, (facts) =>
          callbacks.onBuildFacts(facts, { planGeneration }),
        );
        await callbacks.onServerBundleReady({ planGeneration });
        events.push("initial-api-ready");
        return {
          async updatePlan(update, options) {
            if (!options) throw new Error("Missing dev update options.");
            await options.commitFrameworkState();
            try {
              await emitServerBuild(cwd, update.next, (facts) =>
                callbacks.onBuildFacts(facts, {
                  isRebuild: true,
                  planGeneration: options.planGeneration,
                }),
              );
              await callbacks.onServerBundleReady({
                planGeneration: options.planGeneration,
              });
            } catch (error) {
              await options.rollbackFrameworkState();
              await emitServerBuild(cwd, plan, (facts) =>
                callbacks.onBuildFacts(facts, {
                  isRebuild: true,
                  planGeneration,
                }),
              );
              await callbacks.onServerBundleReady({ planGeneration });
              throw error;
            }
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

  it("stops the old API before refreshing generated server runtime and starts the next API only after fresh bundle readiness", async () => {
    const cwd = await createServerProject();
    const schemaFile = path.join(cwd, "schema-version.txt");
    await writeFile(schemaFile, "1");
    const events: string[] = [];
    const processKinds = ["previous", "fresh"] as const;
    let processIndex = 0;
    mockedExeca.state.spawn = () => {
      const id = processKinds[processIndex++];
      if (!id) throw new Error("Unexpected additional API process.");
      const child = createFakeApiProcess(id, events);
      events.push(`start:${id}`);
      queueMicrotask(() => child.reportReady());
      return child;
    };

    const plugin: Plugin<Record<string, never>> = {
      name: "schema-runtime",
      setup(ctx) {
        ctx.addWatchFile(schemaFile);
      },
      contributions(ctx) {
        const version = fs.readFileSync(schemaFile, "utf-8").trim();
        ctx.emit.module({
          id: "database",
          scope: { kind: "server" },
          source: `export const schemaVersion = ${JSON.stringify(version)};`,
        });
      },
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "generated-server-refresh",
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
      async dev({ callbacks, plan, planGeneration }) {
        await emitServerBuild(cwd, plan, (facts) =>
          callbacks.onBuildFacts(facts, { planGeneration }),
        );
        await callbacks.onServerBundleReady({ planGeneration });
        events.push("initial-api-ready");
        return {
          async updatePlan(update, options) {
            if (!options) throw new Error("Missing dev update options.");
            events.push("update:start");
            const generatedRuntimeFile = update.next.generated?.modules.find(
              (module) => module.scope.kind === "server",
            )?.file;
            if (!generatedRuntimeFile) {
              throw new Error("Expected a generated server runtime module.");
            }
            const beforeCommit = await fs.promises.readFile(
              path.resolve(cwd, generatedRuntimeFile),
              "utf-8",
            );
            events.push(
              beforeCommit.includes('schemaVersion = "1"')
                ? "staged:previous"
                : "staged:unexpected",
            );
            await options.commitFrameworkState();
            const afterCommit = await fs.promises.readFile(
              path.resolve(cwd, generatedRuntimeFile),
              "utf-8",
            );
            events.push(
              afterCommit.includes('schemaVersion = "2"')
                ? "committed:candidate"
                : "committed:unexpected",
            );
            await emitServerBuild(cwd, update.next, (facts) =>
              callbacks.onBuildFacts(facts, {
                isRebuild: true,
                planGeneration: options.planGeneration,
              }),
            );
            events.push("update:fresh-ready");
            await callbacks.onServerBundleReady({
              planGeneration: options.planGeneration,
            });
          },
        };
      },
    };

    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
      },
      { cwd, bundler },
    );
    await waitForEvent(events, "initial-api-ready");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(schemaFile, "2");
    await waitForEvent(events, "ready:fresh");
    process.emit("SIGINT");

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Generated server refresh timed out.")),
          updateTimeoutMs,
        ),
      ),
    ]);

    expect(events.indexOf("kill:previous:SIGTERM")).toBeLessThan(
      events.indexOf("update:start"),
    );
    expect(events).toContain("staged:previous");
    expect(events).toContain("committed:candidate");
    expect(events.indexOf("update:fresh-ready")).toBeLessThan(
      events.indexOf("start:fresh"),
    );
    expect(events).toContain("kill:fresh:SIGTERM");
  });

  it("restores the previous API when an adapter rejects before committing candidate state", async () => {
    const cwd = await createServerProject();
    const schemaFile = path.join(cwd, "schema-version.txt");
    await writeFile(schemaFile, "1");
    const events: string[] = [];
    const processKinds = ["previous", "restored"] as const;
    let processIndex = 0;
    mockedExeca.state.spawn = () => {
      const id = processKinds[processIndex++];
      if (!id) throw new Error("Unexpected additional API process.");
      const child = createFakeApiProcess(id, events);
      events.push(`start:${id}`);
      queueMicrotask(() => child.reportReady());
      return child;
    };

    const plugin: Plugin<Record<string, never>> = {
      name: "reject-before-generated-commit",
      setup(ctx) {
        ctx.addWatchFile(schemaFile);
      },
      contributions(ctx) {
        const version = fs.readFileSync(schemaFile, "utf-8").trim();
        ctx.emit.module({
          id: "database",
          scope: { kind: "server" },
          source: `export const schemaVersion = ${JSON.stringify(version)};`,
        });
      },
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "reject-before-framework-commit",
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
      async dev({ callbacks, plan, planGeneration }) {
        await emitServerBuild(cwd, plan, (facts) =>
          callbacks.onBuildFacts(facts, { planGeneration }),
        );
        await callbacks.onServerBundleReady({ planGeneration });
        events.push("initial-api-ready");
        return {
          async updatePlan(update) {
            events.push("update:start");
            const generatedRuntimeFile = update.next.generated?.modules.find(
              (module) => module.scope.kind === "server",
            )?.file;
            if (!generatedRuntimeFile) {
              throw new Error("Expected a generated server runtime module.");
            }
            const stagedSource = await fs.promises.readFile(
              path.resolve(cwd, generatedRuntimeFile),
              "utf-8",
            );
            events.push(
              stagedSource.includes('schemaVersion = "1"')
                ? "staged:previous"
                : "staged:unexpected",
            );
            throw new Error("adapter rejected candidate before commit");
          },
        };
      },
    };

    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
      },
      { cwd, bundler },
    );
    await waitForEvent(events, "initial-api-ready");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(schemaFile, "2");
    await waitForEvent(events, "ready:restored");
    process.emit("SIGINT");

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Pre-commit rollback timed out.")),
          updateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toContain("staged:previous");
    expect(events.indexOf("kill:previous:SIGTERM")).toBeLessThan(
      events.indexOf("update:start"),
    );
    expect(events.filter((event) => event.startsWith("start:"))).toEqual([
      "start:previous",
      "start:restored",
    ]);
    expect(events).toContain("kill:restored:SIGTERM");
  });

  it("keeps the API stopped when a committed generated refresh omits rollback freshness", async () => {
    const cwd = await createServerProject();
    const schemaFile = path.join(cwd, "schema-version.txt");
    await writeFile(schemaFile, "1");
    const events: string[] = [];
    const processKinds = ["previous"] as const;
    let processIndex = 0;
    mockedExeca.state.spawn = () => {
      const id = processKinds[processIndex++];
      if (!id) throw new Error("Unexpected additional API process.");
      const child = createFakeApiProcess(id, events);
      events.push(`start:${id}`);
      queueMicrotask(() => child.reportReady());
      return child;
    };

    const plugin: Plugin<Record<string, never>> = {
      name: "schema-runtime-readiness",
      setup(ctx) {
        ctx.addWatchFile(schemaFile);
        return {
          buildEnd(result) {
            events.push(
              `build-end:${result.isRebuild ? "rebuild" : "initial"}`,
            );
          },
        };
      },
      contributions(ctx) {
        const version = fs.readFileSync(schemaFile, "utf-8").trim();
        ctx.emit.module({
          id: "database",
          scope: { kind: "server" },
          source: `export const schemaVersion = ${JSON.stringify(version)};`,
        });
      },
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "missing-generated-server-readiness",
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
      async dev({ callbacks, plan, planGeneration }) {
        await emitServerBuild(cwd, plan, (facts) =>
          callbacks.onBuildFacts(facts, { planGeneration }),
        );
        await callbacks.onServerBundleReady({ planGeneration });
        events.push("initial-api-ready");
        return {
          async updatePlan(update, options) {
            if (!options) throw new Error("Missing dev update options.");
            events.push("update:start");
            await options.commitFrameworkState();
            await emitServerBuild(cwd, update.next, (facts) =>
              callbacks.onBuildFacts(facts, {
                isRebuild: true,
                planGeneration: options.planGeneration,
              }),
            );
            events.push("update:return-without-ready");
            setTimeout(() => {
              void Promise.resolve(
                callbacks.onServerBundleReady({
                  planGeneration: options.planGeneration,
                }),
              ).then(() => {
                events.push("late-candidate-ready:ignored");
              });
            }, 50);
          },
        };
      },
    };

    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
      },
      { cwd, bundler },
    );
    await waitForEvent(events, "initial-api-ready");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(schemaFile, "2");
    await waitForEvent(events, "update:return-without-ready");
    await waitForEvent(events, "late-candidate-ready:ignored");
    process.emit("SIGINT");

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Generated server rollback timed out.")),
          updateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toContain("build-end:initial");
    expect(events).not.toContain("build-end:rebuild");
    expect(events.indexOf("kill:previous:SIGTERM")).toBeLessThan(
      events.indexOf("update:start"),
    );
    expect(events.filter((event) => event.startsWith("start:"))).toEqual([
      "start:previous",
    ]);
  });

  it("stops the API when the last runtime server entry is removed", async () => {
    const cwd = await createServerProject();
    const apiFile = path.join(cwd, "src/apis/health/api.ts");
    const events: string[] = [];
    mockedExeca.state.spawn = () => {
      const child = createFakeApiProcess("previous", events);
      events.push("start:previous");
      queueMicrotask(() => child.reportReady());
      return child;
    };

    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "remove-last-server-runtime",
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
      async dev({ callbacks, plan, planGeneration }) {
        await emitServerBuild(cwd, plan, (facts) =>
          callbacks.onBuildFacts(facts, { planGeneration }),
        );
        await callbacks.onServerBundleReady({ planGeneration });
        events.push("initial-api-ready");
        return {
          async updatePlan(update, options) {
            if (!options) throw new Error("Missing dev update options.");
            events.push("update:start");
            events.push(
              update.next.entries.some(
                (entry) =>
                  entry.environment === "server" && entry.phase !== "build",
              )
                ? "update:still-has-runtime"
                : "update:no-runtime",
            );
            await options.commitFrameworkState();
            events.push("update:committed");
          },
        };
      },
    };

    const running = dev(
      { output: { client: "dist/client", server: "dist/server" } },
      { cwd, bundler },
    );
    await waitForEvent(events, "initial-api-ready");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await fs.promises.rm(apiFile);
    await waitForEvent(events, "update:committed");
    process.emit("SIGINT");

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Server entry removal timed out.")),
          updateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toContain("update:no-runtime");
    expect(events.indexOf("kill:previous:SIGTERM")).toBeLessThan(
      events.indexOf("update:start"),
    );
    expect(events.filter((event) => event.startsWith("start:"))).toEqual([
      "start:previous",
    ]);
  });
});
