import fs from "node:fs";
import path from "node:path";
import { ROUTE_SOURCE_EXTENSIONS } from "../route-conventions.js";
import { isInsideCwd } from "../utils.js";

export const PROJECT_SOURCE_EXTENSIONS = ROUTE_SOURCE_EXTENSIONS;

const PROJECT_SOURCE_EXTENSION_SET = new Set<string>(PROJECT_SOURCE_EXTENSIONS);

export interface SourceDependencyReporter {
  (file: string): void;
  /**
   * Reports one ordered resolver probe without expanding every missing
   * candidate into an independent file dependency.
   */
  resolutionCandidates?: (candidates: readonly string[]) => void;
}

export function isProjectSourceModule(file: string): boolean {
  return PROJECT_SOURCE_EXTENSION_SET.has(path.extname(file));
}

export function registerProjectSourceResolutionCandidates(
  cwd: string,
  base: string,
  onSourceDependency?: SourceDependencyReporter,
): string[] {
  const candidates = [base];
  if (!isProjectSourceModule(base)) {
    for (const extension of PROJECT_SOURCE_EXTENSIONS) {
      candidates.push(`${base}${extension}`);
    }
  }
  for (const extension of PROJECT_SOURCE_EXTENSIONS) {
    candidates.push(path.join(base, `index${extension}`));
  }
  return registerProjectSourceDependencies(cwd, candidates, onSourceDependency);
}

export function registerProjectSourceDependencies(
  cwd: string,
  candidates: readonly string[],
  onSourceDependency?: SourceDependencyReporter,
): string[] {
  const projectCandidates = candidates.filter((candidate) =>
    isInsideCwd(cwd, candidate),
  );
  if (onSourceDependency?.resolutionCandidates) {
    onSourceDependency.resolutionCandidates(projectCandidates);
  } else {
    for (const candidate of projectCandidates) {
      onSourceDependency?.(candidate);
    }
  }
  return projectCandidates;
}

/**
 * Collapse one resolver probe into directory topology dependencies.
 *
 * The direct candidate parent observes extension alternatives. An existing
 * nested candidate directory additionally observes index.* alternatives. A
 * missing nested directory is intentionally omitted until its creation is
 * observed by the direct parent and the next revision resolves it again.
 */
export function collectProjectSourceResolutionWatchDirectories(
  candidates: readonly string[],
): string[] {
  const firstCandidate = candidates[0];
  if (!firstCandidate) return [];

  const directParent = path.dirname(firstCandidate);
  const directories = new Set([directParent]);
  for (const candidate of candidates) {
    const directory = path.dirname(candidate);
    if (directory === directParent || directories.has(directory)) continue;
    try {
      if (fs.statSync(directory).isDirectory()) directories.add(directory);
    } catch (error) {
      if (!isMissingSourcePathError(error)) throw error;
    }
  }
  return [...directories].sort();
}

export function isMissingSourcePathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
