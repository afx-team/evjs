/**
 * Keep project-relative inputs anchored to the application while allowing
 * Utoopack to discover the enclosing workspace root for hoisted dependencies.
 */
import type { ConfigComplete } from "@utoo/pack";

type UtoopackBuildRuntime = Pick<typeof import("@utoo/pack"), "build">;
type UtoopackDevRuntime = Pick<typeof import("@utoo/pack"), "serve">;
type UtoopackServerOptions = NonNullable<
  Parameters<UtoopackDevRuntime["serve"]>[3]
>;

export function runUtoopackBuild(
  runtime: UtoopackBuildRuntime,
  config: ConfigComplete,
  projectPath: string,
): Promise<void> {
  return runtime.build({ config }, projectPath);
}

export function runUtoopackDevServer(
  runtime: UtoopackDevRuntime,
  config: ConfigComplete,
  projectPath: string,
  serverOptions: UtoopackServerOptions,
): Promise<void> {
  return runtime.serve({ config }, projectPath, undefined, serverOptions);
}
