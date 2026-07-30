/**
 * Replace symlinked templates with real copies for npm publishing.
 * npm pack does not follow symlinks, so we need to dereference them.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(__dirname, "../templates");
const templateCopyExcludedBasenames = new Set([
  "node_modules",
  "dist",
  ".turbo",
  ".turbopack",
  ".ev",
  ".evjs",
  "route-types.d.ts",
  "plugin-types.d.ts",
]);

const generatedFrameworkTypeFiles = ["route-types.d.ts", "plugin-types.d.ts"];

export function shouldDerefTemplatePath(src) {
  return !src
    .split(/[\\/]+/)
    .some((segment) => templateCopyExcludedBasenames.has(segment));
}

export function withGeneratedFrameworkIgnores(source) {
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const ignoredPaths = new Set(source.split(/\r?\n/));
  const missing = generatedFrameworkTypeFiles.filter(
    (file) => !ignoredPaths.has(file),
  );
  if (missing.length === 0) return source;

  const separator =
    source.length === 0 || /\r?\n$/.test(source) ? "" : lineEnding;
  return `${source}${separator}${missing.join(lineEnding)}${lineEnding}`;
}

function dereferenceTemplates() {
  for (const entry of fs.readdirSync(templatesDir)) {
    const entryPath = path.join(templatesDir, entry);
    const stat = fs.lstatSync(entryPath);

    if (stat.isSymbolicLink()) {
      const realPath = fs.realpathSync(entryPath);

      fs.rmSync(entryPath, { recursive: true, force: true });
      fs.cpSync(realPath, entryPath, {
        recursive: true,
        filter: shouldDerefTemplatePath,
      });
      const gitignorePath = path.join(entryPath, ".gitignore");
      if (fs.existsSync(gitignorePath)) {
        const gitignore = fs.readFileSync(gitignorePath, "utf-8");
        fs.writeFileSync(
          gitignorePath,
          withGeneratedFrameworkIgnores(gitignore),
        );
      }
    }
  }
}

function isDirectExecution() {
  const invokedPath = process.argv[1];
  if (!invokedPath) return false;
  return path.resolve(invokedPath) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  dereferenceTemplates();
}
