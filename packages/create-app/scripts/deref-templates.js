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
  "evjs-env.d.ts",
]);

export function shouldDerefTemplatePath(src) {
  return !src
    .split(/[\\/]+/)
    .some((segment) => templateCopyExcludedBasenames.has(segment));
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
