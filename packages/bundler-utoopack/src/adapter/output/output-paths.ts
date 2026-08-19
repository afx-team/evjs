import path from "node:path";
import {
  assertSafeBundlerCleanOutputPath,
  type ResolvedBuildOutputPaths,
} from "@evjs/ev/_internal/build";
import type { ConfigComplete } from "@utoo/pack";

export function assertUtoopackOutputPathsMatchPlan(
  cwd: string,
  config: ConfigComplete,
  outputPaths: ResolvedBuildOutputPaths,
  options: { requireServerOutput: boolean },
): void {
  assertOutputPathMatchesPlan(
    cwd,
    "Utoopack output.path",
    config.output?.path,
    "output.client",
    outputPaths.clientDir,
  );

  if (options.requireServerOutput || config.server) {
    assertOutputPathMatchesPlan(
      cwd,
      "Utoopack server.output.path",
      config.server?.output?.path,
      "output.server",
      outputPaths.serverDir,
    );
  }
}

export async function assertSafeUtoopackCleanOutput(
  cwd: string,
  config: ConfigComplete,
  outputPaths: ResolvedBuildOutputPaths,
): Promise<void> {
  const output = config.output;
  if (!output?.clean) return;
  if (!output.path) {
    throw new Error(
      "[evjs] Utoopack enables recursive output cleaning without an explicit output.path.",
    );
  }
  await assertSafeBundlerCleanOutputPath(
    cwd,
    "output.client",
    outputPaths.rootDir,
    output.path,
  );
}

function formatProjectRelativePath(cwd: string, outputPath: string): string {
  const relative = path.relative(path.resolve(cwd), path.resolve(outputPath));
  if (path.isAbsolute(relative)) return "<outside-project>";
  return (relative || ".").split(path.sep).join("/");
}

function assertOutputPathMatchesPlan(
  cwd: string,
  bundlerField: string,
  actualPath: string | undefined,
  planField: string,
  expectedPath: string,
): void {
  if (actualPath === expectedPath) return;

  throw new Error(
    `[evjs] ${bundlerField} "${actualPath ? formatProjectRelativePath(cwd, actualPath) : "<missing>"}" must remain the exact absolute BuildPlan ${planField} directory "${formatProjectRelativePath(cwd, expectedPath)}". Framework-owned output paths cannot be overridden by configureBundler hooks.`,
  );
}
