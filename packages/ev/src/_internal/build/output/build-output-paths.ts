import path from "node:path";
import type { BuildPlan } from "@evjs/shared/manifest";
import type { ResolvedBuildOutputPaths } from "./output-path-safety.js";

/** Resolve the output directories owned by the active BuildPlan. */
export function resolveBuildOutputPaths(
  cwd: string,
  plan: Pick<BuildPlan, "distDir" | "output">,
): ResolvedBuildOutputPaths {
  return {
    rootDir: path.resolve(cwd, plan.distDir),
    clientDir: path.resolve(cwd, plan.output.clientDir),
    serverDir: path.resolve(cwd, plan.output.serverDir),
  };
}
