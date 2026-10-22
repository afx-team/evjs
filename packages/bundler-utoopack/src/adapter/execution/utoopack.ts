/**
 * Keep project-relative inputs anchored to the application while allowing
 * Utoopack to discover the enclosing workspace root for hoisted dependencies.
 */
import type { ConfigComplete } from "@utoo/pack";

type UtoopackBuildRuntime = Pick<typeof import("@utoo/pack"), "build">;
// This bridge uses the void-returning serve overload; Session teardown is
// owned by the native-owner Worker rather than the optional dev server handle.
type UtoopackDevRuntime = {
  serve(
    ...args: Parameters<typeof import("@utoo/pack")["serve"]>
  ): Promise<void>;
};
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
