import path from "node:path";

const scopedPackagePattern = /^@[^/\\]+[/\\][^/\\]+$/;

export function derivePackageName(inputName: string, targetDir: string): string {
  const trimmedName = inputName.trim();

  if (scopedPackagePattern.test(trimmedName)) {
    return trimmedName.replace("\\", "/");
  }

  return path.basename(path.resolve(targetDir));
}
