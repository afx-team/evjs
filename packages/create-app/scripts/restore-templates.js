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
  "basic-fns-ecma": "../../../examples/basic-fns-ecma",
  "basic-plugins": "../../../examples/basic-plugins",
  "basic-server-fns": "../../../examples/basic-server-fns",
  "basic-server-routes": "../../../examples/basic-server-routes",
  "configured-server-fns": "../../../examples/configured-server-fns",
  "complex-routing": "../../../examples/complex-routing",
  "server-fns-query": "../../../examples/server-fns-query",
  "sqlite-server-fns": "../../../examples/sqlite-server-fns",
  "trpc-server-fns": "../../../examples/trpc-server-fns",
  "websocket-fns": "../../../examples/websocket-fns",
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
