import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const excluded = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "test",
  "tests",
  "__tests__",
  "__mocks__",
  "__generated__",
  "generated",
]);

/** All source files participate: a task does not need an incoming import. */
export async function discoverScheduleSources(
  cwd: string,
  beforeRead?: (file: string) => void,
): Promise<{ files: string[]; directories: string[] }> {
  const files: string[] = [];
  const directories: string[] = [];
  async function visit(directory: string): Promise<void> {
    directories.push(directory);
    beforeRead?.(directory);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || excluded.has(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (
        entry.isFile() &&
        /\.[jt]sx?$/.test(entry.name) &&
        !/(?:\.d|\.test|\.spec)\.[jt]sx?$/.test(entry.name)
      )
        files.push(file);
    }
  }
  await visit(path.join(cwd, "src"));
  return { files: files.sort(), directories: directories.sort() };
}
