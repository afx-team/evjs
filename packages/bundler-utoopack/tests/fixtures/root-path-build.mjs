import { createRequire } from "node:module";
import { resolveUtoopackRootPath } from "../../esm/adapter/config/root-path.js";
import { runUtoopackBuild } from "../../esm/adapter/execution/utoopack.js";

const require = createRequire(import.meta.url);
const [cwd, root] = process.argv.slice(2);
const config = {
  mode: "production",
  entry: [{ import: "./index.js", name: "main" }],
  output: { path: "./dist", filename: "[name].js", clean: true },
  persistentCaching: false,
};

try {
  await runUtoopackBuild(
    require("@utoo/pack"),
    config,
    cwd,
    resolveUtoopackRootPath(root, cwd),
  );
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
