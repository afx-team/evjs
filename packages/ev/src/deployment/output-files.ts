import path from "node:path";
import { writeOwnedOutputFile } from "../_internal/build/output/owned-file-output.js";
import {
  assertPortableArtifactFileName,
  assertPortableRelativeArtifactPath,
  canonicalPortableArtifactPathKey,
  portableArtifactPathsConflict,
} from "../_internal/build/output/portable-artifact-path.js";

export interface NamedDeploymentFile {
  field: string;
  fileName: string;
}

export interface ReservedFrameworkArtifact {
  owner: string;
  fileName: string;
}

/** Validate adapter-owned leaf files without accepting paths or aliases. */
export function resolveDeploymentFileName(
  value: unknown,
  fallback: string,
  field: string,
): string {
  const fileName = value ?? fallback;
  return assertPortableArtifactFileName(fileName, field);
}

/** Reject names that can overwrite one another on common file systems. */
export function assertDistinctDeploymentFileNames(
  left: { field: string; fileName: string },
  right: { field: string; fileName: string } | undefined,
): void {
  if (!right) return;
  if (canonicalFileName(left.fileName) === canonicalFileName(right.fileName)) {
    throw new Error(
      `[evjs] ${left.field} and ${right.field} must name different deployment files.`,
    );
  }
}

/** Reject adapter files that would overwrite framework-owned output. */
export function assertDeploymentFileNamesAvailable(
  files: NamedDeploymentFile[],
  reserved: ReservedFrameworkArtifact[],
): void {
  const reservedByKey = new Map<string, ReservedFrameworkArtifact>();
  for (const artifact of reserved) {
    assertPortableRelativeArtifactPath(
      artifact.fileName,
      `${artifact.owner} output "${artifact.fileName}"`,
    );
    reservedByKey.set(
      canonicalPortableArtifactPathKey(artifact.fileName),
      artifact,
    );
  }

  for (const file of files) {
    const fileKey = canonicalPortableArtifactPathKey(file.fileName);
    const conflict = [...reservedByKey.entries()].find(([reservedKey]) =>
      portableArtifactPathsConflict(reservedKey, fileKey),
    )?.[1];
    if (!conflict) continue;
    throw new Error(
      `[evjs] ${file.field} "${file.fileName}" conflicts with framework-owned ${conflict.owner} output "${conflict.fileName}".`,
    );
  }
}

/** Write one adapter file atomically without following an existing leaf symlink. */
export async function writeDeploymentFile(
  projectRoot: string,
  outputDir: string,
  fileName: string,
  contents: string,
): Promise<void> {
  const absoluteOutputDir = path.resolve(outputDir);
  const destination = path.resolve(absoluteOutputDir, fileName);
  if (path.dirname(destination) !== absoluteOutputDir) {
    throw new Error(
      `[evjs] Deployment file "${fileName}" must stay directly inside its owned output directory.`,
    );
  }
  await writeOwnedOutputFile(
    projectRoot,
    destination,
    contents,
    `Deployment file "${fileName}"`,
  );
}

function canonicalFileName(fileName: string): string {
  return canonicalPortableArtifactPathKey(fileName);
}
