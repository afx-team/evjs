import type { BuildOutput } from "@evjs/shared/manifest";
import { createDeploymentMetadata } from "@evjs/shared/manifest";
import type { BuildResult } from "../../plugin/index.js";
import type { FrameworkRuntimeOutput } from "./framework-runtime.js";

export function createBuildResult(
  output: BuildOutput,
  isRebuild: boolean,
  options: { frameworkRuntime?: FrameworkRuntimeOutput } = {},
): BuildResult {
  return {
    output,
    ...(options.frameworkRuntime
      ? { frameworkRuntime: options.frameworkRuntime }
      : {}),
    deploymentMetadata: createDeploymentMetadata(output),
    isRebuild,
  };
}
