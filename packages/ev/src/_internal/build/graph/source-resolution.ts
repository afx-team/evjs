import path from "node:path";
import { ROUTE_SOURCE_EXTENSIONS } from "../route-conventions.js";
import { isInsideCwd } from "../utils.js";

export const PROJECT_SOURCE_EXTENSIONS = ROUTE_SOURCE_EXTENSIONS;

const PROJECT_SOURCE_EXTENSION_SET = new Set<string>(PROJECT_SOURCE_EXTENSIONS);

export function isProjectSourceModule(file: string): boolean {
  return PROJECT_SOURCE_EXTENSION_SET.has(path.extname(file));
}

export function registerProjectSourceResolutionCandidates(
  cwd: string,
  base: string,
  onSourceDependency?: (file: string) => void,
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
  onSourceDependency?: (file: string) => void,
): string[] {
  const projectCandidates = candidates.filter((candidate) =>
    isInsideCwd(cwd, candidate),
  );
  for (const candidate of projectCandidates) {
    onSourceDependency?.(candidate);
  }
  return projectCandidates;
}

export function isMissingSourcePathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
