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
const packagedTemplateGitignore = "_gitignore";

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

export function preparePackagedTemplateGitignore(templateDir) {
  const gitignorePath = path.join(templateDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return;

  const source = withGeneratedFrameworkIgnores(
    fs.readFileSync(gitignorePath, "utf-8"),
  );
  fs.writeFileSync(path.join(templateDir, packagedTemplateGitignore), source);
  // Preserve template-specific npm exclusions while keeping the portable
  // `_gitignore` copy in the published package.
  fs.writeFileSync(path.join(templateDir, ".npmignore"), source);
  fs.rmSync(gitignorePath);
}

export function dereferenceTemplates(templatesRoot = templatesDir) {
  for (const entry of fs.readdirSync(templatesRoot)) {
    const entryPath = path.join(templatesRoot, entry);
    const stat = fs.lstatSync(entryPath);

    if (stat.isSymbolicLink()) {
      const realPath = fs.realpathSync(entryPath);

      fs.rmSync(entryPath, { recursive: true, force: true });
      fs.cpSync(realPath, entryPath, {
        recursive: true,
        filter: shouldDerefTemplatePath,
      });
      preparePackagedTemplateGitignore(entryPath);
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
