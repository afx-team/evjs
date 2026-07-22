import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  BuildPlanConfig,
  GraphConfig,
} from "../src/_internal/build/index.js";
import {
  createAppGraph,
  createBuildPlan,
  materializeFrameworkIR,
} from "../src/_internal/build/index.js";
import type { ResolvedConfig } from "../src/config/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("global style entry injection", () => {
  it("injects imports for every .less and .css file in src/styles/ into each client entry", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "index.html": '<div id="app"></div>',
      "src/styles/global.less": "body { margin: 0; }",
      "src/styles/theme.css": ":root { --color: red; }",
    });

    const config = createConfig();
    const analysis = await createAppGraph(config, cwd);
    const plan = await materializeFrameworkIR({
      cwd,
      mode: "development",
      command: "dev",
      config: config as ResolvedConfig,
      graph: analysis.graph,
      plugins: [],
      pluginContext: {
        cwd,
        mode: "development",
        command: "dev",
        config: config as ResolvedConfig,
        logger: {} as never,
        addWatchFile() {},
      },
      plan: createBuildPlan(config, analysis.graph, { mode: "development" }),
      write: true,
    });

    const clientEntry = plan.entries.find(
      (entry) => entry.environment === "client" && entry.name === "main",
    );
    expect(clientEntry).toBeDefined();
    if (!clientEntry) throw new Error("Expected client entry");

    const entryFile = path.resolve(cwd, clientEntry.import);
    expect(existsSync(entryFile)).toBe(true);
    const source = await fs.readFile(entryFile, "utf-8");

    // The global .less and .css files should be imported at the top of the entry,
    // in deterministic (alphabetical) filename order.
    const importLines = source
      .split("\n")
      .filter((line) => line.startsWith("import "))
      .map((line) => line.trim());
    const styleImports = importLines.filter((line) =>
      /\.(less|css)["']/.test(line),
    );
    expect(styleImports).toHaveLength(2);
    expect(styleImports[0]).toContain("global.less");
    expect(styleImports[1]).toContain("theme.css");

    const lines = source.split("\n");
    const mainImportIndex = lines.findIndex((line) =>
      /\/src\/main["']/.test(line),
    );
    expect(mainImportIndex).toBeGreaterThan(0);
    const styleImportLineNumbers = lines
      .map((line, i) => ({ i, line }))
      .filter(({ line }) => /\.(less|css)["']/.test(line))
      .map(({ i }) => i);
    for (const lineNum of styleImportLineNumbers) {
      expect(lineNum).toBeLessThan(mainImportIndex);
    }
  });

  it("does not inject style imports when src/styles/ does not exist", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "index.html": '<div id="app"></div>',
    });

    const config = createConfig();
    const analysis = await createAppGraph(config, cwd);
    const plan = await materializeFrameworkIR({
      cwd,
      mode: "development",
      command: "dev",
      config: config as ResolvedConfig,
      graph: analysis.graph,
      plugins: [],
      pluginContext: {
        cwd,
        mode: "development",
        command: "dev",
        config: config as ResolvedConfig,
        logger: {} as never,
        addWatchFile() {},
      },
      plan: createBuildPlan(config, analysis.graph, { mode: "development" }),
      write: true,
    });

    const clientEntry = plan.entries.find(
      (entry) => entry.environment === "client" && entry.name === "main",
    );
    expect(clientEntry).toBeDefined();
    if (!clientEntry) throw new Error("Expected client entry");

    const entryFile = path.resolve(cwd, clientEntry.import);
    const source = await fs.readFile(entryFile, "utf-8");

    expect(source).not.toMatch(/import.*\.less/);
    expect(source).not.toMatch(/import.*\.css/);
  });

  it("injects global styles into MPA page entries", async () => {
    const cwd = await createFixture({
      "src/pages/Home.tsx": "export default () => <div>Home</div>;",
      "src/pages/About.tsx": "export default () => <div>About</div>;",
      "index.html": '<div id="app"></div>',
      "src/styles/reset.less": "* { box-sizing: border-box; }",
    });

    const config = createConfig({
      pages: {
        home: { component: "./src/pages/Home.tsx", html: "./index.html" },
        about: { component: "./src/pages/About.tsx", html: "./index.html" },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = await materializeFrameworkIR({
      cwd,
      mode: "development",
      command: "dev",
      config: config as ResolvedConfig,
      graph: analysis.graph,
      plugins: [],
      pluginContext: {
        cwd,
        mode: "development",
        command: "dev",
        config: config as ResolvedConfig,
        logger: {} as never,
        addWatchFile() {},
      },
      plan: createBuildPlan(config, analysis.graph, { mode: "development" }),
      write: true,
    });

    for (const pageId of ["home", "about"]) {
      const entry = plan.entries.find(
        (e) => e.environment === "client" && e.name === pageId,
      );
      expect(entry).toBeDefined();
      if (!entry) throw new Error("Expected client entry");
      const entryFile = path.resolve(cwd, entry.import);
      expect(existsSync(entryFile)).toBe(true);
      const source = await fs.readFile(entryFile, "utf-8");
      expect(source).toContain("reset.less");
    }
  });
});

async function createFixture(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-global-styles-"));
  tempDirs.push(dir);
  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(dir, file);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content);
  }
  return dir;
}

type TestConfig = BuildPlanConfig &
  Pick<GraphConfig, "apps"> & {
    dev: unknown;
    transport: unknown;
    plugins: unknown[];
  };
type TestConfigOverrides = Partial<Omit<TestConfig, "output" | "server">> & {
  output?: Partial<TestConfig["output"]>;
  server?: Partial<Omit<TestConfig["server"], "runtime">> & {
    runtime?: Partial<TestConfig["server"]["runtime"]>;
  };
};

function createConfig(overrides: TestConfigOverrides = {}): TestConfig {
  const base: TestConfig = {
    entry: "./src/main.tsx",
    html: "./index.html",
    pages: undefined,
    output: {
      client: "dist/client",
      server: "dist/server",
    },
    server: {
      basePath: "/__evjs",
      runtime: {
        fn: "__evjs/fn",
        ppr: "__evjs/ppr",
      },
    },
    dev: {},
    transport: {},
    plugins: [],
  };
  return {
    ...base,
    ...overrides,
    output: { ...base.output, ...overrides.output },
    server: {
      ...base.server,
      ...overrides.server,
      runtime: {
        ...base.server.runtime,
        ...overrides.server?.runtime,
      },
    },
  };
}
