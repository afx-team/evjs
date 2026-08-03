import fs from "node:fs";
import path from "node:path";
import type { ResolvedConfig } from "../../config/index.js";
import { CANONICAL_SERVER_ROUTE_ROOT } from "./server-route-conventions.js";
import { isInsideCwd, isRealPathInsideCwd } from "./utils.js";

export interface RouteDirectoryWatchState {
  dependencies: string[];
  unsafeBoundary?: string;
}

export interface WatchFilesOptions {
  readonly mode?: "events" | "polling";
  readonly onError: (error: Error) => void;
  readonly onFallback?: (error: Error) => void;
  readonly recoverableMissingTargets?: ReadonlySet<string>;
}

type LogicalWatchTarget = Readonly<{
  file: string;
  matchPath: string;
  match: "all" | "exact" | "overlap" | "subtree";
}>;

interface PhysicalWatchGroup {
  targets: LogicalWatchTarget[];
  watchTarget: string;
  watchTargetIdentity: string;
}

type PhysicalWatchBinding = Readonly<{
  match: LogicalWatchTarget["match"];
  matchPath: string;
  watchTarget: string;
}>;

type SymlinkBoundary = Readonly<{
  identity: string;
  linkPath: string;
  ownIdentity: string;
}>;

interface ResolvedPhysicalWatchBindings {
  readonly bindings: readonly PhysicalWatchBinding[];
  readonly symlinkBoundaries: readonly SymlinkBoundary[];
}

export interface WatchFilesPlan {
  /** Resource exhaustion prevented a complete native-watcher topology probe. */
  readonly fallbackError?: Error;
  readonly groups: ReadonlyMap<string, PhysicalWatchGroup>;
  readonly key: string;
  readonly logicalTargets: readonly string[];
}

export interface PreparedWatchFilesPlan extends WatchFilesPlan {
  readonly baselineSnapshots: ReadonlyMap<string, string>;
  readonly unknownBaselineTargets: ReadonlySet<string>;
}

interface PollingReadCache {
  readonly directories: Map<string, Promise<string[] | undefined>>;
  readonly lstats: Map<string, Promise<fs.BigIntStats | undefined>>;
  readonly readlinks: Map<string, Promise<string | undefined>>;
  readonly realpaths: Map<string, Promise<string | undefined>>;
  readonly stats: Map<string, Promise<fs.BigIntStats | undefined>>;
}

interface StartPollingOptions {
  readonly fallbackError?: Error;
  readonly forceInvalidateTargets?: ReadonlySet<string>;
  readonly invalidateChangedTargets?: boolean;
}

const POLLING_INTERVAL_MS = 100;
const POLLING_READ_CANCELLED = Symbol("polling-read-cancelled");

export function listConfigDependencyFiles(cwd: string): string[] {
  return ["ev.config.ts", "ev.config.js", "ev.config.mjs"].map((file) =>
    path.resolve(cwd, file),
  );
}

export function createWatchFilesPlan(
  files: readonly string[],
  recoverableMissingTargets: ReadonlySet<string> = new Set(),
): WatchFilesPlan {
  const recoverableTargets = new Set(
    [...recoverableMissingTargets].map((file) => path.resolve(file)),
  );
  const groups = new Map<string, PhysicalWatchGroup>();
  const logicalFiles = [
    ...new Set(files.map((authoredFile) => path.resolve(authoredFile))),
  ];
  const logicalTargets: string[] = [];
  const signatures: string[] = [];
  const watchTargetIdentities = new Map<string, string>();
  let fallbackError: Error | undefined;

  for (const file of logicalFiles) {
    const recoverMissingTarget = recoverableTargets.has(file);
    let targetKind: ReturnType<typeof readWatchTargetKind>;
    try {
      targetKind = readWatchTargetKind(file);
    } catch (error) {
      if (isWatchResourceError(error)) {
        fallbackError = createWatchError(file, error);
        break;
      }
      throw createWatchError(file, error);
    }
    let resolvedBindings: ResolvedPhysicalWatchBindings;
    try {
      resolvedBindings = resolvePhysicalWatchBindings(
        file,
        targetKind,
        recoverMissingTarget,
      );
    } catch (error) {
      if (isWatchResourceError(error)) {
        fallbackError = createWatchError(file, error);
        break;
      }
      throw createWatchError(file, error);
    }
    const { bindings, symlinkBoundaries } = resolvedBindings;
    const bindingSignatures: Array<
      readonly [string, string, string, LogicalWatchTarget["match"]]
    > = [];
    for (const { match, matchPath, watchTarget } of bindings) {
      let watchTargetIdentity = watchTargetIdentities.get(watchTarget);
      if (watchTargetIdentity === undefined) {
        try {
          watchTargetIdentity = readWatchTargetIdentity(watchTarget);
        } catch (error) {
          if (isWatchResourceError(error)) {
            fallbackError = createWatchError(watchTarget, error);
            break;
          }
          throw createWatchError(watchTarget, error);
        }
        watchTargetIdentities.set(watchTarget, watchTargetIdentity);
      }
      bindingSignatures.push([
        watchTarget,
        watchTargetIdentity,
        matchPath,
        match,
      ]);
    }
    if (fallbackError) break;
    signatures.push(
      JSON.stringify([
        file,
        recoverMissingTarget,
        targetKind,
        bindingSignatures.sort(compareJsonValues),
        symlinkBoundaries.map(({ identity, linkPath }) => [linkPath, identity]),
      ]),
    );
    if (bindings.length === 0) continue;

    for (const { match, matchPath, watchTarget } of bindings) {
      const target: LogicalWatchTarget = { file, match, matchPath };
      let group = groups.get(watchTarget);
      if (!group) {
        const watchTargetIdentity = watchTargetIdentities.get(watchTarget);
        if (watchTargetIdentity === undefined) {
          throw new Error(
            `[evjs] Missing watcher identity for "${watchTarget}".`,
          );
        }
        group = { targets: [], watchTarget, watchTargetIdentity };
      }
      if (
        !group.targets.some(
          (candidate) =>
            candidate.file === file &&
            candidate.match === match &&
            candidate.matchPath === matchPath,
        )
      ) {
        group.targets.push(target);
      }
      groups.set(watchTarget, group);
    }
    logicalTargets.push(file);
  }

  const authoredSignatures = logicalFiles.map((file) => [
    file,
    recoverableTargets.has(file),
  ]);
  return {
    ...(fallbackError ? { fallbackError } : {}),
    groups,
    key: JSON.stringify([
      fallbackError ? "polling" : "events",
      authoredSignatures,
      signatures.sort(),
    ]),
    logicalTargets: fallbackError ? logicalFiles : logicalTargets,
  };
}

export function prepareWatchFilesPlan(
  plan: WatchFilesPlan,
): PreparedWatchFilesPlan {
  const baselineSnapshots = new Map<string, string>();
  const unknownBaselineTargets = new Set<string>();
  for (const file of plan.logicalTargets) {
    try {
      baselineSnapshots.set(file, readPollingSnapshot(file));
    } catch (error) {
      if (isWatchResourceError(error)) {
        unknownBaselineTargets.add(file);
        continue;
      }
      throw createWatchError(file, error);
    }
  }
  return {
    ...plan,
    baselineSnapshots,
    unknownBaselineTargets,
  };
}

export function collectWatchFilesChangedSince(
  previous: PreparedWatchFilesPlan,
  current: PreparedWatchFilesPlan,
): string[] {
  // Topology activation handles newly added targets, and removed targets no
  // longer affect the current graph. Compare only stable logical targets so a
  // rebind cannot invent a config change. If both reads were resource-limited,
  // the active event watcher or polling loop remains responsible for retrying.
  const currentTargets = new Set(current.logicalTargets);
  return previous.logicalTargets.filter((file) => {
    if (!currentTargets.has(file)) return false;
    const previousUnknown = previous.unknownBaselineTargets.has(file);
    const currentUnknown = current.unknownBaselineTargets.has(file);
    if (previousUnknown || currentUnknown) {
      return previousUnknown !== currentUnknown;
    }
    return (
      previous.baselineSnapshots.get(file) !==
      current.baselineSnapshots.get(file)
    );
  });
}

export function watchFiles(
  filesOrPlan: readonly string[] | PreparedWatchFilesPlan,
  onChange: (file: string) => void,
  options: WatchFilesOptions,
): () => void {
  let plan: PreparedWatchFilesPlan;
  try {
    plan = Array.isArray(filesOrPlan)
      ? prepareWatchFilesPlan(
          createWatchFilesPlan(
            filesOrPlan,
            options.recoverableMissingTargets ?? new Set(),
          ),
        )
      : (filesOrPlan as PreparedWatchFilesPlan);
  } catch (error) {
    const watchError = toError(error);
    options.onError(watchError);
    throw watchError;
  }
  const { baselineSnapshots, groups, logicalTargets, unknownBaselineTargets } =
    plan;
  const watchers: fs.FSWatcher[] = [];
  const pollingSnapshots = new Map<string, string>();
  let eventWatchersClosed = false;
  let polling = false;
  let pollingTask: Promise<void> | undefined;
  let pollingTimer: ReturnType<typeof setTimeout> | undefined;
  let reportedFailure: Error | undefined;
  let stopped = false;

  const closeEventWatchers = (): Error[] => {
    if (eventWatchersClosed) return [];
    eventWatchersClosed = true;
    const errors: Error[] = [];
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch (error) {
        errors.push(toError(error));
      }
    }
    watchers.length = 0;
    return errors;
  };

  const closePollingWatchers = (): Error[] => {
    if (!polling) return [];
    polling = false;
    if (pollingTimer) clearTimeout(pollingTimer);
    pollingTimer = undefined;
    pollingSnapshots.clear();
    return [];
  };

  const closeAllWatchers = (): Error[] => [
    ...closeEventWatchers(),
    ...closePollingWatchers(),
  ];

  const reportFatalError = (watchError: Error): Error => {
    if (reportedFailure) return reportedFailure;
    if (stopped) return watchError;
    stopped = true;
    const closeErrors = closeAllWatchers();
    reportedFailure =
      closeErrors.length === 0
        ? watchError
        : new AggregateError(
            [watchError, ...closeErrors],
            `${watchError.message} Closing dependency watchers also failed.`,
            { cause: watchError },
          );
    options.onError(reportedFailure);
    return reportedFailure;
  };

  const reportFailure = (watchTarget: string, error: unknown): Error =>
    reportFatalError(createWatchError(watchTarget, error));

  const readCurrentSnapshots = (): {
    error?: Error;
    snapshots: Map<string, string>;
    unknownTargets: Set<string>;
  } => {
    const snapshots = new Map<string, string>();
    const unknownTargets = new Set<string>();
    for (const file of logicalTargets) {
      try {
        snapshots.set(file, readPollingSnapshot(file));
      } catch (error) {
        if (isWatchResourceError(error)) {
          unknownTargets.add(file);
          continue;
        }
        return {
          error: reportFailure(file, error),
          snapshots,
          unknownTargets,
        };
      }
    }
    return { snapshots, unknownTargets };
  };

  const invalidateChangedTargets = (
    snapshots: ReadonlyMap<string, string>,
    unknownTargets: ReadonlySet<string>,
    expectedMode: "events" | "polling",
    forceInvalidateTargets: ReadonlySet<string> = new Set(),
  ): Error | undefined => {
    for (const file of logicalTargets) {
      if (stopped || (expectedMode === "polling" ? !polling : polling)) {
        return reportedFailure;
      }
      if (
        !forceInvalidateTargets.has(file) &&
        !unknownBaselineTargets.has(file) &&
        !unknownTargets.has(file) &&
        baselineSnapshots.get(file) === snapshots.get(file)
      ) {
        continue;
      }
      try {
        onChange(file);
      } catch (error) {
        return reportFailure(file, error);
      }
    }
    return undefined;
  };

  const runPollingCycle = async (): Promise<void> => {
    const cache = createPollingReadCache();
    const nextSnapshots = new Map<string, string>();
    for (const file of logicalTargets) {
      if (stopped || !polling) return;
      try {
        const snapshot = await readPollingSnapshotAsync(
          file,
          cache,
          () => !stopped && polling,
        );
        if (snapshot === POLLING_READ_CANCELLED) return;
        nextSnapshots.set(file, snapshot);
      } catch (error) {
        if (isWatchResourceError(error)) continue;
        if (!stopped && polling) reportFailure(file, error);
        return;
      }
    }
    if (stopped || !polling) return;

    for (const [file, nextSnapshot] of nextSnapshots) {
      if (stopped || !polling) return;
      if (nextSnapshot === pollingSnapshots.get(file)) continue;
      pollingSnapshots.set(file, nextSnapshot);
      try {
        onChange(file);
      } catch (error) {
        reportFailure(file, error);
        return;
      }
    }
  };

  const schedulePollingCycle = () => {
    if (
      stopped ||
      !polling ||
      pollingTask ||
      pollingTimer ||
      logicalTargets.length === 0
    ) {
      return;
    }
    pollingTimer = setTimeout(() => {
      pollingTimer = undefined;
      if (stopped || !polling) return;
      const task = runPollingCycle();
      pollingTask = task;
      const finish = () => {
        if (pollingTask !== task) return;
        pollingTask = undefined;
        schedulePollingCycle();
      };
      void task.then(finish, finish);
    }, POLLING_INTERVAL_MS);
  };

  const startPolling = ({
    fallbackError,
    forceInvalidateTargets = new Set(),
    invalidateChangedTargets: shouldInvalidateChangedTargets = false,
  }: StartPollingOptions = {}): Error | undefined => {
    if (stopped || polling) return reportedFailure;
    const closeErrors = closeEventWatchers();
    if (closeErrors.length > 0) {
      return reportFatalError(
        new AggregateError(
          fallbackError ? [fallbackError, ...closeErrors] : closeErrors,
          "Unable to close event-based dependency watchers before polling.",
          fallbackError ? { cause: fallbackError } : undefined,
        ),
      );
    }

    polling = true;
    const current = readCurrentSnapshots();
    if (current.error) return current.error;
    for (const [file, snapshot] of current.snapshots) {
      pollingSnapshots.set(file, snapshot);
    }
    if (fallbackError) {
      try {
        options.onFallback?.(fallbackError);
      } catch (error) {
        return reportFatalError(toError(error));
      }
    }
    if (shouldInvalidateChangedTargets) {
      const invalidationFailure = invalidateChangedTargets(
        current.snapshots,
        current.unknownTargets,
        "polling",
        forceInvalidateTargets,
      );
      if (invalidationFailure) return invalidationFailure;
    }
    schedulePollingCycle();
    return undefined;
  };

  const recoverStaleWatchTopology = (
    group: PhysicalWatchGroup,
    error: unknown,
  ): Readonly<{ failure?: Error; handled: boolean }> => {
    const forceInvalidateTargets = new Set(
      group.targets.map((target) => target.file),
    );
    if (isMissingPathError(error)) {
      return {
        failure: startPolling({
          forceInvalidateTargets,
          invalidateChangedTargets: true,
        }),
        handled: true,
      };
    }
    if (!isErrnoCode(error, "EPERM")) return { handled: false };

    // Windows may report EPERM when a watched inode is atomically replaced.
    // Recover only when the planned identity proves that topology is stale;
    // an unchanged target or an unreadable identity remains a fatal error.
    let currentIdentity: string;
    try {
      currentIdentity = readWatchTargetIdentity(group.watchTarget);
    } catch (probeError) {
      if (isWatchResourceError(probeError)) {
        return {
          failure: startPolling({
            fallbackError: createWatchError(group.watchTarget, probeError),
            forceInvalidateTargets,
            invalidateChangedTargets: true,
          }),
          handled: true,
        };
      }
      return {
        failure: reportFailure(group.watchTarget, probeError),
        handled: true,
      };
    }
    if (
      currentIdentity !== "missing" &&
      currentIdentity === group.watchTargetIdentity
    ) {
      return { handled: false };
    }
    return {
      failure: startPolling({
        forceInvalidateTargets,
        invalidateChangedTargets: true,
      }),
      handled: true,
    };
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    const errors = closeAllWatchers();
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, "Closing dependency watchers failed.");
    }
  };

  if (options.mode === "polling" || plan.fallbackError) {
    const pollingFailure = startPolling({
      fallbackError: plan.fallbackError,
      invalidateChangedTargets: true,
    });
    if (pollingFailure) throw pollingFailure;
    return stop;
  }

  for (const group of groups.values()) {
    const { targets, watchTarget } = group;
    try {
      const listener: fs.WatchListener<string> = (_eventType, filename) => {
        if (!stopped && !polling) {
          const dispatchedFiles = new Set<string>();
          for (const target of targets) {
            if (stopped || polling) return;
            if (
              !dispatchedFiles.has(target.file) &&
              watchEventMatchesTarget(watchTarget, target, filename)
            ) {
              dispatchedFiles.add(target.file);
              try {
                onChange(target.file);
              } catch (error) {
                reportFailure(target.file, error);
                return;
              }
            }
          }
        }
      };
      const watcher = fs.watch(watchTarget, listener);
      watchers.push(watcher);
      watcher.on("error", (error) => {
        if (eventWatchersClosed) return;
        if (isWatchResourceError(error)) {
          startPolling({
            fallbackError: createWatchError(watchTarget, error),
            invalidateChangedTargets: true,
          });
          return;
        }
        const recovery = recoverStaleWatchTopology(group, error);
        if (recovery.handled) return;
        reportFailure(watchTarget, error);
      });
    } catch (error) {
      // The target may have been removed between graph analysis and watcher
      // setup. Poll every logical target and invalidate them once rather than
      // leaving this group unobserved until some unrelated graph change.
      const recovery = recoverStaleWatchTopology(group, error);
      if (recovery.handled) {
        if (recovery.failure) throw recovery.failure;
        break;
      }
      if (isWatchResourceError(error)) {
        const pollingFailure = startPolling({
          fallbackError: createWatchError(watchTarget, error),
          invalidateChangedTargets: true,
        });
        if (pollingFailure) throw pollingFailure;
        break;
      }
      throw reportFailure(watchTarget, error);
    }
  }

  if (!stopped && !polling) {
    const current = readCurrentSnapshots();
    if (current.error) throw current.error;
    const invalidationFailure = invalidateChangedTargets(
      current.snapshots,
      current.unknownTargets,
      "events",
    );
    if (invalidationFailure) throw invalidationFailure;
  }

  return stop;
}

export async function collectServerRouteWatchState<TBundlerCfg>(
  cwd: string,
  config: ResolvedConfig<TBundlerCfg>,
): Promise<RouteDirectoryWatchState> {
  if (!config.conventions) return { dependencies: [] };
  const root = path.resolve(cwd, CANONICAL_SERVER_ROUTE_ROOT);
  return collectRouteDirectoryWatchState(cwd, root);
}

export async function collectRouteDirectoryWatchState(
  cwd: string,
  root: string,
): Promise<RouteDirectoryWatchState> {
  if (!isInsideCwd(cwd, root)) return { dependencies: [] };

  const directories = new Set([root]);
  try {
    if (!(await isRealPathInsideCwd(cwd, root))) {
      return collectSafeLexicalWatchFallback(cwd, root);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    // A missing target may sit below a symlink that already escapes cwd.
    // Resolve the nearest real in-project ancestor instead of letting
    // watchFiles follow that symlink while searching for a physical watcher.
    return collectSafeLexicalWatchFallback(cwd, root);
  }

  async function visit(current: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const absolute = path.join(current, entry.name);
      directories.add(absolute);
      await visit(absolute);
    }
  }

  await visit(root);
  return { dependencies: [...directories].sort() };
}

function findNearestExistingDirectory(target: string): string | undefined {
  let current = path.dirname(target);
  while (true) {
    try {
      if (fs.statSync(current).isDirectory()) return current;
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
    const parent = path.dirname(current);
    if (current === parent) return undefined;
    current = parent;
  }
}

function readWatchTargetKind(
  target: string,
): "directory" | "file" | "direct" | "missing" | "symlink" {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isDirectory()) return "directory";
    return stat.isFile() ? "file" : "direct";
  } catch (error) {
    if (isMissingPathError(error)) return "missing";
    throw error;
  }
}

function readWatchTargetIdentity(target: string): string {
  let own: fs.BigIntStats;
  try {
    own = fs.lstatSync(target, { bigint: true });
  } catch (error) {
    if (isMissingPathError(error)) return "missing";
    throw error;
  }
  const ownIdentity = serializeWatchIdentity(own);
  if (!own.isSymbolicLink()) return ownIdentity;
  try {
    return `${ownIdentity}|target:${serializeWatchIdentity(
      fs.statSync(target, { bigint: true }),
    )}`;
  } catch (error) {
    if (isMissingPathError(error)) return `${ownIdentity}|target:missing`;
    throw error;
  }
}

function serializeWatchIdentity(stat: fs.BigIntStats): string {
  return [stat.dev, stat.ino, stat.mode].join(":");
}

function resolvePhysicalWatchBindings(
  target: string,
  kind: ReturnType<typeof readWatchTargetKind>,
  recoverMissingTarget: boolean,
): ResolvedPhysicalWatchBindings {
  const symlinkBoundaries = readSymlinkResolutionChain(target);
  const bindings: PhysicalWatchBinding[] = [];
  let targetSymlinkIdentity: string | undefined;
  if (kind === "file") {
    bindings.push({
      match: "exact",
      matchPath: target,
      watchTarget: path.dirname(target),
    });
  } else if (kind === "symlink") {
    targetSymlinkIdentity = serializeWatchIdentity(
      fs.lstatSync(target, { bigint: true }),
    );
    // Watching the link follows target edits on platforms such as macOS, while
    // watching its parent observes atomic unlink/rename replacement of the
    // link itself. Either event invalidates the same logical dependency.
    bindings.push(
      { match: "all", matchPath: target, watchTarget: target },
      {
        match: "exact",
        matchPath: target,
        watchTarget: path.dirname(target),
      },
    );
  } else if (kind === "missing") {
    if (recoverMissingTarget) {
      const watchTarget = findNearestExistingDirectory(target);
      if (watchTarget) {
        bindings.push({ match: "overlap", matchPath: target, watchTarget });
      }
    }
  } else {
    bindings.push({
      match: kind === "directory" ? "subtree" : "all",
      matchPath: target,
      watchTarget: target,
    });
  }

  let skippedDirectTargetBoundary = false;
  for (const { linkPath, ownIdentity } of symlinkBoundaries) {
    if (!skippedDirectTargetBoundary && ownIdentity === targetSymlinkIdentity) {
      skippedDirectTargetBoundary = true;
      continue;
    }
    const parent = path.dirname(linkPath);
    // Top-level aliases such as /tmp -> /private/tmp are managed by the host.
    // Watching their filesystem root would be both noisy and unnecessarily
    // privileged; deeper project-owned boundaries remain observable.
    if (parent === path.parse(linkPath).root) continue;
    bindings.push({ match: "exact", matchPath: linkPath, watchTarget: parent });
  }

  const uniqueBindings = new Map<string, PhysicalWatchBinding>();
  for (const binding of bindings) {
    uniqueBindings.set(
      JSON.stringify([binding.watchTarget, binding.matchPath, binding.match]),
      binding,
    );
  }
  return {
    bindings: [...uniqueBindings.values()],
    symlinkBoundaries,
  };
}

function readSymlinkResolutionChain(target: string): SymlinkBoundary[] {
  // realpath only exposes the final destination. Resolve each link manually so
  // links introduced by another link target also get replacement watchers.
  const boundaries: SymlinkBoundary[] = [];
  const boundaryPaths = new Set<string>();
  const visitedStates = new Set<string>();
  let pendingPath = path.resolve(target);

  for (let followedLinks = 0; ; ) {
    const { root } = path.parse(pendingPath);
    const segments = pendingPath
      .slice(root.length)
      .split(path.sep)
      .filter(Boolean);
    let resolvedPrefix = root;
    let redirected = false;

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment === undefined) break;
      const candidate = path.join(resolvedPrefix, segment);
      let own: fs.BigIntStats;
      try {
        own = fs.lstatSync(candidate, { bigint: true });
      } catch (error) {
        if (isMissingPathError(error)) return boundaries;
        throw error;
      }
      if (!own.isSymbolicLink()) {
        resolvedPrefix = candidate;
        continue;
      }

      const remainingSegments = segments.slice(index + 1);
      const state = JSON.stringify([candidate, remainingSegments]);
      if (visitedStates.has(state) || followedLinks >= 64) {
        const error = new Error(
          `Too many symbolic links while resolving "${target}".`,
        ) as NodeJS.ErrnoException;
        error.code = "ELOOP";
        throw error;
      }
      visitedStates.add(state);
      followedLinks += 1;

      const linkTarget = fs.readlinkSync(candidate);
      if (!boundaryPaths.has(candidate)) {
        const ownIdentity = serializeWatchIdentity(own);
        boundaries.push({
          identity: `${ownIdentity}|link:${JSON.stringify(linkTarget)}`,
          linkPath: candidate,
          ownIdentity,
        });
        boundaryPaths.add(candidate);
      }
      const redirectedTarget = path.isAbsolute(linkTarget)
        ? path.resolve(linkTarget)
        : path.resolve(path.dirname(candidate), linkTarget);
      pendingPath = path.join(redirectedTarget, ...remainingSegments);
      redirected = true;
      break;
    }

    if (!redirected) return boundaries;
  }
}

function watchEventMatchesTarget(
  watchedAncestor: string,
  target: LogicalWatchTarget,
  filename: string | Buffer | null,
): boolean {
  if (filename === null || target.match === "all") return true;
  const changed = path.resolve(watchedAncestor, filename.toString());
  if (target.match === "exact") return changed === target.matchPath;
  if (target.match === "subtree") {
    return isInsideCwd(target.matchPath, changed);
  }
  return (
    isInsideCwd(target.matchPath, changed) ||
    isInsideCwd(changed, target.matchPath)
  );
}

function isMissingPathError(error: unknown): boolean {
  return isErrnoCode(error, "ENOENT") || isErrnoCode(error, "ENOTDIR");
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

function isWatchResourceError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EMFILE" || code === "ENFILE" || code === "ENOSPC";
}

function readPollingSnapshot(file: string): string {
  let own: fs.BigIntStats;
  try {
    own = fs.lstatSync(file, { bigint: true });
  } catch (error) {
    if (isMissingPathError(error)) return readMissingPollingSnapshot(file);
    throw error;
  }

  const ownSnapshot = serializeStat(own);
  if (own.isDirectory()) {
    return `${ownSnapshot}|entries:${readDirectorySnapshot(file)}`;
  }
  if (!own.isSymbolicLink()) return ownSnapshot;
  try {
    const target = fs.statSync(file, { bigint: true });
    return [
      ownSnapshot,
      `target:${serializeStat(target)}`,
      ...(target.isDirectory()
        ? [`entries:${readDirectorySnapshot(file)}`]
        : []),
    ].join("|");
  } catch (error) {
    if (isMissingPathError(error)) return `${ownSnapshot}|target:missing`;
    throw error;
  }
}

function readMissingPollingSnapshot(file: string): string {
  let ancestor = path.dirname(file);
  while (true) {
    try {
      const own = fs.lstatSync(ancestor, { bigint: true });
      let realPath: string | undefined;
      try {
        realPath = fs.realpathSync(ancestor);
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
      }
      let linkTarget: string | undefined;
      let target: fs.BigIntStats | undefined;
      if (own.isSymbolicLink()) {
        linkTarget = fs.readlinkSync(ancestor);
        try {
          target = fs.statSync(ancestor, { bigint: true });
        } catch (error) {
          if (!isMissingPathError(error)) throw error;
        }
      }
      return serializeMissingPollingSnapshot(
        ancestor,
        own,
        realPath,
        linkTarget,
        target,
      );
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return JSON.stringify(["missing", "no-ancestor"]);
    ancestor = parent;
  }
}

function serializeMissingPollingSnapshot(
  ancestor: string,
  own: fs.BigIntStats,
  realPath: string | undefined,
  linkTarget: string | undefined,
  target: fs.BigIntStats | undefined,
): string {
  // Mutable directory metadata would turn unrelated sibling writes (including
  // .ev generation) into config invalidations. Stable inode and real-path
  // identity still detects replacement while the logical target stays absent.
  return JSON.stringify([
    "missing",
    ancestor,
    serializeWatchIdentity(own),
    realPath ?? "realpath:missing",
    ...(own.isSymbolicLink()
      ? [
          `link:${linkTarget ?? "missing"}`,
          `target:${target ? serializeWatchIdentity(target) : "missing"}`,
        ]
      : []),
  ]);
}

function readDirectorySnapshot(directory: string): string {
  let entries: string[];
  try {
    entries = fs.readdirSync(directory).sort();
  } catch (error) {
    if (isMissingPathError(error)) return "missing";
    throw error;
  }
  return entries
    .map((entry) => {
      const file = path.join(directory, entry);
      try {
        return JSON.stringify([
          entry,
          serializeStat(fs.lstatSync(file, { bigint: true })),
        ]);
      } catch (error) {
        if (isMissingPathError(error)) {
          return JSON.stringify([entry, "missing"]);
        }
        throw error;
      }
    })
    .join(",");
}

function createPollingReadCache(): PollingReadCache {
  return {
    directories: new Map(),
    lstats: new Map(),
    readlinks: new Map(),
    realpaths: new Map(),
    stats: new Map(),
  };
}

async function readPollingSnapshotAsync(
  file: string,
  cache: PollingReadCache,
  isActive: () => boolean,
): Promise<string | typeof POLLING_READ_CANCELLED> {
  if (!isActive()) return POLLING_READ_CANCELLED;
  const own = await readCachedLstat(file, cache);
  if (!isActive()) return POLLING_READ_CANCELLED;
  if (!own) return readMissingPollingSnapshotAsync(file, cache, isActive);

  const ownSnapshot = serializeStat(own);
  if (own.isDirectory()) {
    const entries = await readDirectorySnapshotAsync(file, cache, isActive);
    return entries === POLLING_READ_CANCELLED
      ? entries
      : `${ownSnapshot}|entries:${entries}`;
  }
  if (!own.isSymbolicLink()) return ownSnapshot;
  const target = await readCachedStat(file, cache);
  if (!isActive()) return POLLING_READ_CANCELLED;
  if (!target) return `${ownSnapshot}|target:missing`;
  const entries = target.isDirectory()
    ? await readDirectorySnapshotAsync(file, cache, isActive)
    : undefined;
  if (entries === POLLING_READ_CANCELLED) return entries;
  return [
    ownSnapshot,
    `target:${serializeStat(target)}`,
    ...(entries === undefined ? [] : [`entries:${entries}`]),
  ].join("|");
}

async function readMissingPollingSnapshotAsync(
  file: string,
  cache: PollingReadCache,
  isActive: () => boolean,
): Promise<string | typeof POLLING_READ_CANCELLED> {
  let ancestor = path.dirname(file);
  while (true) {
    if (!isActive()) return POLLING_READ_CANCELLED;
    const own = await readCachedLstat(ancestor, cache);
    if (!isActive()) return POLLING_READ_CANCELLED;
    if (own) {
      const realPath = await readCachedRealpath(ancestor, cache);
      if (!isActive()) return POLLING_READ_CANCELLED;
      let linkTarget: string | undefined;
      let target: fs.BigIntStats | undefined;
      if (own.isSymbolicLink()) {
        linkTarget = await readCachedReadlink(ancestor, cache);
        if (!isActive()) return POLLING_READ_CANCELLED;
        target = await readCachedStat(ancestor, cache);
        if (!isActive()) return POLLING_READ_CANCELLED;
      }
      return serializeMissingPollingSnapshot(
        ancestor,
        own,
        realPath,
        linkTarget,
        target,
      );
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return JSON.stringify(["missing", "no-ancestor"]);
    ancestor = parent;
  }
}

async function readDirectorySnapshotAsync(
  directory: string,
  cache: PollingReadCache,
  isActive: () => boolean,
): Promise<string | typeof POLLING_READ_CANCELLED> {
  if (!isActive()) return POLLING_READ_CANCELLED;
  const entries = await readCachedDirectory(directory, cache);
  if (!isActive()) return POLLING_READ_CANCELLED;
  if (!entries) return "missing";

  const snapshots: string[] = [];
  for (const entry of entries) {
    if (!isActive()) return POLLING_READ_CANCELLED;
    const stat = await readCachedLstat(path.join(directory, entry), cache);
    snapshots.push(
      JSON.stringify([entry, stat ? serializeStat(stat) : "missing"]),
    );
  }
  return snapshots.join(",");
}

function readCachedLstat(
  file: string,
  cache: PollingReadCache,
): Promise<fs.BigIntStats | undefined> {
  const cached = cache.lstats.get(file);
  if (cached) return cached;
  const pending = fs.promises
    .lstat(file, { bigint: true })
    .catch((error: unknown) => {
      if (isMissingPathError(error)) return undefined;
      throw error;
    });
  cache.lstats.set(file, pending);
  return pending;
}

function readCachedStat(
  file: string,
  cache: PollingReadCache,
): Promise<fs.BigIntStats | undefined> {
  const cached = cache.stats.get(file);
  if (cached) return cached;
  const pending = fs.promises
    .stat(file, { bigint: true })
    .catch((error: unknown) => {
      if (isMissingPathError(error)) return undefined;
      throw error;
    });
  cache.stats.set(file, pending);
  return pending;
}

function readCachedReadlink(
  file: string,
  cache: PollingReadCache,
): Promise<string | undefined> {
  const cached = cache.readlinks.get(file);
  if (cached) return cached;
  const pending = fs.promises.readlink(file).catch((error: unknown) => {
    if (isMissingPathError(error)) return undefined;
    throw error;
  });
  cache.readlinks.set(file, pending);
  return pending;
}

function readCachedRealpath(
  file: string,
  cache: PollingReadCache,
): Promise<string | undefined> {
  const cached = cache.realpaths.get(file);
  if (cached) return cached;
  const pending = fs.promises.realpath(file).catch((error: unknown) => {
    if (isMissingPathError(error)) return undefined;
    throw error;
  });
  cache.realpaths.set(file, pending);
  return pending;
}

function readCachedDirectory(
  directory: string,
  cache: PollingReadCache,
): Promise<string[] | undefined> {
  const cached = cache.directories.get(directory);
  if (cached) return cached;
  const pending = fs.promises
    .readdir(directory)
    .then((entries) => entries.sort())
    .catch((error: unknown) => {
      if (isMissingPathError(error)) return undefined;
      throw error;
    });
  cache.directories.set(directory, pending);
  return pending;
}

function serializeStat(stat: fs.BigIntStats): string {
  return [
    stat.dev,
    stat.ino,
    stat.mode,
    stat.nlink,
    stat.size,
    stat.mtimeNs,
    stat.ctimeNs,
  ].join(":");
}

function compareJsonValues(left: unknown, right: unknown): number {
  const leftJson = JSON.stringify(left);
  const rightJson = JSON.stringify(right);
  return leftJson === rightJson ? 0 : leftJson < rightJson ? -1 : 1;
}

function createWatchError(watchTarget: string, error: unknown): Error {
  const cause = toError(error);
  const wrapped = new Error(
    `[evjs] Development dependency watcher failed for "${watchTarget}": ${cause.message}`,
    { cause },
  ) as NodeJS.ErrnoException;
  wrapped.code = (cause as NodeJS.ErrnoException).code;
  return wrapped;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function findSafeLexicalWatchFallback(
  cwd: string,
  target: string,
): Promise<{ ancestor: string; boundary: string } | undefined> {
  let boundary = target;
  let current = path.dirname(target);
  while (isInsideCwd(cwd, current)) {
    try {
      if (await isRealPathInsideCwd(cwd, current)) {
        return { ancestor: current, boundary };
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    if (current === cwd) return undefined;
    boundary = current;
    current = path.dirname(current);
  }
  return undefined;
}

async function collectSafeLexicalWatchFallback(
  cwd: string,
  target: string,
): Promise<RouteDirectoryWatchState> {
  const fallback = await findSafeLexicalWatchFallback(cwd, target);
  return {
    dependencies: fallback ? [fallback.ancestor] : [],
    ...(fallback ? { unsafeBoundary: fallback.boundary } : {}),
  };
}
