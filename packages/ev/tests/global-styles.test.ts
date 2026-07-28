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
  createBuildPlan,
  createCoreGraph,
  discoverPageRoutes,
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

type TestConfig = BuildPlanConfig & GraphConfig;

describe("global style entry injection", () => {
  it("injects imports for every .less and .css file in src/styles/ into each client entry", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "index.html": '<div id="app"></div>',
      "src/styles/global.less": "body { margin: 0; }",
      "src/styles/theme.css": ":root { --color: red; }",
    });

    const config = await createConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);
    const plan = await materializeFrameworkIR({
      cwd,
      mode: "development",
      command: "dev",
      config: config as unknown as ResolvedConfig,
      graph: analysis.graph,
      plugins: [],
      pluginContext: {
        cwd,
        mode: "development",
        command: "dev",
        config: config as unknown as ResolvedConfig,
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
    const pageImportIndex = lines.findIndex((line) =>
      /src\/pages\/page["']/.test(line),
    );
    expect(pageImportIndex).toBeGreaterThan(0);
    const styleImportLineNumbers = lines
      .map((line, i) => ({ i, line }))
      .filter(({ line }) => /\.(less|css)["']/.test(line))
      .map(({ i }) => i);
    for (const lineNum of styleImportLineNumbers) {
      expect(lineNum).toBeLessThan(pageImportIndex);
    }
  });

  it("does not inject style imports when src/styles/ does not exist", async () => {
    const cwd = await createFixture({
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "index.html": '<div id="app"></div>',
    });

    const config = await createConfig(cwd, "spa");
    const analysis = await createCoreGraph(config, cwd);
    const plan = await materializeFrameworkIR({
      cwd,
      mode: "development",
      command: "dev",
      config: config as unknown as ResolvedConfig,
      graph: analysis.graph,
      plugins: [],
      pluginContext: {
        cwd,
        mode: "development",
        command: "dev",
        config: config as unknown as ResolvedConfig,
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
      "src/pages/home/page.tsx":
        "export default function Home() { return null; }",
      "src/pages/about/page.tsx":
        "export default function About() { return null; }",
      "index.html": '<div id="app"></div>',
      "src/styles/reset.less": "* { box-sizing: border-box; }",
    });

    const config = await createConfig(cwd, "mpa");
    const analysis = await createCoreGraph(config, cwd);
    const plan = await materializeFrameworkIR({
      cwd,
      mode: "development",
      command: "dev",
      config: config as unknown as ResolvedConfig,
      graph: analysis.graph,
      plugins: [],
      pluginContext: {
        cwd,
        mode: "development",
        command: "dev",
        config: config as unknown as ResolvedConfig,
        logger: {} as never,
        addWatchFile() {},
      },
      plan: createBuildPlan(config, analysis.graph, { mode: "development" }),
      write: true,
    });

    for (const pageId of ["home", "about"]) {
      const entry = plan.entries.find(
        (e) =>
          e.environment === "client" && e.name === `page-client-${pageId}`,
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

async function createConfig(
  cwd: string,
  mode: "spa" | "mpa" = "spa",
): Promise<TestConfig> {
  const discovery = await discoverPageRoutes(cwd, {
    dir: "./src/pages",
    mode,
    required: true,
  });
  expect(discovery.diagnostics).toEqual([]);
  return {
    routing: {
      mode,
      dir: "./src/pages",
      html: "./index.html",
      mount: "#app",
      routes: discovery.routes,
      ...(discovery.rootModule ? { rootModule: discovery.rootModule } : {}),
      ...(discovery.metadata ? { metadata: discovery.metadata } : {}),
      dependencies: discovery.dependencies,
    },
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
  };
}

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
