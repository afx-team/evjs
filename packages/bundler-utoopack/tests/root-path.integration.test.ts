import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const harness = fileURLToPath(
  new URL("./fixtures/root-path-build.mjs", import.meta.url),
);

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("linked dependency build scope", () => {
  it("builds the same linked dependency only after its parent root is explicitly included", () => {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "evjs-linked-build-")),
    );
    roots.push(root);
    const cwd = path.join(root, "app");
    const modules = path.join(root, "shared/node_modules");
    const dependency = path.join(modules, "linked-dependency");
    fs.mkdirSync(cwd);
    fs.mkdirSync(dependency, { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      '{"name":"linked-app","private":true}',
    );
    fs.writeFileSync(
      path.join(cwd, "package-lock.json"),
      '{"lockfileVersion":3,"packages":{}}',
    );
    fs.writeFileSync(
      path.join(dependency, "package.json"),
      '{"name":"linked-dependency","main":"index.js"}',
    );
    fs.writeFileSync(
      path.join(dependency, "index.js"),
      'module.exports = "evjs-linked-root-ok";',
    );
    fs.writeFileSync(
      path.join(cwd, "index.js"),
      'console.log(require("linked-dependency"));',
    );
    fs.symlinkSync(modules, path.join(cwd, "node_modules"), "junction");

    const implicit = spawnSync(process.execPath, [harness, cwd], {
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(implicit.status).toBe(1);
    expect(implicit.stderr).toContain(
      "Symlink node_modules could not be resolved",
    );

    const explicit = spawnSync(process.execPath, [harness, cwd, ".."], {
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(explicit.stderr).not.toContain("could not be resolved");
    expect(explicit.status).toBe(0);
    const chunks = fs
      .readdirSync(path.join(cwd, "dist"))
      .filter((file) => file.endsWith(".js"));
    expect(
      chunks
        .map((file) => fs.readFileSync(path.join(cwd, "dist", file), "utf8"))
        .join("\n"),
    ).toContain("evjs-linked-root-ok");
    expect(fs.existsSync(path.join(root, "dist"))).toBe(false);
  }, 30_000);
});
