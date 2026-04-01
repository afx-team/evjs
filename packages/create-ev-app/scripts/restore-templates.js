/**
 * Restore symlinked templates after npm publishing.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(__dirname, "../templates");

const symlinkTargets = {
  "basic-csr": "../../../examples/basic-csr",
  "basic-server-fns": "../../../examples/basic-server-fns",
  "configured-server-fns": "../../../examples/configured-server-fns",
  "complex-routing": "../../../examples/complex-routing",
  "with-tailwind": "../../../examples/with-tailwind",
};

for (const [name, target] of Object.entries(symlinkTargets)) {
  const entryPath = path.join(templatesDir, name);
  const stat = fs.lstatSync(entryPath, { throwIfNoEntry: false });

  if (stat && !stat.isSymbolicLink()) {
    fs.rmSync(entryPath, { recursive: true, force: true });
    fs.symlinkSync(target, entryPath);
  }
}
