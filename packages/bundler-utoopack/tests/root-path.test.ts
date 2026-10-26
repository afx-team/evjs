import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveUtoopackRootPath } from "../src/adapter/config/root-path.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "evjs-root-")),
  );
  directories.push(root);
  const cwd = path.join(root, "app");
  fs.mkdirSync(cwd);
  return { root, cwd };
}

describe("explicit Utoopack filesystem roots", () => {
  it("preserves implicit discovery without touching the filesystem", () => {
    expect(
      resolveUtoopackRootPath(undefined, "/not-created/app"),
    ).toBeUndefined();
  });

  it("resolves relative and absolute roots from the application", () => {
    const { root, cwd } = fixture();
    expect(resolveUtoopackRootPath("..", cwd)).toBe(root);
    expect(resolveUtoopackRootPath(root, cwd)).toBe(root);
    expect(resolveUtoopackRootPath(".", cwd)).toBe(cwd);
  });

  it("rejects roots which do not contain the application", () => {
    const { root, cwd } = fixture();
    fs.mkdirSync(path.join(root, "other"));
    expect(() => resolveUtoopackRootPath("../other", cwd)).toThrow(
      "must contain the application",
    );
  });

  it("checks real paths instead of trusting a symlink inside the root", () => {
    const { root, cwd } = fixture();
    const outside = fixture();
    const link = path.join(root, "linked-app");
    fs.symlinkSync(outside.cwd, link, "junction");
    expect(() => resolveUtoopackRootPath(root, link)).toThrow(
      "must contain the application",
    );
    expect(resolveUtoopackRootPath(outside.root, link)).toBe(outside.root);
    expect(fs.statSync(cwd).isDirectory()).toBe(true);
  });

  it("rejects missing roots, files, and filesystem-wide roots", () => {
    const { root, cwd } = fixture();
    fs.writeFileSync(path.join(root, "file"), "data");
    expect(() => resolveUtoopackRootPath("../missing", cwd)).toThrow(
      "existing directory",
    );
    expect(() => resolveUtoopackRootPath("../file", cwd)).toThrow(
      "existing directory",
    );
    expect(() => resolveUtoopackRootPath(path.parse(root).root, cwd)).toThrow(
      "filesystem root",
    );
  });
});
