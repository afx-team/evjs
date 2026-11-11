import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ClientModuleReference } from "@evjs/shared/manifest";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeClientModuleReference } from "../src/_internal/build/generated-ir/module-references.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const cwd = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "ev-module-reference-")),
  );
  roots.push(cwd);
  await fs.mkdir(path.join(cwd, "src"));
  await fs.writeFile(
    path.join(cwd, "src/greeting.ts"),
    'throw new Error("must not execute during planning");',
  );
  const input: ClientModuleReference & { id: string } = {
    id: "greeting-module",
    resource: "./src/greeting.ts",
    references: [
      {
        id: "greeting",
        factory: { module: "./src/runtime.ts", export: "createReference" },
        data: { endpoint: "/greetings" },
      },
    ],
    exports: [
      { name: "Greeting", reference: "greeting" },
      { name: "default", reference: "greeting" },
    ],
  };
  return { cwd, input };
}

describe("client module reference normalization", () => {
  it("anchors source and runtime paths without evaluating source; snapshots opaque data and export aliases", async () => {
    const { cwd, input } = await fixture();
    const plan = normalizeClientModuleReference(
      cwd,
      "reference-fixture",
      input,
    );
    expect(plan.resource).toBe(path.join(cwd, "src/greeting.ts"));
    expect(plan.references[0].factory.module).toBe(
      path.join(cwd, "src/runtime.ts"),
    );
    expect(plan.exports).toEqual(input.exports);
    input.references[0].data = { endpoint: "/changed" };
    input.exports[0].name = "Changed";
    expect(plan.references[0].data).toEqual({ endpoint: "/greetings" });
    expect(plan.exports[0].name).toBe("Greeting");
  });

  it("resolves source symlinks to the same canonical resource", async () => {
    const { cwd, input } = await fixture();
    await fs.symlink("greeting.ts", path.join(cwd, "src/alias.ts"));
    const original = normalizeClientModuleReference(cwd, "fixture", input);
    input.resource = "src/alias.ts";
    expect(normalizeClientModuleReference(cwd, "fixture", input).resource).toBe(
      original.resource,
    );
  });

  it("rejects a symlink that escapes the application", async () => {
    const { cwd, input } = await fixture();
    const other = await fixture();
    await fs.symlink(
      path.join(other.cwd, "src/greeting.ts"),
      path.join(cwd, "src/outside.ts"),
    );
    input.resource = "src/outside.ts";
    expect(() => normalizeClientModuleReference(cwd, "fixture", input)).toThrow(
      "inside the application root",
    );
  });

  it("reports malformed reference and export records during planning", async () => {
    const { cwd, input } = await fixture();
    const nullReference = JSON.parse(JSON.stringify(input));
    nullReference.references = [null];
    expect(() =>
      normalizeClientModuleReference(cwd, "fixture", nullReference),
    ).toThrow("requires reference objects");
    const nullExport = JSON.parse(JSON.stringify(input));
    nullExport.exports = [null];
    expect(() =>
      normalizeClientModuleReference(cwd, "fixture", nullExport),
    ).toThrow("requires export objects");
  });

  it.each([
    [
      "duplicate reference",
      (input: ClientModuleReference) =>
        input.references.push(input.references[0]),
      "duplicate reference",
    ],
    [
      "duplicate export",
      (input: ClientModuleReference) => input.exports.push(input.exports[0]),
      "duplicate export",
    ],
    [
      "unknown reference",
      (input: ClientModuleReference) => {
        input.exports[0].reference = "missing";
      },
      "unknown reference",
    ],
    [
      "invalid factory",
      (input: ClientModuleReference) => {
        input.references[0].factory.export = "not an identifier";
      },
      "factory export",
    ],
    [
      "non-JSON data",
      (input: ClientModuleReference) => {
        input.references[0].data = Number.NaN;
      },
      "finite numbers",
    ],
  ] as const)("rejects %s", async (_name, mutate, message) => {
    const { cwd, input } = await fixture();
    mutate(input);
    expect(() => normalizeClientModuleReference(cwd, "fixture", input)).toThrow(
      message,
    );
  });
});
