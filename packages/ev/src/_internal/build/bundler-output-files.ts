import type { BuildPlan } from "@evjs/shared/manifest";
import type { BundlerEmittedFiles } from "./bundler.js";
import {
  assertPortableRelativeArtifactPath,
  assertPortableRelativeBrowserArtifactPath,
  canonicalPortableArtifactPathKey,
  portableArtifactPathsConflict,
} from "./portable-artifact-path.js";

interface PortableOutputFile {
  fileName: string;
  key: string;
}

/** Validate an optional complete inventory reported by a bundler adapter. */
export function assertBundlerEmittedFiles(
  emittedFiles: BundlerEmittedFiles | undefined,
): void {
  if (emittedFiles === undefined) return;
  if (
    !emittedFiles ||
    typeof emittedFiles !== "object" ||
    Array.isArray(emittedFiles)
  ) {
    throw new Error("[evjs] Bundler emittedFiles must be an object.");
  }
  assertBundlerOutputFileList(emittedFiles.client, "client");
  assertBundlerOutputFileList(emittedFiles.server, "server");
}

/** Reject framework HTML files that would overwrite a reported bundler asset. */
export function assertFrameworkHtmlOutputsAvailable(
  plan: Pick<BuildPlan, "html">,
  emittedFiles: BundlerEmittedFiles | undefined,
): void {
  assertBundlerEmittedFiles(emittedFiles);
  if (!emittedFiles?.client) return;

  for (const document of plan.html) {
    for (const fileName of [document.fileName, ...(document.aliases ?? [])]) {
      assertPortableRelativeArtifactPath(
        fileName,
        `HTML Document "${document.id}" output "${fileName}"`,
      );
      const conflict = emittedFiles.client.find((bundledFile) =>
        portableArtifactPathsConflict(bundledFile, fileName),
      );
      if (!conflict) continue;
      throw new Error(
        `[evjs] HTML Document "${document.id}" output "${fileName}" conflicts with bundler-emitted client asset "${conflict}". Framework HTML and bundler assets must use separate physical paths.`,
      );
    }
  }
}

function assertBundlerOutputFileList(
  files: readonly string[] | undefined,
  side: "client" | "server",
): void {
  if (files === undefined) return;
  if (!Array.isArray(files)) {
    throw new Error(`[evjs] Bundler emittedFiles.${side} must be an array.`);
  }

  const owners = new Map<string, PortableOutputFile>();
  const descendantOwners = new Map<string, PortableOutputFile>();
  for (const [index, fileName] of files.entries()) {
    const field = `Bundler emittedFiles.${side}[${index}]`;
    const portableFileName =
      side === "client"
        ? assertPortableRelativeBrowserArtifactPath(fileName, field)
        : assertPortableRelativeArtifactPath(fileName, field);
    const file = {
      fileName: portableFileName,
      key: canonicalPortableArtifactPathKey(portableFileName),
    };
    const existing =
      owners.get(file.key) ??
      findAncestorOutput(file.key, owners) ??
      descendantOwners.get(file.key);
    if (existing?.fileName === file.fileName) continue;
    if (existing) {
      throw new Error(
        `[evjs] Bundler emittedFiles.${side} asset "${file.fileName}" conflicts with "${existing.fileName}" on portable file systems. Bundler output paths must use one case- and Unicode-stable spelling, and one file cannot be an ancestor of another.`,
      );
    }
    owners.set(file.key, file);
    registerDescendantOutput(file, descendantOwners);
  }
}

function findAncestorOutput(
  key: string,
  owners: ReadonlyMap<string, PortableOutputFile>,
): PortableOutputFile | undefined {
  const segments = key.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const owner = owners.get(segments.slice(0, index).join("/"));
    if (owner) return owner;
  }
  return undefined;
}

function registerDescendantOutput(
  file: PortableOutputFile,
  descendantOwners: Map<string, PortableOutputFile>,
): void {
  const segments = file.key.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const ancestor = segments.slice(0, index).join("/");
    if (!descendantOwners.has(ancestor)) {
      descendantOwners.set(ancestor, file);
    }
  }
}
