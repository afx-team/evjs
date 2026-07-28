import path from "node:path";
import type { BuildResult, PluginHooks } from "../../plugin/index.js";
import type { BundlerEmittedFiles } from "./bundler.js";
import { assertBundlerEmittedFiles } from "./bundler-output-files.js";
import {
  assertPortableArtifactFileName,
  canonicalPortableArtifactPathKey,
  portableArtifactPathsConflict,
} from "./portable-artifact-path.js";

export interface DeploymentOutputReservation {
  cwd: string;
  outputDir: string;
  field: string;
  fileName: string;
}

type BuildEndHook = NonNullable<PluginHooks["buildEnd"]>;
type DeploymentOutputResolver = (
  result: BuildResult,
) => DeploymentOutputReservation[];

interface ResolvedOutputReservation {
  field: string;
  fileName: string;
  key: string;
}

const reservationResolvers = new WeakMap<
  BuildEndHook,
  DeploymentOutputResolver
>();

/**
 * Declare the physical files written by a deployment buildEnd hook. The build
 * lifecycle resolves every declaration before running any hook so two adapters
 * cannot overwrite one another after case or Unicode normalization aliases.
 */
export function declareDeploymentOutputReservations(
  resolve: DeploymentOutputResolver,
  buildEnd: BuildEndHook,
): BuildEndHook {
  reservationResolvers.set(buildEnd, resolve);
  return buildEnd;
}

/** Preflight all declared deployment outputs before any buildEnd hook writes. */
export function assertBuildEndDeploymentOutputsAvailable<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  result: BuildResult,
  options: { cwd?: string; emittedFiles?: BundlerEmittedFiles } = {},
): void {
  const reservations = hooks.flatMap((hooks) => {
    if (!hooks.buildEnd) return [];
    const resolve = reservationResolvers.get(hooks.buildEnd);
    return resolve ? resolve(structuredClone(result)) : [];
  });
  const outputs = new Map<string, ResolvedOutputReservation>();

  assertBundlerEmittedFiles(options.emittedFiles);
  if (options.cwd) {
    reserveBundlerOutputs(outputs, options.cwd, result, options.emittedFiles);
  }

  for (const reservation of reservations) {
    const fileName = assertPortableArtifactFileName(
      reservation.fileName,
      reservation.field,
    );
    const key = canonicalPhysicalPathKey(
      path.resolve(reservation.cwd, reservation.outputDir, fileName),
    );
    reservePhysicalOutput(outputs, { field: reservation.field, fileName, key });
  }
}

function reserveBundlerOutputs(
  outputs: Map<string, ResolvedOutputReservation>,
  cwd: string,
  result: BuildResult,
  emittedFiles: BundlerEmittedFiles | undefined,
): void {
  const outputGroups = [
    {
      directory: result.output.paths.publicDir,
      files: emittedFiles?.client,
      side: "client",
    },
    {
      directory: result.output.paths.serverDir,
      files: emittedFiles?.server,
      side: "server",
    },
  ] as const;

  for (const group of outputGroups) {
    for (const fileName of group.files ?? []) {
      const reservation = {
        field: `bundler-emitted ${group.side} asset`,
        fileName,
        key: canonicalPhysicalPathKey(
          path.resolve(cwd, group.directory, fileName),
        ),
      };
      outputs.set(reservation.key, reservation);
    }
  }
}

function reservePhysicalOutput(
  outputs: Map<string, ResolvedOutputReservation>,
  reservation: ResolvedOutputReservation,
): void {
  const conflict = [...outputs.entries()].find(([existingKey]) =>
    portableArtifactPathsConflict(existingKey, reservation.key),
  );
  if (conflict) {
    const [conflictKey, conflictReservation] = conflict;
    const reason =
      conflictKey === reservation.key
        ? "both resolve to the same physical deployment output"
        : "their physical deployment outputs overlap as a file and directory";
    throw new Error(
      `[evjs] ${reservation.field} "${reservation.fileName}" conflicts with ${conflictReservation.field} "${conflictReservation.fileName}"; ${reason}.`,
    );
  }
  outputs.set(reservation.key, reservation);
}

function canonicalPhysicalPathKey(value: string): string {
  return canonicalPortableArtifactPathKey(value.split(path.sep).join("/"));
}
