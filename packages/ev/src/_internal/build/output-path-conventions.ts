import {
  assertPortableRelativeArtifactPath,
  canonicalPortableArtifactPathKey,
} from "./portable-artifact-path.js";

export interface FrameworkOutputDirectories {
  client: string;
  server: string;
}

export type FrameworkOutputDirectoryField =
  | "output.client"
  | "output.server"
  | "plan.distDir";

/** Validate the portable, project-relative syntax of one output directory. */
export function assertFrameworkOutputDirectory(
  value: unknown,
  field: FrameworkOutputDirectoryField,
): string {
  if (
    typeof value === "string" &&
    (value.startsWith("/") || /^[A-Za-z]:/.test(value))
  ) {
    throw new Error(`[evjs] ${field} must be relative to the project root.`);
  }
  return assertPortableRelativeArtifactPath(value, field, "output directory");
}

/** Reject output trees that can alias or recursively contain one another. */
export function assertSeparateFrameworkOutputDirectories(
  output: FrameworkOutputDirectories,
): void {
  const client = assertFrameworkOutputDirectory(output.client, "output.client");
  const server = assertFrameworkOutputDirectory(output.server, "output.server");
  const clientKey = canonicalPortableArtifactPathKey(client);
  const serverKey = canonicalPortableArtifactPathKey(server);
  if (
    clientKey === serverKey ||
    isStrictDirectoryDescendant(clientKey, serverKey) ||
    isStrictDirectoryDescendant(serverKey, clientKey)
  ) {
    throw new Error(
      "[evjs] output.client and output.server must be separate, non-nested directories.",
    );
  }
}

/** Keep every recursively cleaned framework output below one owned dist tree. */
export function assertFrameworkOutputOwnership(
  output: FrameworkOutputDirectories,
  distDir: string,
): void {
  const root = assertFrameworkOutputDirectory(distDir, "plan.distDir");
  const directories = [
    ["output.client", output.client],
    ["output.server", output.server],
  ] as const;

  for (const [field, configured] of directories) {
    const directory = assertFrameworkOutputDirectory(configured, field);
    if (
      !isStrictDirectoryDescendant(root, directory) ||
      !isStrictDirectoryDescendant(
        canonicalPortableArtifactPathKey(root),
        canonicalPortableArtifactPathKey(directory),
      )
    ) {
      throw new Error(
        `[evjs] ${field} "${configured}" must be a strict descendant of plan.distDir "${distDir}" so recursive cleaning stays inside framework-owned output.`,
      );
    }
  }
  assertSeparateFrameworkOutputDirectories(output);
}

function isStrictDirectoryDescendant(
  ancestor: string,
  candidate: string,
): boolean {
  return candidate.startsWith(`${ancestor}/`);
}
