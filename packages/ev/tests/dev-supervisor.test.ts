import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BundlerAdapter,
  BundlerDevContext,
  BundlerDevController,
} from "../src/_internal/build/bundler.js";
import { type DevOptions, dev } from "../src/_internal/build/commands.js";
import type { Config } from "../src/config/index.js";
import type { Plugin, PluginCliShortcut } from "../src/plugin/index.js";

const capabilities = {
  build: { server: true, rsc: true, ppr: true },
} as const;

interface ControlledBundler {
  adapter: BundlerAdapter<Record<string, never>>;
  readonly events: string[];
  readonly rejectDone: Array<(error: Error) => void>;
  readonly starts: BundlerDevContext<Record<string, never>>[];
  active: number;
  maxActive: number;
}

const temporaryProjects = new Set<string>();

function createControlledBundler(
  options: {
    beforeStart?: (
      context: BundlerDevContext<Record<string, never>>,
      index: number,
      events: string[],
    ) => void | Promise<void>;
  } = {},
): ControlledBundler {
  const controlled: ControlledBundler = {
    events: [],
    rejectDone: [],
    starts: [],
    active: 0,
    maxActive: 0,
    adapter: undefined as never,
  };
  controlled.adapter = {
    name: "controlled",
    capabilities,
    async build() {
      return {};
    },
    async dev(context): Promise<BundlerDevController> {
      const index = controlled.starts.length + 1;
      controlled.starts.push(context);
      await options.beforeStart?.(context, index, controlled.events);
      controlled.active += 1;
      controlled.maxActive = Math.max(controlled.maxActive, controlled.active);
      controlled.events.push(`start:${index}`);
      let closed = false;
      let resolveDone!: () => void;
      let rejectDone!: (error: Error) => void;
      const done = new Promise<void>((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
      });
      controlled.rejectDone.push(rejectDone);
      return {
        origin: `http://localhost:${context.config.dev.port}`,
        done,
        async close() {
          if (closed) return;
          closed = true;
          controlled.active -= 1;
          controlled.events.push(`close:${index}`);
          resolveDone();
        },
      };
    },
  };
  return controlled;
}

async function createProject(
  options: { page?: boolean } = {},
): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-supervisor-"));
  temporaryProjects.add(cwd);
  await fs.writeFile(path.join(cwd, "index.html"), '<div id="app"></div>');
  await fs.writeFile(
    path.join(cwd, "package.json"),
    `${JSON.stringify({ name: "supervisor-test", private: true }, null, 2)}\n`,
  );
  if (options.page) {
    await fs.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await fs.writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Page() { return null; }\n",
    );
  }
  return cwd;
}

function createJsonConfigLoader(
  configFile: string,
  onLoad?: () => void,
): NonNullable<DevOptions<Record<string, never>>["loadConfig"]> {
  return async (
    _cwd: string,
    context?: { onDependency(file: string): void },
  ) => {
    onLoad?.();
    context?.onDependency(configFile);
    return JSON.parse(await fs.readFile(configFile, "utf-8")) as Config<
      Record<string, never>
    >;
  };
}

async function stopDev(run: Promise<void>): Promise<void> {
  process.emit("SIGINT");
  await run;
}

function installFakeTTYStdin(): {
  input: PassThrough;
  restore(): void;
} {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process, "stdin");
  const originalCI = process.env.CI;
  const input = new PassThrough();
  Object.defineProperty(input, "isTTY", { value: true });
  Object.defineProperty(input, "setRawMode", { value: () => {} });
  Object.defineProperty(process, "stdin", {
    configurable: true,
    value: input,
  });
  delete process.env.CI;

  return {
    input,
    restore() {
      input.destroy();
      if (originalDescriptor) {
        Object.defineProperty(process, "stdin", originalDescriptor);
      }
      if (originalCI === undefined) delete process.env.CI;
      else process.env.CI = originalCI;
    },
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    [...temporaryProjects].map((cwd) =>
      fs.rm(cwd, { recursive: true, force: true }),
    ),
  );
  temporaryProjects.clear();
});

describe("immutable dev supervisor", { timeout: 15_000 }, () => {
  it("binds plugin shortcuts to the controller origin and closes the supervisor", async () => {
    const cwd = await createProject();
    const controlled = createControlledBundler();
    const fakeStdin = installFakeTTYStdin();
    const observedOrigins: string[] = [];
    const dispose = vi.fn();
    const cliShortcuts = vi.fn(() => [
      {
        key: "q",
        description: "stop dev",
        async action(session: { origin: string; close(): Promise<void> }) {
          observedOrigins.push(session.origin);
          await session.close();
        },
      },
    ]);
    const plugin: Plugin<Record<string, never>> = {
      id: "session-shortcut",
      cliShortcuts,
      setup() {
        return { dispose };
      },
    };
    const run = dev(
      { plugins: [plugin] },
      { cwd, bundler: controlled.adapter },
    );

    try {
      await vi.waitFor(() => expect(cliShortcuts).toHaveBeenCalledOnce());
      fakeStdin.input.write("q\n");
      await run;

      expect(observedOrigins).toEqual([
        `http://localhost:${controlled.starts[0]?.config.dev.port}`,
      ]);
      expect(controlled.events).toEqual(["start:1", "close:1"]);
      expect(dispose).toHaveBeenCalledOnce();
    } finally {
      if (controlled.active > 0) await stopDev(run).catch(() => {});
      fakeStdin.restore();
    }
  });

  it("binds shortcuts while devServerReady is pending and aborts it on shortcut close", async () => {
    const cwd = await createProject();
    const controlled = createControlledBundler();
    const fakeStdin = installFakeTTYStdin();
    const initialDataListeners = fakeStdin.input.listenerCount("data");
    const events: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      id: "pending-ready-shortcut",
      cliShortcuts() {
        events.push("contribute");
        return [
          {
            key: "q",
            description: "close pending ready session",
            async action(session) {
              events.push("shortcut:close");
              await session.close();
              events.push("shortcut:closed");
            },
          },
        ];
      },
      setup() {
        events.push("setup");
        return {
          devServerReady({ signal }) {
            events.push("ready");
            return new Promise<void>((resolve) => {
              const onAbort = () => {
                events.push("ready:aborted");
                resolve();
              };
              if (signal.aborted) onAbort();
              else signal.addEventListener("abort", onAbort, { once: true });
            });
          },
          dispose() {
            events.push("dispose");
          },
        };
      },
    };
    const run = dev(
      { plugins: [plugin] },
      { cwd, bundler: controlled.adapter },
    );

    try {
      await vi.waitFor(() => {
        expect(events).toContain("ready");
        expect(events).toContain("contribute");
        expect(fakeStdin.input.listenerCount("data")).toBeGreaterThan(
          initialDataListeners,
        );
      });
      fakeStdin.input.write("q\n");
      await run;

      expect(events).toContain("shortcut:closed");
      expect(events.indexOf("ready:aborted")).toBeGreaterThan(
        events.indexOf("shortcut:close"),
      );
      expect(events.indexOf("dispose")).toBeGreaterThan(
        events.indexOf("ready:aborted"),
      );
      expect(controlled.events).toEqual(["start:1", "close:1"]);
    } finally {
      if (controlled.active > 0) await stopDev(run).catch(() => {});
      fakeStdin.restore();
    }
  });

  it("replays devServerReady only when the Supervisor replaces a Session", async () => {
    const cwd = await createProject();
    const configFile = path.join(cwd, "dev-config.ts");
    const packageFile = path.join(cwd, "package.json");
    await fs.writeFile(configFile, "v1\n");
    const controlled = createControlledBundler();
    const events: string[] = [];
    let loads = 0;
    const createPlugin = (label: "v1" | "v2"): Plugin => ({
      id: "session-ready",
      setup() {
        events.push(`setup:${label}`);
        return {
          async devServerReady({ signal }) {
            events.push(`ready:${label}`);
            if (label !== "v1") return;
            await new Promise<void>((resolve) => {
              const onAbort = () => {
                events.push("abort:v1");
                resolve();
              };
              if (signal.aborted) onAbort();
              else signal.addEventListener("abort", onAbort, { once: true });
            });
            events.push("settled:v1");
          },
          dispose() {
            events.push(`dispose:${label}`);
          },
        };
      },
    });
    let currentConfig: Config = { plugins: [createPlugin("v1")] };
    const run = dev(undefined, {
      cwd,
      bundler: controlled.adapter,
      reloadInitialConfig: true,
      loadConfig(_cwd, context) {
        loads += 1;
        context?.onDependency(configFile);
        return currentConfig;
      },
    });

    try {
      await vi.waitFor(() => expect(events).toContain("ready:v1"));

      const packageSource = await fs.readFile(packageFile, "utf-8");
      await fs.writeFile(packageFile, `${packageSource.trim()}\n\n`);
      await vi.waitFor(() => expect(loads).toBe(2));
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(controlled.starts).toHaveLength(1);
      expect(events.filter((event) => event === "ready:v1")).toHaveLength(1);

      currentConfig = {
        dev: {
          proxy: [{ context: ["/api"], target: "https://v2.example" }],
        },
        plugins: [createPlugin("v2")],
      };
      await fs.writeFile(configFile, "v2\n");
      await vi.waitFor(() => expect(events).toContain("ready:v2"));

      expect(controlled.events.slice(0, 3)).toEqual([
        "start:1",
        "close:1",
        "start:2",
      ]);
      expect(events.filter((event) => event === "ready:v1")).toHaveLength(1);
      expect(events.filter((event) => event === "ready:v2")).toHaveLength(1);
      expect(events.indexOf("settled:v1")).toBeGreaterThan(
        events.indexOf("abort:v1"),
      );
      expect(events.indexOf("dispose:v1")).toBeGreaterThan(
        events.indexOf("settled:v1"),
      );
      expect(events.indexOf("ready:v2")).toBeGreaterThan(
        events.indexOf("dispose:v1"),
      );

      await stopDev(run);
      expect(events).toContain("dispose:v2");
    } finally {
      if (controlled.active > 0) await stopDev(run).catch(() => {});
    }
  });

  it("keeps the CLI shortcut override disabled across revision preparation", async () => {
    const cwd = await createProject();
    const controlled = createControlledBundler();
    const cliShortcuts = vi.fn(() => [
      { key: "x", description: "must stay disabled" },
    ]);
    const run = dev(
      {
        dev: { cliShortcuts: true },
        plugins: [{ id: "disabled-shortcut", cliShortcuts }],
      },
      {
        cwd,
        bundler: controlled.adapter,
        cliShortcuts: false,
      },
    );

    await vi.waitFor(() => expect(controlled.starts).toHaveLength(1));
    expect(controlled.starts[0]?.config.dev.cliShortcuts).toBe(false);
    expect(cliShortcuts).not.toHaveBeenCalled();
    await stopDev(run);
  });

  it("keeps active shortcuts after preparation failure and replaces them with the next session", async () => {
    const cwd = await createProject();
    const configFile = path.join(cwd, "dev-config.ts");
    await fs.writeFile(configFile, "v1\n");
    const controlled = createControlledBundler();
    const fakeStdin = installFakeTTYStdin();
    const events: string[] = [];
    let loads = 0;
    let failPreparation = false;
    const createPlugin = (label: "v1" | "v2" | "v3"): Plugin => ({
      id: "reload-shortcut",
      cliShortcuts() {
        events.push(`contribute:${label}`);
        return [
          {
            key: "t",
            description: `shortcut ${label}`,
            action() {
              events.push(`shortcut:${label}`);
            },
          },
        ];
      },
      setup() {
        events.push(`setup:${label}`);
        return {
          dispose() {
            events.push(`dispose:${label}`);
          },
        };
      },
    });
    let currentConfig: Config = { plugins: [createPlugin("v1")] };
    const run = dev(undefined, {
      cwd,
      bundler: controlled.adapter,
      reloadInitialConfig: true,
      loadConfig(_cwd, context) {
        loads += 1;
        context?.onDependency(configFile);
        if (failPreparation) throw new Error("simulated preparation failure");
        return currentConfig;
      },
    });

    try {
      await vi.waitFor(() => expect(events).toContain("contribute:v1"));
      fakeStdin.input.write("t\n");
      await vi.waitFor(() => expect(events).toContain("shortcut:v1"));

      failPreparation = true;
      await fs.writeFile(configFile, "invalid\n");
      await vi.waitFor(() => expect(loads).toBe(2));
      fakeStdin.input.write("t\n");
      await vi.waitFor(() => {
        expect(events.filter((event) => event === "shortcut:v1")).toHaveLength(
          2,
        );
      });
      expect(controlled.starts).toHaveLength(1);

      failPreparation = false;
      currentConfig = {
        dev: {
          proxy: [{ context: ["/api"], target: "https://v2.example" }],
        },
        plugins: [createPlugin("v2")],
      };
      await fs.writeFile(configFile, "v2\n");
      await vi.waitFor(() => expect(events).toContain("contribute:v2"));
      fakeStdin.input.write("t\n");
      await vi.waitFor(() => expect(events).toContain("shortcut:v2"));

      expect(controlled.events.slice(0, 3)).toEqual([
        "start:1",
        "close:1",
        "start:2",
      ]);
      expect(events.filter((event) => event === "contribute:v1")).toHaveLength(
        1,
      );
      expect(events.filter((event) => event === "contribute:v2")).toHaveLength(
        1,
      );

      currentConfig = {
        dev: {
          cliShortcuts: false,
          proxy: [{ context: ["/api"], target: "https://v3.example" }],
        },
        plugins: [createPlugin("v3")],
      };
      await fs.writeFile(configFile, "v3\n");
      await vi.waitFor(() => expect(controlled.starts).toHaveLength(3));
      expect(events).not.toContain("contribute:v3");
      fakeStdin.input.write("t\n");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(events).not.toContain("shortcut:v3");
      await stopDev(run);
    } finally {
      if (controlled.active > 0) await stopDev(run).catch(() => {});
      fakeStdin.restore();
    }
  });

  it("delays replacement shortcut binding until a slow old action settles", async () => {
    const cwd = await createProject();
    const configFile = path.join(cwd, "dev-config.ts");
    await fs.writeFile(configFile, "v1\n");
    const controlled = createControlledBundler();
    const fakeStdin = installFakeTTYStdin();
    const initialDataListeners = fakeStdin.input.listenerCount("data");
    const events: string[] = [];
    let finishAction!: () => void;
    const slowAction = new Promise<void>((resolve) => {
      finishAction = resolve;
    });
    const createPlugin = (label: "v1" | "v2"): Plugin => ({
      id: "slow-shortcut",
      cliShortcuts() {
        events.push(`contribute:${label}`);
        return [
          {
            key: "s",
            description: label,
            action() {
              events.push(`shortcut:${label}`);
              return label === "v1" ? slowAction : undefined;
            },
          },
        ];
      },
      setup() {
        return {
          dispose() {
            events.push(`dispose:${label}`);
          },
        };
      },
    });
    let currentConfig: Config = { plugins: [createPlugin("v1")] };
    const run = dev(undefined, {
      cwd,
      bundler: controlled.adapter,
      reloadInitialConfig: true,
      loadConfig(_cwd, context) {
        context?.onDependency(configFile);
        return currentConfig;
      },
    });

    try {
      await vi.waitFor(() => expect(events).toContain("contribute:v1"));
      fakeStdin.input.write("s\n");
      await vi.waitFor(() => expect(events).toContain("shortcut:v1"));

      currentConfig = {
        dev: {
          proxy: [{ context: ["/api"], target: "https://v2.example" }],
        },
        plugins: [createPlugin("v2")],
      };
      await fs.writeFile(configFile, "v2\n");
      await vi.waitFor(() => expect(controlled.starts).toHaveLength(2), {
        timeout: 3_000,
      });
      expect(events).toContain("dispose:v1");
      expect(events).not.toContain("contribute:v2");
      expect(fakeStdin.input.listenerCount("data")).toBe(initialDataListeners);

      finishAction();
      await vi.waitFor(() => expect(events).toContain("contribute:v2"));
      fakeStdin.input.write("s\n");
      await vi.waitFor(() => expect(events).toContain("shortcut:v2"));
      await stopDev(run);
    } finally {
      finishAction();
      if (controlled.active > 0) await stopDev(run).catch(() => {});
      fakeStdin.restore();
    }
  });

  it("binds replacement shortcuts without waiting for a stale contribution", async () => {
    const cwd = await createProject();
    const configFile = path.join(cwd, "dev-config.ts");
    await fs.writeFile(configFile, "v1\n");
    const controlled = createControlledBundler();
    const fakeStdin = installFakeTTYStdin();
    const initialDataListeners = fakeStdin.input.listenerCount("data");
    const events: string[] = [];
    const shortcutsFor = (label: "v1" | "v2"): readonly PluginCliShortcut[] => [
      {
        key: "t",
        description: label,
        action() {
          events.push(`shortcut:${label}`);
        },
      },
    ];
    let initialContributionReleased = false;
    let releaseInitialContribution!: () => void;
    const initialContribution = new Promise<readonly PluginCliShortcut[]>(
      (resolve) => {
        releaseInitialContribution = () => {
          if (initialContributionReleased) return;
          initialContributionReleased = true;
          events.push("resolve:v1");
          resolve(shortcutsFor("v1"));
        };
      },
    );
    const createPlugin = (
      label: "v1" | "v2",
    ): Plugin<Record<string, never>> => ({
      id: "pending-shortcut-contribution",
      cliShortcuts() {
        events.push(`contribute:${label}`);
        return label === "v1" ? initialContribution : shortcutsFor(label);
      },
    });
    let currentConfig: Config<Record<string, never>> = {
      plugins: [createPlugin("v1")],
    };
    const run = dev(undefined, {
      cwd,
      bundler: controlled.adapter,
      reloadInitialConfig: true,
      loadConfig(_cwd, context) {
        context?.onDependency(configFile);
        return currentConfig;
      },
    });

    try {
      await vi.waitFor(() => expect(events).toContain("contribute:v1"));
      expect(fakeStdin.input.listenerCount("data")).toBe(initialDataListeners);

      currentConfig = {
        dev: {
          proxy: [{ context: ["/api"], target: "https://v2.example" }],
        },
        plugins: [createPlugin("v2")],
      };
      await fs.writeFile(configFile, "v2\n");
      await vi.waitFor(() => {
        expect(controlled.starts).toHaveLength(2);
        expect(events).toContain("contribute:v2");
        expect(fakeStdin.input.listenerCount("data")).toBeGreaterThan(
          initialDataListeners,
        );
      });

      fakeStdin.input.write("t\n");
      await vi.waitFor(() => expect(events).toContain("shortcut:v2"));

      releaseInitialContribution();
      await initialContribution;
      await new Promise<void>((resolve) => setImmediate(resolve));
      fakeStdin.input.write("t\n");
      await vi.waitFor(() => {
        expect(events.filter((event) => event === "shortcut:v2")).toHaveLength(
          2,
        );
      });
      expect(events).not.toContain("shortcut:v1");
      await stopDev(run);
    } finally {
      releaseInitialContribution();
      if (controlled.active > 0) await stopDev(run).catch(() => {});
      fakeStdin.restore();
    }
  });

  it("does not let a stuck shortcut action block shutdown", async () => {
    const cwd = await createProject();
    const controlled = createControlledBundler();
    const fakeStdin = installFakeTTYStdin();
    const dispose = vi.fn();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const plugin: Plugin = {
      id: "stuck-shortcut",
      cliShortcuts() {
        return [
          {
            key: "p",
            description: "pending forever",
            action() {
              markStarted();
              return new Promise<void>(() => {});
            },
          },
        ];
      },
      setup() {
        return { dispose };
      },
    };
    const run = dev(
      { plugins: [plugin] },
      { cwd, bundler: controlled.adapter },
    );

    try {
      await vi.waitFor(() => expect(controlled.starts).toHaveLength(1));
      await new Promise<void>((resolve) => setImmediate(resolve));
      fakeStdin.input.write("p\n");
      await started;
      await expect(
        Promise.race([
          stopDev(run),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("stuck shortcut blocked shutdown")),
              2_000,
            ),
          ),
        ]),
      ).resolves.toBeUndefined();
      expect(dispose).toHaveBeenCalledOnce();
    } finally {
      if (controlled.active > 0) await stopDev(run).catch(() => {});
      fakeStdin.restore();
    }
  });

  it("publishes the replacement IR after closing the old controller and before starting the new one", async () => {
    const cwd = await createProject();
    const configFile = path.join(cwd, "dev-config.json");
    await fs.writeFile(configFile, "{}\n");
    const controlled = createControlledBundler({
      async beforeStart(context, index, events) {
        const snapshot = JSON.parse(
          await fs.readFile(
            path.join(cwd, ".ev/framework/build-plan.json"),
            "utf-8",
          ),
        ) as { plan: { buildId: string } };
        events.push(
          `published:${index}:${snapshot.plan.buildId === context.plan.buildId}`,
        );
      },
    });
    const run = dev(undefined, {
      cwd,
      bundler: controlled.adapter,
      loadConfig: createJsonConfigLoader(configFile),
      reloadInitialConfig: true,
    });
    let stopped = false;

    try {
      await vi.waitFor(() => expect(controlled.starts).toHaveLength(1));
      await fs.writeFile(
        configFile,
        JSON.stringify({
          dev: {
            proxy: [{ context: ["/api"], target: "https://api.example.com" }],
          },
        }),
      );
      await vi.waitFor(() => expect(controlled.events).toContain("start:2"));

      const close = controlled.events.indexOf("close:1");
      const publish = controlled.events.indexOf("published:2:true");
      const start = controlled.events.indexOf("start:2");
      expect(close).toBeGreaterThanOrEqual(0);
      expect(publish).toBeGreaterThan(close);
      expect(start).toBeGreaterThan(publish);
      expect(controlled.maxActive).toBe(1);

      await stopDev(run);
      stopped = true;
    } finally {
      if (!stopped) await stopDev(run).catch(() => {});
    }
  });

  it("does not specialize an unconsumed package parse failure", async () => {
    const cwd = await createProject();
    const controlled = createControlledBundler();
    const original = await fs.readFile(path.join(cwd, "package.json"), "utf-8");
    const run = dev({}, { cwd, bundler: controlled.adapter });
    await vi.waitFor(() => expect(controlled.starts).toHaveLength(1));

    await fs.writeFile(path.join(cwd, "package.json"), '{ "name": "broken"');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(controlled.starts).toHaveLength(1);
    expect(controlled.events).not.toContain("close:1");

    await fs.writeFile(path.join(cwd, "package.json"), original);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(controlled.starts).toHaveLength(1);
    expect(controlled.maxActive).toBe(1);

    await stopDev(run);
    expect(controlled.events).toContain("close:1");
  });

  it("waits for a real input change after any initial preparation failure", async () => {
    const cwd = await createProject();
    const controlled = createControlledBundler();
    const configFile = path.join(cwd, "dev-config.json");
    let loadCalls = 0;
    await fs.writeFile(configFile, '{ "dev":');
    const run = dev(undefined, {
      cwd,
      bundler: controlled.adapter,
      loadConfig: createJsonConfigLoader(configFile, () => {
        loadCalls += 1;
      }),
      reloadInitialConfig: true,
    });

    await vi.waitFor(() => expect(loadCalls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(controlled.starts).toHaveLength(0);
    expect(loadCalls).toBe(1);

    await fs.writeFile(configFile, "{}\n");
    await vi.waitFor(() => expect(controlled.starts).toHaveLength(1));
    await stopDev(run);
  });

  it("keeps the active session across a generic preparation failure", async () => {
    const cwd = await createProject();
    const configFile = path.join(cwd, "dev-config.json");
    let loadCalls = 0;
    await fs.writeFile(configFile, "{}\n");
    const controlled = createControlledBundler();
    const run = dev(undefined, {
      cwd,
      bundler: controlled.adapter,
      loadConfig: createJsonConfigLoader(configFile, () => {
        loadCalls += 1;
      }),
      reloadInitialConfig: true,
    });
    await vi.waitFor(() => expect(controlled.starts).toHaveLength(1));

    await fs.writeFile(configFile, '{ "dev":');
    await vi.waitFor(() => expect(loadCalls).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(loadCalls).toBe(2);
    expect(controlled.starts).toHaveLength(1);
    expect(controlled.events).not.toContain("close:1");

    await fs.writeFile(configFile, "{}\n");
    await vi.waitFor(() => expect(loadCalls).toBe(3));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(controlled.starts).toHaveLength(1);

    await fs.writeFile(
      configFile,
      `${JSON.stringify({
        dev: {
          proxy: [{ context: ["/api"], target: "https://api.example.com" }],
        },
      })}\n`,
    );
    await vi.waitFor(() => expect(controlled.starts).toHaveLength(2));
    expect(controlled.events.slice(0, 3)).toEqual([
      "start:1",
      "close:1",
      "start:2",
    ]);
    expect(controlled.maxActive).toBe(1);
    await stopDev(run);
  });

  it("leaves ordinary Page implementation changes on the bundler HMR path", async () => {
    const cwd = await createProject({ page: true });
    const controlled = createControlledBundler();
    const config = { routing: { mode: "spa" } } as Config<
      Record<string, never>
    >;
    const run = dev(config, { cwd, bundler: controlled.adapter });
    await vi.waitFor(() => expect(controlled.starts).toHaveLength(1));

    await fs.writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      'export default function Page() { return <div className="changed" />; }\n',
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(controlled.starts).toHaveLength(1);

    await fs.mkdir(path.join(cwd, "src/pages/details"), { recursive: true });
    await fs.writeFile(
      path.join(cwd, "src/pages/details/page.tsx"),
      "export default function Details() { return null; }\n",
    );
    await vi.waitFor(() => expect(controlled.starts).toHaveLength(2));
    expect(controlled.maxActive).toBe(1);
    await stopDev(run);
  });

  it("observes Session watch files while the bundler is starting", async () => {
    const cwd = await createProject();
    const watchFile = path.join(cwd, "plugin-state.txt");
    await fs.writeFile(watchFile, "old");

    let notifyFirstStartEntered!: () => void;
    const firstStartEntered = new Promise<void>((resolve) => {
      notifyFirstStartEntered = resolve;
    });
    let releaseFirstStart!: () => void;
    const firstStartGate = new Promise<void>((resolve) => {
      releaseFirstStart = resolve;
    });
    const controlled = createControlledBundler({
      async beforeStart(_context, index) {
        if (index !== 1) return;
        notifyFirstStartEntered();
        await firstStartGate;
      },
    });
    const observedValues: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      id: "startup-watch",
      async setup(context) {
        observedValues.push(await fs.readFile(watchFile, "utf-8"));
        context.addWatchFile(watchFile);
        return {};
      },
    };
    const run = dev(
      { plugins: [plugin] },
      { cwd, bundler: controlled.adapter },
    );
    let stopped = false;

    try {
      await firstStartEntered;
      await fs.writeFile(watchFile, "new");
      releaseFirstStart();

      await vi.waitFor(() => expect(controlled.starts).toHaveLength(2));
      expect(observedValues).toEqual(["old", "new"]);
      expect(controlled.events.slice(0, 3)).toEqual([
        "start:1",
        "close:1",
        "start:2",
      ]);
      expect(controlled.maxActive).toBe(1);
      await stopDev(run);
      stopped = true;
    } finally {
      releaseFirstStart();
      if (!stopped) await stopDev(run).catch(() => {});
    }
  });

  it("reconciles when a higher-priority source candidate appears", async () => {
    const cwd = await createProject({ page: true });
    const sourceDirectory = path.join(cwd, "src/lib");
    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      'import { action } from "@/lib/helper";\nvoid action;\nexport default function Page() { return null; }\n',
    );
    await fs.writeFile(
      path.join(sourceDirectory, "helper.js"),
      '"use server";\nexport async function action() {}\n',
    );
    const controlled = createControlledBundler();
    const config = { routing: { mode: "spa" } } as Config<
      Record<string, never>
    >;
    const run = dev(config, { cwd, bundler: controlled.adapter });
    await vi.waitFor(() => expect(controlled.starts).toHaveLength(1));

    await fs.writeFile(
      path.join(sourceDirectory, "helper.ts"),
      "export async function action() {}\n",
    );

    await vi.waitFor(() => expect(controlled.starts).toHaveLength(2));
    expect(controlled.maxActive).toBe(1);
    await stopDev(run);
  });

  it("keeps the active session when a reloaded config requests new ports", async () => {
    const cwd = await createProject();
    const configFile = path.join(cwd, "dev-config.json");
    await fs.writeFile(configFile, JSON.stringify({ dev: { port: 4311 } }));
    const controlled = createControlledBundler();
    const run = dev(undefined, {
      cwd,
      bundler: controlled.adapter,
      loadConfig: createJsonConfigLoader(configFile),
      reloadInitialConfig: true,
    });
    await vi.waitFor(() => expect(controlled.starts).toHaveLength(1));

    await fs.writeFile(configFile, JSON.stringify({ dev: { port: 4312 } }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(controlled.starts).toHaveLength(1);
    expect(controlled.events).not.toContain("close:1");
    await stopDev(run);
  });

  it("fail-stops when the active bundler controller exits unexpectedly", async () => {
    const cwd = await createProject();
    const controlled = createControlledBundler();
    const run = dev({}, { cwd, bundler: controlled.adapter });
    const rejection = expect(run).rejects.toThrow("simulated bundler crash");
    await vi.waitFor(() => expect(controlled.starts).toHaveLength(1));
    await new Promise<void>((resolve) => setImmediate(resolve));

    controlled.rejectDone[0]?.(new Error("simulated bundler crash"));
    await rejection;

    expect(controlled.starts).toHaveLength(1);
    expect(controlled.events).toEqual(["start:1", "close:1"]);
  });

  it("fail-stops public dev and reverses disposal when devServerReady rejects", async () => {
    const cwd = await createProject();
    const controlled = createControlledBundler();
    const events = controlled.events;
    const createPlugin = (
      label: "first" | "second",
      rejectReady = false,
    ): Plugin<Record<string, never>> => ({
      id: `ready-${label}`,
      setup() {
        events.push(`setup:${label}`);
        return {
          devServerReady() {
            events.push(`ready:${label}`);
            if (rejectReady) throw new Error("dev server ready failed");
          },
          dispose() {
            events.push(`dispose:${label}`);
          },
        };
      },
    });
    const run = dev(
      {
        plugins: [createPlugin("first"), createPlugin("second", true)],
      },
      { cwd, bundler: controlled.adapter },
    );

    try {
      await expect(run).rejects.toThrow("dev server ready failed");
      expect(events).toEqual([
        "setup:first",
        "setup:second",
        "start:1",
        "ready:first",
        "ready:second",
        "close:1",
        "dispose:second",
        "dispose:first",
      ]);
    } finally {
      if (controlled.active > 0) await stopDev(run).catch(() => {});
    }
  });

  it("discards a stale preparation and starts only the latest saved config", async () => {
    const cwd = await createProject();
    const configFile = path.join(cwd, "dev-config.json");
    const configSource = (target: string) =>
      JSON.stringify({
        dev: { proxy: [{ context: ["/api"], target }] },
      });
    await fs.writeFile(configFile, configSource("https://initial.example"));
    let loadCalls = 0;
    let markSecondLoadStarted!: () => void;
    const secondLoadStarted = new Promise<void>((resolve) => {
      markSecondLoadStarted = resolve;
    });
    let releaseSecondLoad!: () => void;
    const secondLoadGate = new Promise<void>((resolve) => {
      releaseSecondLoad = resolve;
    });
    const controlled = createControlledBundler();
    const loadConfig: NonNullable<
      DevOptions<Record<string, never>>["loadConfig"]
    > = async (_cwd, context) => {
      context?.onDependency(configFile);
      const source = await fs.readFile(configFile, "utf-8");
      loadCalls += 1;
      if (loadCalls === 2) {
        markSecondLoadStarted();
        await secondLoadGate;
      }
      return JSON.parse(source) as Config<Record<string, never>>;
    };
    const run = dev(undefined, {
      cwd,
      bundler: controlled.adapter,
      loadConfig,
      reloadInitialConfig: true,
    });
    let stopped = false;

    try {
      await vi.waitFor(() => expect(controlled.starts).toHaveLength(1));
      await fs.writeFile(configFile, configSource("https://stale.example"));
      await secondLoadStarted;
      await fs.writeFile(configFile, configSource("https://latest.example"));
      releaseSecondLoad();

      await vi.waitFor(() => expect(controlled.starts).toHaveLength(2));
      expect(loadCalls).toBeGreaterThanOrEqual(3);
      expect(
        controlled.starts.map((context) => context.config.dev.proxy[0]?.target),
      ).toEqual(["https://initial.example", "https://latest.example"]);
      expect(controlled.events.slice(-2)).toEqual(["close:1", "start:2"]);

      await stopDev(run);
      stopped = true;
    } finally {
      releaseSecondLoad();
      if (!stopped) await stopDev(run).catch(() => {});
    }
  });
});
