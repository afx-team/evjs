/**
 * Replace symlinked templates with real copies for npm publishing.
 * npm pack does not follow symlinks, so we need to dereference them.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(__dirname, "../templates");

for (const entry of fs.readdirSync(templatesDir)) {
  const entryPath = path.join(templatesDir, entry);
  const stat = fs.lstatSync(entryPath);

  if (stat.isSymbolicLink()) {
    const realPath = fs.realpathSync(entryPath);

    // Remove symlink
    fs.removeSync(entryPath);

    // Copy real contents, excluding build artifacts
    fs.copySync(realPath, entryPath, {
      filter: (src) => {
        const basename = path.basename(src);
        return !["node_modules", "dist", ".turbo"].includes(basename);
      },
    });
  }
}
