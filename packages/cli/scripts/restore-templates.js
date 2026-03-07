/**
 * Restore symlinked templates after npm publishing.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(__dirname, "../templates");

const symlinkTargets = {
  "basic-csr": "../../../examples/basic-csr",
  "basic-server-fns": "../../../examples/basic-server-fns",
  "trpc-server-fns": "../../../examples/trpc-server-fns",
};

for (const [name, target] of Object.entries(symlinkTargets)) {
  const entryPath = path.join(templatesDir, name);
  const stat = fs.lstatSync(entryPath, { throwIfNoEntry: false });

  if (stat && !stat.isSymbolicLink()) {
    fs.removeSync(entryPath);
    fs.symlinkSync(target, entryPath);
  }
}
