import { mkdtemp, readFile, rm } from "node:fs/promises";
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
          scope: { kind: "application" },
          source: "export async function invoke(input) { return input; }",
        });
        name = ctx.emit.serverEntry({ id: "entry", module });
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
        ctx.emit.serverEntry({ id: "c", module: "./handler.ts" });
      },
    });
    const right = definePlugin({
      id: "a",
      emitIR(ctx) {
        ctx.emit.serverEntry({ id: "b-c", module: "./handler.ts" });
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
