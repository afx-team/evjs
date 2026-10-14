import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeServerSchedules } from "../src/_internal/build/analysis/server-schedules.js";
import { withPageRoutingDefaults } from "../src/_internal/build/discovery/convention-config.js";
import { createCoreGraph } from "../src/_internal/build/graph/create-core-graph.js";
import { inspectFrameworkBuild } from "../src/_internal/build/operations/inspect.js";
import { validateHtmlTemplates } from "../src/_internal/build/output/framework-output.js";
import { resolveConfig } from "../src/config/index.js";
import { defineSchedule } from "../src/schedule/index.js";

const declaration = `import { defineSchedule as job } from '@evjs/ev/schedule';
export const syncOrders = job({ cron: '0 0/5 * * * ?' }, async () => {});`;
const dirs: string[] = [];
async function fixture(files: Record<string, string>) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-schedules-"));
  dirs.push(cwd);
  for (const [name, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(cwd, name)), { recursive: true });
    await fs.writeFile(path.join(cwd, name), source);
  }
  return cwd;
}
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("schedule declarations", () => {
  it("returns the same handler without executing it", () => {
    let calls = 0;
    const handler = () => ++calls;
    expect(defineSchedule({ cron: "anything" }, handler)).toBe(handler);
    expect(calls).toBe(0);
  });
  it("recognizes import bindings and aliases without evaluating business code", () => {
    const result = analyzeServerSchedules(
      `${declaration}\nthrow Error('must not execute');`,
      "src/orders.ts",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.schedules).toEqual([
      {
        id: "syncOrders",
        exportName: "syncOrders",
        module: "src/orders.ts",
        cron: "0 0/5 * * * ?",
        disable: false,
        line: 2,
        column: 27,
      },
    ]);
  });
  it("preserves source locations across parses and leading comments", () => {
    for (let index = 0; index < 3; index++) {
      const result = analyzeServerSchedules(
        `// 中文注释\n\n${declaration}`,
        "src/orders.ts",
      );
      expect(result.schedules[0]).toMatchObject({ line: 4, column: 27 });
    }
  });

  it("supports an imported handler, explicit identity and disable", () => {
    const result = analyzeServerSchedules(
      `import { resolveConfig } from "../src/config/index.js";
import { withPageRoutingDefaults } from "../src/_internal/build/discovery/convention-config.js";
import { inspectFrameworkBuild } from "../src/_internal/build/operations/inspect.js";
import { validateHtmlTemplates } from "../src/_internal/build/output/framework-output.js";
import { defineSchedule } from '@alipay/evjs'; import { run } from './service';
export const renamed = defineSchedule({ id: 'orders.sync', cron: '0 0 * * * ?', disable: true }, run);`,
      "src/tasks.ts",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.schedules[0]).toMatchObject({
      id: "orders.sync",
      exportName: "renamed",
      disable: true,
    });
  });
  it("ignores local same-name functions, shadowed imports and re-exports", () => {
    for (const source of [
      `const defineSchedule = (a, b) => b; export const foo = defineSchedule({}, () => {});`,
      `import { resolveConfig } from "../src/config/index.js";
import { withPageRoutingDefaults } from "../src/_internal/build/discovery/convention-config.js";
import { inspectFrameworkBuild } from "../src/_internal/build/operations/inspect.js";
import { validateHtmlTemplates } from "../src/_internal/build/output/framework-output.js";
import { defineSchedule } from '@evjs/ev/schedule'; function factory(defineSchedule) { return defineSchedule({}, () => {}); }`,
      `export { syncOrders } from './orders';`,
      `import type { defineSchedule } from '@evjs/ev/schedule';`,
    ])
      expect(analyzeServerSchedules(source, "src/test.ts")).toEqual({
        schedules: [],
        diagnostics: [],
      });
  });
  it.each([
    `export default job({ cron: 'x' }, () => {});`,
    `const hidden = job({ cron: 'x' }, () => {});`,
    `export let foo = job({ cron: 'x' }, () => {});`,
    `export const foo = job(config, () => {});`,
    `export const foo = job({ ...config, cron: 'x' }, () => {});`,
    `export const foo = job({ cron: getCron() }, () => {});`,
    `export const foo = job({ cron: 'x', cron: 'y' }, () => {});`,
    `export const foo = job({ cron: 'x', disable: enabled }, () => {});`,
    `export const foo = job({ cron: 'x', timezone: 'UTC' }, () => {});`,
    `export const foo = job({ cron: 'x' }, (argument) => {});`,
    `export const foo = job({ cron: 'x' }, function* () {});`,
    `export const foo = job({ cron: 'x' }, null);`,
    `const factory = job;`,
  ])("rejects unsupported static declarations: %s", (source) => {
    const result = analyzeServerSchedules(
      `import { defineSchedule as job } from '@evjs/ev/schedule';\n${source}`,
      "src/task.ts",
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]).toMatchObject({
      file: "src/task.ts",
      line: 2,
      level: "error",
    });
  });
});

describe("source-wide task discovery", () => {
  it("discovers unreferenced tasks, excludes tests and tracks new declaration candidates", async () => {
    const cwd = await fixture({
      "src/orders.ts": declaration,
      "src/plain.ts": "export const value = 1;",
      "src/orders.test.ts": declaration,
      "src/generated/task.ts": declaration,
    });
    const first = await createCoreGraph({ server: {} }, cwd);
    expect(first.diagnostics).toEqual([]);
    expect(first.graph.serverSchedules).toHaveLength(1);
    expect(first.fileDependencies).toContain(path.join(cwd, "src/plain.ts"));
    expect(first.fileDependencies).toContain(path.join(cwd, "src"));
    await fs.rename(
      path.join(cwd, "src/orders.ts"),
      path.join(cwd, "src/moved.ts"),
    );
    await fs.writeFile(
      path.join(cwd, "src/plain.ts"),
      declaration.replace("syncOrders", "another"),
    );
    const next = await createCoreGraph({ server: {} }, cwd);
    expect(next.graph.serverSchedules?.map((task) => task.id)).toEqual([
      "another",
      "syncOrders",
    ]);
    expect(
      next.graph.serverSchedules?.find((task) => task.id === "syncOrders")
        ?.module,
    ).toBe("src/moved.ts");
  });
  it("reports both owners of a duplicate ID", async () => {
    const cwd = await fixture({
      "src/a.ts": declaration,
      "src/b.ts": declaration,
    });
    const result = await createCoreGraph({ server: {} }, cwd);
    expect(result.diagnostics[0].message).toMatch(
      /src\/a.ts#syncOrders and src\/b.ts#syncOrders/,
    );
  });
  it("rejects tasks in use-server modules", async () => {
    const cwd = await fixture({
      "src/task.ts": `'use server';\n${declaration}`,
    });
    const result = await createCoreGraph({ server: {} }, cwd);
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('cannot use "use server"'),
      ),
    ).toBe(true);
  });
  it("rejects transitive client imports but allows type-only imports", async () => {
    const cwd = await fixture({
      "src/task.ts": declaration,
      "src/page.tsx": `import './bridge'; export default function Page() { return null; }`,
      "src/bridge.ts": `export { syncOrders } from './task';`,
    });
    const config = {
      routing: {
        mode: "mpa" as const,
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "home",
            path: "/",
            module: "./src/page.tsx",
            scope: { kind: "directory" as const, root: "./src" },
          },
        ],
      },
      server: {},
    };
    const result = await createCoreGraph(config, cwd);
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("cannot import schedule module"),
      ),
    ).toBe(true);
    await fs.writeFile(
      path.join(cwd, "src/bridge.ts"),
      `export type { syncOrders } from './task';`,
    );
    expect((await createCoreGraph(config, cwd)).diagnostics).toEqual([]);
  });
});

it.each([
  "spa",
  "mpa",
] as const)("preserves %s configuration without adding a browser app to a task-only graph", async (mode) => {
  const cwd = await fixture({ "src/orders.ts": declaration });
  const input = { routing: { mode } };
  const config = await withPageRoutingDefaults(
    resolveConfig(input),
    input,
    cwd,
  );
  expect(config.routing?.mode).toBe(mode);
  expect(() => validateHtmlTemplates(cwd, config)).not.toThrow();
  const analysis = await createCoreGraph(config, cwd);
  expect(analysis.diagnostics).toEqual([]);
  expect(analysis.graph.applications).toEqual({});
  expect(analysis.graph.serverSchedules).toHaveLength(1);
  const report = await inspectFrameworkBuild(input, { cwd });
  expect(report.diagnostics).toEqual([]);
});
