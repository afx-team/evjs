import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareFrameworkBuild } from "../src/_internal/build/commands.js";
import { definePlugin } from "../src/plugin/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), "evjs-plugin-entry-"));
  roots.push(root);
  return root;
}

describe("plugin server build roots", () => {
  it("materializes an independent server entry without inventing HTTP routes", async () => {
    const cwd = await project();
    let name = "";
    const protocol = definePlugin({
      id: "protocol",
      emitIR(ctx) {
        const module = ctx.emit.module({
          id: "implementation",
          scope: { kind: "server" },
          source: "export async function invoke(input) { return input; }",
        });
        name = ctx
          .slot("server.entry")
          .add({ id: "entry", mode: "create", module });
      },
    });
    const prepared = await prepareFrameworkBuild(
      { conventions: false, plugins: [protocol()] },
      { cwd },
    );
    await prepared.dispose();
    const { plan } = JSON.parse(
      await readFile(path.join(cwd, ".ev/framework/build-plan.json"), "utf8"),
    );
    expect(name).toBe("plugin-protocol-entry");
    expect(plan.entries).toEqual([
      expect.objectContaining({
        name,
        environment: "server",
        kind: "runtime",
        runtime: "node",
      }),
    ]);
    expect(plan.server.entry).toBeUndefined();
    expect(plan.generated.slots).toContainEqual({
      key: "protocol:entry",
      id: "entry",
      pluginId: "protocol",
      slot: "server.entry",
      mode: "create",
      entryName: name,
      module: plan.entries[0].import,
    });
    expect(plan.generated.importEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "protocol:entry",
          to: "protocol:implementation",
          kind: "slot-module",
        }),
      ]),
    );
    const { graph } = JSON.parse(
      await readFile(path.join(cwd, ".ev/framework/core-graph.json"), "utf8"),
    );
    expect(Object.keys(graph.serverRoutes)).toEqual([]);
    const source = await readFile(
      path.resolve(cwd, plan.entries[0].import),
      "utf8",
    );
    expect(source).toContain("export async function invoke");
  });

  it("diagnoses collisions after plugin entry name normalization", async () => {
    const cwd = await project();
    const left = definePlugin({
      id: "a-b",
      emitIR(ctx) {
        ctx
          .slot("server.entry")
          .add({ id: "c", mode: "create", module: "./handler.ts" });
      },
    });
    const right = definePlugin({
      id: "a",
      emitIR(ctx) {
        ctx
          .slot("server.entry")
          .add({ id: "b-c", mode: "create", module: "./handler.ts" });
      },
    });
    await expect(
      prepareFrameworkBuild(
        { conventions: false, plugins: [left(), right()] },
        { cwd },
      ),
    ).rejects.toThrow("duplicate build entry name");
  });
});

describe("server.entry create mode", () => {
  it.each([
    { target: { kind: "page", pageId: "home" } },
    { position: "before-main" },
  ])("rejects page-only options %j", async (extra) => {
    const cwd = await project();
    const plugin = definePlugin({
      id: "invalid-create",
      emitIR(ctx) {
        ctx.slot("server.entry").add({
          id: "entry",
          mode: "create",
          module: "./handler.ts",
          ...extra,
        } as never);
      },
    });
    await expect(
      prepareFrameworkBuild(
        { conventions: false, plugins: [plugin()] },
        { cwd },
      ),
    ).rejects.toThrow(
      'server.entry mode "create" cannot declare target or position',
    );
  });

  it("does not infer creation from an omitted page target", async () => {
    const cwd = await project();
    const plugin = definePlugin({
      id: "missing-target",
      emitIR(ctx) {
        ctx.slot("server.entry").add({
          id: "entry",
          module: "./handler.ts",
          position: "before-main",
        } as never);
      },
    });
    await expect(
      prepareFrameworkBuild(
        { conventions: false, plugins: [plugin()] },
        { cwd },
      ),
    ).rejects.toThrow("server.entry target");
  });

  it("keeps independent entries separate from Page imports and replacements", async () => {
    const cwd = await project();
    await writeFile(
      path.join(cwd, "index.html"),
      '<html><head></head><body><div id="app"></div></body></html>',
    );
    await mkdir(path.join(cwd, "src/pages/home"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/home/page.tsx"),
      "export default function Page() { return null; }",
    );
    await writeFile(
      path.join(cwd, "src/pages/home/page.config.ts"),
      'export default { render: "ssr" };',
    );
    let serviceName = "";
    const plugin = definePlugin({
      id: "mixed",
      emitIR(ctx) {
        const service = ctx.emit.module({
          id: "service",
          scope: { kind: "server" },
          source: "export async function invoke() { return 42; }",
        });
        serviceName = ctx
          .slot("server.entry")
          .add({ id: "service-entry", module: service, mode: "create" });
        const before = ctx.emit.module({
          id: "before",
          scope: { kind: "page", pageId: "home" },
          source: "export {};",
        });
        expect(
          ctx.slot("server.entry").add({
            id: "before-entry",
            module: before,
            target: { kind: "page", pageId: "home" },
            position: "before-main",
          }),
        ).toBeUndefined();
        const page = ctx.emit.module({
          id: "renderer",
          scope: { kind: "page", pageId: "home" },
          source: "export default function render() {}",
        });
        expect(
          ctx.slot("server.entry").add({
            id: "renderer-entry",
            module: page,
            target: { kind: "page", pageId: "home" },
            mode: "replace",
          }),
        ).toBeUndefined();
      },
    });
    const prepared = await prepareFrameworkBuild(
      { routing: { mode: "mpa" }, plugins: [plugin()] },
      { cwd },
    );
    await prepared.dispose();
    const { plan } = JSON.parse(
      await readFile(path.join(cwd, ".ev/framework/build-plan.json"), "utf8"),
    );
    const serviceEntry = plan.entries.find(
      (entry: { name: string }) => entry.name === serviceName,
    );
    const pageEntry = plan.entries.find(
      (entry: { kind: string }) => entry.kind === "page-server",
    );
    const pageSource = await readFile(
      path.resolve(cwd, pageEntry.import),
      "utf8",
    );
    expect(pageSource).toContain("mixed/before");
    expect(pageSource).toContain("mixed/renderer");
    expect(pageSource).not.toContain("mixed/service");
    const serviceSource = await readFile(
      path.resolve(cwd, serviceEntry.import),
      "utf8",
    );
    expect(serviceSource).toContain("export async function invoke");
    expect(serviceSource).not.toContain("renderer");
  });
});
