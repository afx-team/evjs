import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { resolvePluginSettingsState } from "@evjs/ev/_internal/build";
import { type ResolvedConfig, resolveConfig } from "@evjs/ev/config";
import type {
  ConfigureBundlerContext,
  EmitApi,
  FrameworkApplicationEntryMetadata,
  FrameworkEntryView,
  FrameworkSlotInput,
  FrameworkSlotName,
  FrameworkView,
  GeneratedModuleRef,
  Plugin,
  PluginEmitIRContext,
  PluginSetupContext,
} from "@evjs/ev/plugin";
import { transformSync } from "@swc/core";
import { DOMParser } from "domparser-rs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createQiankunSlaveHooks,
  emitQiankunMasterIR,
  emitQiankunSlaveIR,
  evPluginQiankunMaster,
  evPluginQiankunSlave,
} from "../src/index.js";
import type { QiankunSlaveRuntime } from "../src/runtime.js";
import * as qiankunRuntimeModule from "../src/runtime.js";

const qiankunRuntime = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/runtime.ts",
);

interface CapturedModule {
  id: string;
  source:
    | string
    | ((helpers: {
        importOf(ref: GeneratedModuleRef): string;
        importFile(file: string): string;
      }) => string);
}

interface CapturedSlot {
  name: FrameworkSlotName;
  input: FrameworkSlotInput<FrameworkSlotName>;
}

describe("@evjs/plugin-qiankun plugin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces the master entry so runtime routes install before render", async () => {
    const cwd = await createProject({
      "src/pages/page.tsx": "export default function Page() { return null; }",
      "src/qiankun.master.ts": "export default async () => ({ apps: [] });",
    });
    const plugin = activatePlugin(
      evPluginQiankunMaster({ resolver: "./src/qiankun.master.ts" }),
    );
    const captured = createContributionCapture(cwd, {});
    const sourceDir = generatedModuleDir(cwd, "qiankun-master");

    await plugin.emitIR?.(captured.ctx);

    expect(captured.watched).toEqual([
      path.join(cwd, "src/qiankun.master.ts"),
      qiankunRuntime,
    ]);
    expect(captured.modules).toHaveLength(2);
    const wrapper = captured.modules.find(
      (module) => module.id === "entry-wrapper",
    );
    const source = renderModule(wrapper, captured.importOf, (file) =>
      toRelativeImport(sourceDir, file),
    );
    expect(source).toContain("startQiankunMaster");
    expect(source).toContain("resolver: masterResolver");
    expect(source).toContain('mount: "#app"');
    expect(source).toContain(
      'loadEntry: () => import("virtual:original-entry")',
    );
    expect(source).toContain(
      toRelativeImport(sourceDir, path.join(cwd, "src/qiankun.master.ts")),
    );
    expect(source).toContain('from "@evjs/plugin-qiankun/runtime"');
    expect(source).not.toContain(toImportPath(cwd));
    expect(captured.slots).toContainEqual({
      name: "client.entry",
      input: expect.objectContaining({
        id: "entry-wrapper-slot",
        position: "before-main",
        mode: "replace",
        target: { kind: "application" },
      }),
    });
    expect(captured.entryFacades).toEqual([
      expect.objectContaining({
        id: "original-entry",
        autoStart: false,
      }),
    ]);
  });

  it("composes a master contribution from an opaque generated resolver", async () => {
    const cwd = await createProject({
      "src/pages/page.tsx": "export default function Page() { return null; }",
    });
    const captured = createContributionCapture(cwd, {});
    const resolver = captured.ctx.emit.module({
      id: "platform-resolver",
      scope: { kind: "application" },
      source: "export default async () => ({ apps: [] });",
    });

    await emitQiankunMasterIR(captured.ctx, { resolver });

    expect(captured.watched).toEqual([qiankunRuntime]);
    const wrapper = captured.modules.find(
      (module) => module.id === "entry-wrapper",
    );
    const source = renderModule(wrapper, captured.importOf);
    expect(source).toContain('from "virtual:platform-resolver"');
    expect(source).toContain('"default"');
    expect(captured.slots).toContainEqual({
      name: "client.entry",
      input: expect.objectContaining({
        id: "entry-wrapper-slot",
        position: "before-main",
        mode: "replace",
        target: { kind: "application" },
      }),
    });
  });

  it("contributes a slave replacement wrapper without library output for utoopack", async () => {
    const cwd = await createProject({
      "package.json": JSON.stringify({ name: "console" }),
      "src/pages/page.tsx": "export default function Page() { return null; }",
      "src/qiankun.slave.ts": "export default {};",
    });
    const plugin = activatePlugin(
      evPluginQiankunSlave({ runtime: "./src/qiankun.slave.ts" }),
    );
    const captured = createContributionCapture(
      cwd,
      {},
      createApplicationFramework("#root"),
    );

    await plugin.emitIR?.(captured.ctx);
    const wrapper = captured.modules.find(
      (module) => module.id === "entry-wrapper",
    );
    const sourceDir = generatedModuleDir(cwd, "qiankun-slave");
    const source = renderModule(wrapper, captured.importOf, (file) =>
      toRelativeImport(sourceDir, file),
    );

    expect(captured.slots).toContainEqual({
      name: "client.entry",
      input: expect.objectContaining({
        id: "entry-wrapper-slot",
        position: "before-main",
        mode: "replace",
        target: { kind: "application" },
      }),
    });
    expect(source).toContain("createQiankunSlaveLifecycles");
    expect(source).toContain('name: "console"');
    expect(source).toContain('mount: "#root"');
    expect(source).toContain('from "@evjs/plugin-qiankun/runtime"');
    expect(source).toContain(
      toRelativeImport(sourceDir, path.join(cwd, "src/qiankun.slave.ts")),
    );
    expect(source).toContain(
      'loadEntry: () => import("virtual:original-entry")',
    );
    expect(source).not.toContain(toImportPath(cwd));
    expect(source).toContain(
      '(window as unknown as Record<string, unknown>)["console"] = qiankunLifecycles',
    );

    const hooks = await plugin.setup?.(createPluginSetupContext(cwd, [], {}));
    const utoopackConfig: Record<string, unknown> = {
      entry: [{ name: "main", import: "./.ev/entries/main.ts" }],
    };
    await hooks?.configureBundler?.(
      utoopackConfig as never,
      createBundlerContext(cwd, "utoopack"),
    );
    expect(utoopackConfig.entry).toEqual([
      { name: "main", import: "./.ev/entries/main.ts" },
    ]);
  });

  it("composes slave helpers around a named generated runtime", async () => {
    const cwd = await createProject({
      "src/pages/page.tsx": "export default function Page() { return null; }",
    });
    const captured = createContributionCapture(cwd, {});
    const runtime = captured.ctx.emit.module({
      id: "platform-runtime",
      scope: { kind: "application" },
      source: "export const runtime = {};",
    });

    await emitQiankunSlaveIR(captured.ctx, {
      name: "platform-slave",
      runtime: { module: runtime, exportName: "runtime" },
    });

    expect(captured.watched).toEqual([qiankunRuntime]);
    const wrapper = captured.modules.find(
      (module) => module.id === "entry-wrapper",
    );
    const source = renderModule(wrapper, captured.importOf);
    expect(source).toContain('from "virtual:platform-runtime"');
    expect(source).toContain('"runtime"');

    const webpackConfig: Record<string, unknown> = {
      entry: { main: "./.ev/entries/main.ts" },
    };
    const hooks = await createQiankunSlaveHooks(
      createPluginSetupContext(cwd, [], {}),
      { name: "platform-slave" },
    );
    await hooks.configureBundler?.(
      [webpackConfig] as never,
      createBundlerContext(cwd, "webpack"),
    );
    expect(webpackConfig.entry).toEqual({
      main: {
        import: "./.ev/entries/main.ts",
        library: { name: "platform-slave", type: "umd" },
      },
    });

    const doc = new DOMParser().parseFromString(
      '<!doctype html><html><head></head><body><script src="/main.js"></script></body></html>',
      "text/html",
    );
    await hooks.transformHtml?.(doc as never, {} as never);
    expect(doc.querySelector("script")?.textContent).toContain(
      'var appName = "platform-slave"',
    );
  });

  it.each([
    "entry",
    "mount",
    "start",
  ] as const)("reports the original standalone %s failure from the generated entry", async (phase) => {
    const error = new Error(`${phase} failed`);
    const stack = error.stack;
    const fail = () => {
      throw error;
    };
    const reportError = vi.fn();
    const entry = await executeSlaveEntry({
      loadEntry: phase === "entry" ? fail : () => ({ start: fail }),
      runtime: phase === "mount" ? { mount: fail } : {},
      reportError,
    });

    // Queue behind automatic startup without awaiting standalone() ourselves.
    await entry.lifecycles.bootstrap();

    expect(reportError).toHaveBeenCalledExactlyOnceWith(error);
    expect(reportError.mock.calls[0]?.[0]).toBe(error);
    expect(error.stack).toBe(stack);
    expect(entry.scheduleError).not.toHaveBeenCalled();
  });

  it("rethrows standalone failures asynchronously when reportError is unavailable", async () => {
    const error = new Error("entry evaluation failed");
    const entry = await executeSlaveEntry({
      loadEntry() {
        throw error;
      },
    });

    await entry.lifecycles.bootstrap();

    expect(entry.scheduleError).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
      0,
    );
    const rethrow = entry.scheduleError.mock.calls[0]?.[0];
    let reportedError: unknown;
    try {
      rethrow?.();
    } catch (caught) {
      reportedError = caught;
    }
    expect(reportedError).toBe(error);
  });

  it("starts the generated standalone entry successfully without reporting errors", async () => {
    const start = vi.fn();
    const reportError = vi.fn();
    const entry = await executeSlaveEntry({
      loadEntry: () => ({ start }),
      reportError,
    });

    await entry.lifecycles.bootstrap();

    expect(start).toHaveBeenCalledExactlyOnceWith("#app");
    expect(reportError).not.toHaveBeenCalled();
    expect(entry.scheduleError).not.toHaveBeenCalled();
    expect(entry.window.catalog).toEqual(entry.lifecycles);
  });

  it("leaves host startup and error handling to the exported lifecycles", async () => {
    const error = new Error("host entry evaluation failed");
    const start = vi.fn();
    const loadEntry = vi
      .fn(() => ({ start }))
      .mockImplementationOnce(() => {
        throw error;
      });
    const reportError = vi.fn();
    const entry = await executeSlaveEntry({
      loadEntry,
      reportError,
      poweredByQiankun: true,
    });

    await entry.lifecycles.bootstrap();
    expect(loadEntry).not.toHaveBeenCalled();
    await expect(entry.lifecycles.mount()).rejects.toBe(error);
    await entry.lifecycles.mount();
    await entry.lifecycles.unmount();

    expect(loadEntry).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledExactlyOnceWith("#app");
    expect(reportError).not.toHaveBeenCalled();
    expect(entry.scheduleError).not.toHaveBeenCalled();
  });

  it("keeps UMD library output for webpack slave builds", async () => {
    const cwd = await createProject({
      "package.json": JSON.stringify({ name: "console" }),
      "src/pages/page.tsx": "export default function Page() { return null; }",
    });
    const plugin = activatePlugin(evPluginQiankunSlave());
    const captured = createContributionCapture(cwd, {});
    await plugin.emitIR?.(captured.ctx);

    const hooks = await plugin.setup?.(createPluginSetupContext(cwd, [], {}));
    const webpackConfig: Record<string, unknown> = {
      entry: { main: "./.ev/entries/main.ts" },
    };
    await hooks?.configureBundler?.(
      [webpackConfig] as never,
      createBundlerContext(cwd, "webpack"),
    );

    expect(webpackConfig.entry).toEqual({
      main: {
        import: "./.ev/entries/main.ts",
        library: { name: "console", type: "umd" },
      },
    });
  });

  it("rejects the legacy single webpack configuration shape", async () => {
    const cwd = await createProject({
      "src/pages/page.tsx": "export default function Page() { return null; }",
    });
    const hooks = await createQiankunSlaveHooks(
      createPluginSetupContext(cwd, [], {}),
      { name: "console" },
    );

    expect(() =>
      hooks.configureBundler?.(
        { entry: { main: "./.ev/entries/main.ts" } } as never,
        createBundlerContext(cwd, "webpack"),
      ),
    ).toThrow(
      "[evjs:plugin-qiankun] Webpack configureBundler expected an array of configurations.",
    );
  });

  it("injects an utoopack lifecycle proxy before the qiankun entry script", async () => {
    const cwd = await createProject({
      "package.json": JSON.stringify({ name: "console" }),
      "src/pages/page.tsx": "export default function Page() { return null; }",
    });
    const plugin = activatePlugin(evPluginQiankunSlave());
    const captured = createContributionCapture(cwd, {});
    await plugin.emitIR?.(captured.ctx);
    const hooks = await plugin.setup?.(createPluginSetupContext(cwd, [], {}));
    const doc = new DOMParser().parseFromString(
      '<!doctype html><html><head></head><body><script src="/main.js"></script></body></html>',
      "text/html",
    );

    await hooks?.transformHtml?.(doc as never, {} as never);

    const scripts = doc.querySelectorAll("script");
    expect(scripts).toHaveLength(2);
    expect(scripts[0]?.id).toBe("__EVJS_QIANKUN_LIFECYCLE_PROXY__");
    expect(scripts[0]?.textContent).toContain('var appName = "console"');
    expect(scripts[1]?.getAttribute("src")).toBe("main.js");
    expect(scripts[1]?.hasAttribute("entry")).toBe(true);
  });

  it("generates an original Application module for slave SPA routing", async () => {
    const cwd = await createProject({
      "package.json": JSON.stringify({ name: "catalog" }),
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "src/pages/error.tsx": "export default function Error() { return null; }",
    });
    const plugin = activatePlugin(evPluginQiankunSlave());
    const captured = createContributionCapture(
      cwd,
      {},
      createApplicationFramework(),
    );

    await plugin.emitIR?.(captured.ctx);

    const original = captured.modules.find(
      (module) => module.id === "original-entry",
    );
    const wrapper = captured.modules.find(
      (module) => module.id === "entry-wrapper",
    );
    const sourceDir = generatedModuleDir(cwd, "qiankun-slave");
    const importFile = (file: string) => toRelativeImport(sourceDir, file);
    const wrapperSource = renderModule(wrapper, captured.importOf, importFile);
    expect(original).toBeDefined();
    expect(captured.entryFacades).toEqual([
      expect.objectContaining({
        id: "original-entry",
        autoStart: false,
      }),
    ]);
    expect(wrapperSource).toContain(
      'loadEntry: () => import("virtual:original-entry")',
    );
  });

  it("declares qiankun as resolve.external when requested", async () => {
    const cwd = await createProject({
      "src/pages/page.tsx": "export default function Page() { return null; }",
      "src/qiankun.master.ts": "export default async () => ({ apps: [] });",
    });
    const plugin = activatePlugin(
      evPluginQiankunMaster({
        resolver: "./src/qiankun.master.ts",
        externalQiankun: true,
      }),
    );
    const captured = createContributionCapture(cwd, {});

    await plugin.emitIR?.(captured.ctx);

    expect(captured.slots).toContainEqual({
      name: "resolve.external",
      input: {
        id: "qiankun-external",
        specifier: "qiankun",
        source: "qiankun",
        runtime: "client",
      },
    });
  });

  it("rejects unsupported normalized Application shapes", async () => {
    const cwd = await createProject({
      "src/pages/page.tsx": "export default function Page() { return null; }",
      "src/qiankun.master.ts": "export default async () => ({ apps: [] });",
    });
    const plugin = activatePlugin(
      evPluginQiankunMaster({ resolver: "./src/qiankun.master.ts" }),
    );

    await expect(
      plugin.emitIR?.(
        createContributionCapture(cwd, {}, createMpaFramework()).ctx,
      ),
    ).rejects.toThrow("only supports a normalized SPA Application");
    await expect(
      plugin.emitIR?.(
        createContributionCapture(cwd, {}, createMultipleAppFramework()).ctx,
      ),
    ).rejects.toThrow("requires exactly one normalized SPA Application");
    await expect(
      plugin.emitIR?.(
        createContributionCapture(cwd, {}, createSpaFrameworkWithoutEntry())
          .ctx,
      ),
    ).rejects.toThrow(
      'requires a generated client entry for normalized SPA Application "default"',
    );
  });
});

async function executeSlaveEntry(options: {
  loadEntry(): unknown;
  runtime?: QiankunSlaveRuntime;
  reportError?: (error: unknown) => void;
  poweredByQiankun?: boolean;
}) {
  const cwd = await createProject({});
  const captured = createContributionCapture(cwd, {});
  const runtime = captured.ctx.emit.module({
    id: "slave-runtime",
    scope: { kind: "application" },
    source: "export default {};",
  });
  await emitQiankunSlaveIR(captured.ctx, { name: "catalog", runtime });
  const source = renderModule(
    captured.modules.find((module) => module.id === "entry-wrapper"),
    captured.importOf,
  );
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  });
  const lifecycles = {} as Pick<
    ReturnType<typeof qiankunRuntimeModule.createQiankunSlaveLifecycles>,
    "bootstrap" | "mount" | "unmount" | "update"
  >;
  const window: Record<string, unknown> = {};
  const scheduleError = vi.fn<(callback: () => void, delay: number) => void>();
  vi.stubGlobal("__POWERED_BY_QIANKUN__", options.poweredByQiankun ?? false);
  vi.stubGlobal("reportError", options.reportError);
  try {
    runInNewContext(code, {
      exports: lifecycles,
      window,
      reportError: options.reportError,
      setTimeout: scheduleError,
      require(specifier: string) {
        if (specifier === "@evjs/plugin-qiankun/runtime") {
          return qiankunRuntimeModule;
        }
        if (specifier === "virtual:slave-runtime") {
          return { __esModule: true, default: options.runtime ?? {} };
        }
        if (specifier === "virtual:original-entry") return options.loadEntry();
        throw new Error(`Unexpected generated import: ${specifier}`);
      },
    });
    return { lifecycles, window, scheduleError };
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

function createContributionCapture(
  cwd: string,
  config: Partial<ResolvedConfig>,
  framework: FrameworkView = createApplicationFramework(),
) {
  const watched: string[] = [];
  const modules: CapturedModule[] = [];
  const slots: CapturedSlot[] = [];
  const entryFacades: Parameters<EmitApi["entryFacade"]>[0][] = [];
  const refs = new Map<GeneratedModuleRef, string>();
  const emit: EmitApi = {
    module(input) {
      const ref = { id: input.id } as unknown as GeneratedModuleRef;
      refs.set(ref, input.id);
      modules.push({ id: input.id, source: input.source });
      return ref;
    },
    data(input) {
      const ref = { id: input.id } as unknown as GeneratedModuleRef;
      refs.set(ref, input.id);
      modules.push({ id: input.id, source: JSON.stringify(input.value) });
      return ref;
    },
    entryFacade(input) {
      entryFacades.push(input);
      const ref = { id: input.id } as unknown as GeneratedModuleRef;
      refs.set(ref, input.id);
      modules.push({
        id: input.id,
        source: "/* framework entry facade */",
      });
      return ref;
    },
    importOf(ref) {
      return `virtual:${refs.get(ref) ?? "unknown"}`;
    },
  };
  const ctx: PluginEmitIRContext = {
    ...createPluginSetupContext(cwd, watched, config),
    framework,
    emit,
    slot(name) {
      return {
        add(input) {
          slots.push({ name, input });
        },
      };
    },
  };
  return {
    ctx,
    importOf: emit.importOf,
    modules,
    slots,
    watched,
    entryFacades,
  };
}

function renderModule(
  module: CapturedModule | undefined,
  importOf: EmitApi["importOf"],
  importFile: (file: string) => string = (file) => file,
): string {
  expect(module).toBeDefined();
  return typeof module?.source === "function"
    ? module.source({ importFile, importOf })
    : (module?.source ?? "");
}

function activatePlugin<TPlugin extends Plugin>(plugin: TPlugin): TPlugin {
  const config = resolveConfig({ routing: { mode: "spa" }, plugins: [plugin] });
  resolvePluginSettingsState(config);
  return config.plugins[0] as TPlugin;
}

async function createProject(files: Record<string, string>): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-qiankun-"));
  if (!files["package.json"]) {
    files["package.json"] = JSON.stringify({ name: "app" });
  }
  for (const [name, source] of Object.entries(files)) {
    const file = path.join(cwd, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, source, "utf-8");
  }
  return cwd;
}

function createPluginSetupContext(
  cwd: string,
  watched: string[],
  config: Partial<ResolvedConfig>,
): PluginSetupContext {
  return {
    cwd,
    mode: "production",
    config: {
      conventions: true,
      plugins: [],
      ...config,
    } as never,
    logger: {} as never,
    addWatchFile(file) {
      watched.push(file);
    },
  };
}

function createBundlerContext(
  cwd: string,
  bundlerName: string,
): ConfigureBundlerContext {
  return {
    cwd,
    mode: "production",
    config: {} as never,
    bundlerName,
    environment: "client",
    logger: {} as never,
    addWatchFile() {},
  };
}

function createFramework(
  entries: FrameworkEntryView[],
  applications: FrameworkView["applications"],
  pages: FrameworkView["pages"] = [],
  routes: FrameworkView["routes"] = [],
  documents: FrameworkView["documents"] = [],
): FrameworkView {
  return {
    applications,
    pages,
    routes,
    documents,
    serverRoutes: [],
    serverFunctions: [],
    entries,
    getEntry(name) {
      return entries.find((entry) => entry.name === name);
    },
    getApplicationEntry(applicationId) {
      return entries.find(
        (
          entry,
        ): entry is FrameworkEntryView & {
          kind: "application-client";
          metadata: FrameworkApplicationEntryMetadata;
        } =>
          entry.kind === "application-client" &&
          entry.metadata?.type === "application" &&
          (applicationId === undefined ||
            entry.owner?.applicationId === applicationId),
      );
    },
  } satisfies FrameworkView;
}

function createApplicationFramework(mount = "#app"): FrameworkView {
  return createFramework(
    [
      {
        name: "main",
        import: "./.ev/entries/main.ts",
        environment: "client",
        runtime: "browser",
        kind: "application-client",
        owner: { applicationId: "default" },
        metadata: {
          type: "application",
          mount,
          routes: [
            {
              id: "index",
              path: "/",
              module: "./src/pages/page.tsx",
              errorModule: "./src/pages/error.tsx",
            },
          ],
        },
      },
    ],
    [
      {
        id: "default",
        root: ".",
        routingMode: "spa",
        pageIds: ["index"],
        routeIds: ["index"],
        documentIds: ["app:default"],
        plugins: {},
        provenance: {
          producer: { kind: "provider", id: "evjs:page-anchor" },
        },
      },
    ],
    [
      {
        id: "index",
        applicationId: "default",
        source: {
          module: "./src/pages/page.tsx",
          scope: { kind: "directory", root: "./src/pages" },
          provider: "evjs:page-anchor",
        },
        plugins: {},
        render: "csr",
        provenance: {
          producer: { kind: "provider", id: "evjs:page-anchor" },
        },
      },
    ],
    [
      {
        id: "index",
        applicationId: "default",
        pattern: { segments: [] },
        target: { kind: "page", pageId: "index" },
        facets: { wrappers: [] },
        provenance: {
          producer: { kind: "provider", id: "evjs:page-anchor" },
        },
      },
    ],
    [
      {
        id: "app:default",
        template: "./index.html",
        output: "index.html",
        applicationId: "default",
        owner: { kind: "application" },
        mount,
        bootstrap: { kind: "application" },
        provenance: {
          producer: { kind: "provider", id: "evjs:page-anchor" },
        },
      },
    ],
  );
}

function createMpaFramework(): FrameworkView {
  return createFramework(
    [],
    [
      {
        id: "default",
        root: ".",
        routingMode: "mpa",
        pageIds: ["home"],
        routeIds: ["home"],
        documentIds: ["home"],
        plugins: {},
        provenance: {
          producer: { kind: "provider", id: "evjs:page-anchor" },
        },
      },
    ],
    [
      {
        id: "home",
        applicationId: "default",
        source: {
          module: "./src/pages/home/page.tsx",
          scope: { kind: "directory", root: "./src/pages/home" },
          provider: "evjs:page-anchor",
        },
        plugins: {},
        render: "csr",
        provenance: {
          producer: { kind: "provider", id: "evjs:page-anchor" },
        },
      },
    ],
  );
}

function createSpaFrameworkWithoutEntry(): FrameworkView {
  const framework = createApplicationFramework();
  return {
    ...framework,
    entries: [],
    getEntry() {
      return undefined;
    },
    getApplicationEntry() {
      return undefined;
    },
  };
}

function createMultipleAppFramework(): FrameworkView {
  return createFramework(
    [],
    [
      {
        id: "one",
        root: ".",
        routingMode: "spa",
        pageIds: [],
        routeIds: [],
        documentIds: [],
        plugins: {},
        provenance: {
          producer: { kind: "provider", id: "evjs:page-anchor" },
        },
      },
      {
        id: "two",
        root: ".",
        routingMode: "spa",
        pageIds: [],
        routeIds: [],
        documentIds: [],
        plugins: {},
        provenance: {
          producer: { kind: "provider", id: "evjs:page-anchor" },
        },
      },
    ],
  );
}

function toImportPath(file: string): string {
  return file.split(path.sep).join(path.posix.sep);
}

function toRelativeImport(fromDir: string, targetFile: string): string {
  let relative = toImportPath(path.relative(fromDir, targetFile));
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
}

function generatedModuleDir(cwd: string, pluginId: string): string {
  return path.join(cwd, ".ev", "plugins", pluginId);
}
