import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedConfig } from "@evjs/ev/config";
import type {
  ContributionContext,
  EmitApi,
  FrameworkEntryView,
  FrameworkIRView,
  FrameworkPagesAppEntryMetadata,
  FrameworkSlotInput,
  FrameworkSlotName,
  GeneratedModuleRef,
  PluginContext,
} from "@evjs/ev/plugin";
import { describe, expect, it } from "vitest";
import { evPluginQiankunMaster, evPluginQiankunSlave } from "../src/index.js";

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
  it("contributes a master entry wrapper module after the framework app entry", async () => {
    const cwd = await createProject({
      "src/main.tsx": "console.log('entry');",
      "src/qiankun.master.ts": "export default async () => ({ apps: [] });",
    });
    const plugin = evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    });
    const captured = createContributionCapture(cwd, {
      app: { entry: "./src/main.tsx" },
    });
    const sourceDir = generatedModuleDir(cwd, "@evjs/plugin-qiankun:master");

    await plugin.contributions?.(captured.ctx);

    expect(captured.watched).toEqual([
      path.join(cwd, "src/main.tsx"),
      path.join(cwd, "src/qiankun.master.ts"),
      qiankunRuntime,
    ]);
    expect(captured.modules).toHaveLength(1);
    expect(captured.modules[0]?.id).toBe("entry-wrapper");
    const source = renderModule(
      captured.modules[0],
      captured.importOf,
      (file) => toRelativeImport(sourceDir, file),
    );
    expect(source).toContain("startQiankunMaster");
    expect(source).toContain(
      toRelativeImport(sourceDir, path.join(cwd, "src/qiankun.master.ts")),
    );
    expect(source).toContain('from "@evjs/plugin-qiankun/runtime"');
    expect(source).not.toContain(toImportPath(cwd));
    expect(captured.slots).toContainEqual({
      name: "client.entry",
      input: expect.objectContaining({
        id: "entry-wrapper-slot",
        position: "after-main",
        target: { kind: "app" },
      }),
    });
  });

  it("contributes a slave replacement wrapper and keeps library output in bundler config", async () => {
    const cwd = await createProject({
      "package.json": JSON.stringify({ name: "console" }),
      "src/main.tsx": "console.log('entry');",
      "src/qiankun.slave.ts": "export default {};",
    });
    const plugin = evPluginQiankunSlave({
      runtime: "./src/qiankun.slave.ts",
    });
    const captured = createContributionCapture(cwd, {
      app: { entry: "./src/main.tsx", mount: "#root" },
    });

    await plugin.contributions?.(captured.ctx);
    const wrapper = captured.modules.find(
      (module) => module.id === "entry-wrapper",
    );
    const sourceDir = generatedModuleDir(cwd, "@evjs/plugin-qiankun:slave");
    const source = renderModule(wrapper, captured.importOf, (file) =>
      toRelativeImport(sourceDir, file),
    );

    expect(captured.slots).toContainEqual({
      name: "client.entry",
      input: expect.objectContaining({
        id: "entry-wrapper-slot",
        position: "before-main",
        mode: "replace",
        target: { kind: "app" },
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
      `loadEntry: () => import(${JSON.stringify(
        toRelativeImport(sourceDir, path.join(cwd, "src/main.tsx")),
      )})`,
    );
    expect(source).not.toContain(toImportPath(cwd));

    const hooks = await plugin.setup?.(createPluginContext(cwd, [], {}));
    const bundlerConfig: Record<string, unknown> = {
      entry: [{ name: "main", import: "./.ev/entries/main.ts" }],
    };
    await hooks?.bundlerConfig?.(
      bundlerConfig as never,
      createBundlerContext(cwd, "utoopack"),
    );
    expect(bundlerConfig.entry).toEqual([
      {
        name: "main",
        import: "./.ev/entries/main.ts",
        library: { name: "console" },
      },
    ]);
  });

  it("generates an original pages app module for slave SPA file routing", async () => {
    const cwd = await createProject({
      "package.json": JSON.stringify({ name: "catalog" }),
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/error.tsx": "export default function Error() { return null; }",
    });
    const plugin = evPluginQiankunSlave();
    const captured = createContributionCapture(
      cwd,
      { routing: createSpaRoutingConfig() },
      createPagesAppFramework(),
    );

    await plugin.contributions?.(captured.ctx);

    const original = captured.modules.find(
      (module) => module.id === "original-entry",
    );
    const wrapper = captured.modules.find(
      (module) => module.id === "entry-wrapper",
    );
    const sourceDir = generatedModuleDir(cwd, "@evjs/plugin-qiankun:slave");
    const importFile = (file: string) => toRelativeImport(sourceDir, file);
    const wrapperSource = renderModule(wrapper, captured.importOf, importFile);
    expect(original).toBeDefined();
    expect(wrapperSource).toContain(
      'loadEntry: () => import("virtual:original-entry")',
    );
  });

  it("declares qiankun as resolve.external when requested", async () => {
    const cwd = await createProject({
      "src/main.tsx": "console.log('entry');",
      "src/qiankun.master.ts": "export default async () => ({ apps: [] });",
    });
    const plugin = evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
      externalQiankun: true,
    });
    const captured = createContributionCapture(cwd, {});

    await plugin.contributions?.(captured.ctx);

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

  it("rejects mpa routing and explicit pages during contribution collection", async () => {
    const cwd = await createProject({
      "src/main.tsx": "console.log('entry');",
      "src/qiankun.master.ts": "export default async () => ({ apps: [] });",
    });
    const plugin = evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    });

    await expect(
      plugin.contributions?.(
        createContributionCapture(cwd, {
          routing: { ...createSpaRoutingConfig(), mode: "mpa" },
        }).ctx,
      ),
    ).rejects.toThrow("only supports SPA file routing");
    await expect(
      plugin.contributions?.(
        createContributionCapture(cwd, {
          pages: {
            home: { entry: "./src/main.tsx" },
          } as never,
        }).ctx,
      ),
    ).rejects.toThrow("only supports a single SPA app entry");
  });
});

function createContributionCapture(
  cwd: string,
  config: Partial<ResolvedConfig>,
  framework: FrameworkIRView = createAppFramework(),
) {
  const watched: string[] = [];
  const modules: CapturedModule[] = [];
  const slots: CapturedSlot[] = [];
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
  const ctx: ContributionContext = {
    ...createPluginContext(cwd, watched, config),
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
  return { ctx, importOf: emit.importOf, modules, slots, watched };
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

function createPluginContext(
  cwd: string,
  watched: string[],
  config: Partial<ResolvedConfig>,
): PluginContext {
  return {
    cwd,
    command: "build",
    mode: "production",
    config: {
      entry: "./src/main.tsx",
      html: "./index.html",
      plugins: [],
      ...config,
    } as never,
    logger: {} as never,
    addWatchFile(file) {
      watched.push(file);
    },
  };
}

function createBundlerContext(cwd: string, bundlerName: string) {
  return {
    cwd,
    command: "build",
    mode: "production",
    config: {} as never,
    bundlerName,
    environment: "client",
    logger: {} as never,
    addWatchFile() {},
  } as never;
}

function createSpaRoutingConfig() {
  return {
    mode: "spa" as const,
    dir: "./src/pages",
    html: "./index.html",
    mount: "#app",
    routes: [],
  };
}

function createFramework(entries: FrameworkEntryView[]): FrameworkIRView {
  return {
    apps: [],
    pages: [],
    routes: [],
    serverRoutes: [],
    serverFunctions: [],
    entries,
    getEntry(name) {
      return entries.find((entry) => entry.name === name);
    },
    getPagesAppEntry() {
      return entries.find(
        (
          entry,
        ): entry is FrameworkEntryView & {
          metadata: FrameworkPagesAppEntryMetadata;
        } => entry.metadata?.type === "pages-app",
      );
    },
  } satisfies FrameworkIRView;
}

function createAppFramework(): FrameworkIRView {
  return createFramework([
    {
      name: "main",
      import: "./src/main.tsx",
      environment: "client",
      runtime: "browser",
      kind: "app-client",
      owner: { appId: "default" },
    },
  ]);
}

function createPagesAppFramework(): FrameworkIRView {
  return createFramework([
    {
      name: "main",
      import: "./src/main.tsx",
      environment: "client",
      runtime: "browser",
      kind: "app-client",
      owner: { appId: "default" },
      metadata: {
        type: "pages-app",
        mount: "#app",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
            errorModule: "./src/pages/error.tsx",
          },
        ],
      },
    },
  ]);
}

function toImportPath(file: string): string {
  return file.split(path.sep).join(path.posix.sep);
}

function toRelativeImport(fromDir: string, targetFile: string): string {
  let relative = toImportPath(path.relative(fromDir, targetFile));
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
}

function generatedModuleDir(cwd: string, pluginName: string): string {
  return path.join(cwd, ".ev", "plugins", sanitizePathSegment(pluginName));
}

function sanitizePathSegment(value: string): string {
  const normalized = value
    .replace(/^@evjs\/plugin-/, "")
    .replace(/^@/, "")
    .replace(/\/plugin-/g, "/")
    .replace(/^plugin-/, "");
  const segments = normalized
    .replace(/:/g, "/")
    .split(/[\\/]+/)
    .map((segment) =>
      segment.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, ""),
    )
    .filter(Boolean);
  return segments.join("/") || "generated";
}
