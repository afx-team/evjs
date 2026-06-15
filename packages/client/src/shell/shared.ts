import type { RemoteManifest } from "@evjs/shared/manifest";
import { getSharedScope } from "./registry.js";
import { assertSharedScope } from "./shared-scope.js";
import type {
  ActivationRequest,
  RemoteSharedDependenciesWarning,
  RemoteSharedResolution,
  SharedScope,
  ShellOptions,
} from "./types.js";

export function createShellSharedScope(
  shared: SharedScope | undefined,
): SharedScope {
  const globalShared = getSharedScope();
  assertSharedScope(globalShared, "[evjs] global shared scope");
  assertSharedScope(shared, "[evjs] createShell() shared");

  return {
    ...globalShared,
    ...(shared ?? {}),
  };
}

export { assertSharedScope } from "./shared-scope.js";

export async function negotiateRemoteSharedDependencies(
  remoteId: string,
  manifest: RemoteManifest,
  request: ActivationRequest,
  warnedSharedRemotes: Set<string>,
  onWarning: ShellOptions["onWarning"],
  sharedPolicy: NonNullable<ShellOptions["sharedPolicy"]>,
  onRemoteSharedNegotiated: ShellOptions["onRemoteSharedNegotiated"],
  sharedScope: SharedScope,
): Promise<RemoteSharedResolution> {
  const dependencies = Object.keys(manifest.shared ?? {});
  const resolution: RemoteSharedResolution = {
    provided: {},
    missing: [],
    incompatible: [],
  };
  if (dependencies.length === 0) return resolution;

  for (const [name, requirement] of Object.entries(manifest.shared ?? {})) {
    const shareKey = requirement.shareKey ?? name;
    const provided = sharedScope[shareKey];
    if (!provided) {
      resolution.missing.push(name);
      continue;
    }

    if (requirement.singleton && provided.singleton === false) {
      resolution.incompatible.push({
        name,
        shareKey,
        requiredVersion: requirement.requiredVersion ?? "*",
        providedVersion: provided.version,
        reason: "singleton",
      });
      continue;
    }

    if (
      requirement.requiredVersion &&
      (!provided.version ||
        !satisfiesRequiredVersion(
          provided.version,
          requirement.requiredVersion,
        ))
    ) {
      resolution.incompatible.push({
        name,
        shareKey,
        requiredVersion: requirement.requiredVersion,
        providedVersion: provided.version,
        reason: "version",
      });
      continue;
    }

    resolution.provided[name] = provided;
  }

  if (resolution.missing.length === 0 && resolution.incompatible.length === 0) {
    await onRemoteSharedNegotiated?.({
      remoteId,
      dependencies,
      resolution,
      manifest,
      request,
    });
    return resolution;
  }

  if (
    sharedPolicy === "error" ||
    hasStrictSharedFailure(manifest, resolution)
  ) {
    throw new Error(
      formatSharedDependencyMessage(remoteId, dependencies, resolution),
    );
  }

  if (warnedSharedRemotes.has(remoteId)) return resolution;

  warnedSharedRemotes.add(remoteId);
  const warning: RemoteSharedDependenciesWarning = {
    code: "remote-shared-dependencies",
    remoteId,
    dependencies,
    missing: resolution.missing,
    incompatible: resolution.incompatible,
    resolution,
    manifest,
    request,
    message: formatSharedDependencyMessage(remoteId, dependencies, resolution),
  };

  if (onWarning) {
    await onWarning(warning);
  } else {
    console.warn(warning.message);
  }

  await onRemoteSharedNegotiated?.({
    remoteId,
    dependencies,
    resolution,
    manifest,
    request,
  });

  return resolution;
}

function hasStrictSharedFailure(
  manifest: RemoteManifest,
  resolution: RemoteSharedResolution,
): boolean {
  const failed = new Set([
    ...resolution.missing,
    ...resolution.incompatible.map((item) => item.name),
  ]);

  return Object.entries(manifest.shared ?? {}).some(
    ([name, requirement]) => requirement.strictVersion && failed.has(name),
  );
}

function formatSharedDependencyMessage(
  remoteId: string,
  dependencies: string[],
  resolution: RemoteSharedResolution,
): string {
  const details = [
    resolution.missing.length > 0
      ? `missing: ${resolution.missing.join(", ")}`
      : undefined,
    resolution.incompatible.length > 0
      ? `incompatible: ${resolution.incompatible
          .map((item) =>
            item.reason === "singleton"
              ? `${item.name} requires a singleton shared module`
              : `${item.name}@${item.providedVersion ?? "unknown"} does not satisfy ${item.requiredVersion}`,
          )
          .join(", ")}`
      : undefined,
  ].filter(Boolean);

  return (
    `[evjs] Remote "${remoteId}" declares shared dependencies (${dependencies.join(", ")}), ` +
    "but the host share scope cannot satisfy all requirements" +
    (details.length > 0 ? ` (${details.join("; ")})` : "") +
    "."
  );
}

function satisfiesRequiredVersion(version: string, required: string): boolean {
  const normalizedRequired = required.trim();
  if (!normalizedRequired || normalizedRequired === "*") return true;

  if (normalizedRequired.includes("||")) {
    return normalizedRequired
      .split("||")
      .some((part) => satisfiesRequiredVersion(version, part));
  }

  const comparators = normalizedRequired.split(/\s+/).filter(Boolean);
  if (comparators.length > 1) {
    return comparators.every((part) => satisfiesRequiredVersion(version, part));
  }

  if (normalizedRequired.startsWith("^")) {
    return satisfiesCaret(version, normalizedRequired.slice(1));
  }
  if (normalizedRequired.startsWith("~")) {
    return satisfiesTilde(version, normalizedRequired.slice(1));
  }
  if (normalizedRequired.startsWith(">=")) {
    return compareVersions(version, normalizedRequired.slice(2)) >= 0;
  }
  if (normalizedRequired.startsWith(">")) {
    return compareVersions(version, normalizedRequired.slice(1)) > 0;
  }
  if (normalizedRequired.startsWith("<=")) {
    return compareVersions(version, normalizedRequired.slice(2)) <= 0;
  }
  if (normalizedRequired.startsWith("<")) {
    return compareVersions(version, normalizedRequired.slice(1)) < 0;
  }
  return normalizeVersion(version) === normalizeVersion(normalizedRequired);
}

function satisfiesCaret(version: string, required: string): boolean {
  const candidate = parseVersion(version);
  const base = parseVersion(required);
  if (!candidate || !base || compareParsedVersions(candidate, base) < 0) {
    return false;
  }

  if (base[0] > 0) return candidate[0] === base[0];
  if (base[1] > 0) return candidate[0] === 0 && candidate[1] === base[1];
  return candidate[0] === 0 && candidate[1] === 0 && candidate[2] === base[2];
}

function satisfiesTilde(version: string, required: string): boolean {
  const candidate = parseVersion(version);
  const base = parseVersion(required);
  if (!candidate || !base || compareParsedVersions(candidate, base) < 0) {
    return false;
  }

  return candidate[0] === base[0] && candidate[1] === base[1];
}

function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  if (!leftVersion || !rightVersion) return Number.NaN;
  return compareParsedVersions(leftVersion, rightVersion);
}

function compareParsedVersions(
  leftVersion: [number, number, number],
  rightVersion: [number, number, number],
): number {
  for (let index = 0; index < 3; index++) {
    const diff = leftVersion[index] - rightVersion[index];
    if (diff !== 0) return diff;
  }
  return 0;
}

function normalizeVersion(version: string): string {
  return parseVersion(version)?.join(".") ?? version.trim();
}

function parseVersion(version: string): [number, number, number] | undefined {
  const match = version
    .trim()
    .match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}
