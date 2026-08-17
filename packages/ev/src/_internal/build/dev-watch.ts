import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ResolvedConfig } from "../../config/index.js";
import { CANONICAL_SERVER_ROUTE_ROOT } from "./server-route-conventions.js";
import { isInsideCwd, isRealPathInsideCwd } from "./utils.js";

export interface RouteDirectoryWatchState {
  dependencies: string[];
  unsafeBoundary?: string;
}

export interface CollectRouteDirectoryWatchStateOptions {
  /** Observe a directory before its topology is read. */
  readonly beforeDirectoryRead?: (directory: string) => void;
}

export type WatchFilesMode = "events" | "polling";

export type IgnoreWatchPath = (file: string) => boolean;

export interface WatchInputSnapshotOptions {
  /** Receives resolved logical paths before they enter a watch snapshot. */
  readonly ignorePath?: IgnoreWatchPath;
}

export interface WatchFilesOptions extends WatchInputSnapshotOptions {
  readonly mode?: WatchFilesMode;
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

export interface CapturedWatchInputSnapshot {
  readonly snapshot?: string;
  readonly unknown: boolean;
}

interface PollingReadCache {
  readonly directories: Map<string, Promise<string[] | undefined>>;
  readonly files: Map<string, Promise<Buffer | undefined>>;
  readonly lstats: Map<string, Promise<fs.BigIntStats | undefined>>;
  readonly readlinks: Map<string, Promise<string | undefined>>;
  readonly realpaths: Map<string, Promise<string | undefined>>;
  readonly stats: Map<string, Promise<fs.BigIntStats | undefined>>;
}

interface StartPollingOptions {
  readonly fallbackError?: Error;
  readonly reconcileSnapshots?: boolean;
}

interface PollingResourceRetryState {
  readonly failureCount: number;
  readonly retryAt: number;
}

const POLLING_INTERVAL_MS = 100;
const MAX_POLLING_RESOURCE_RETRY_MS = 2_000;
const POLLING_READ_CANCELLED = Symbol("polling-read-cancelled");
const IGNORED_WATCH_INPUT_SNAPSHOT = JSON.stringify(["ignored"]);

export function resolveInitialDevWatchMode(
  platform: NodeJS.Platform = process.platform,
  sandbox: string | undefined = process.env.CODEX_SANDBOX,
): WatchFilesMode {
  // Codex's macOS Seatbelt profile currently denies the FSEvents service used
  // by directory fs.watch(), which Node reports as a misleading EMFILE error.
  // Skip that known-to-fail probe and use EVJS's existing polling backend.
  return platform === "darwin" && sandbox === "seatbelt" ? "polling" : "events";
}

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
  ].sort();
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
  options: WatchInputSnapshotOptions = {},
): PreparedWatchFilesPlan {
  const baselineSnapshots = new Map<string, string>();
  const unknownBaselineTargets = new Set<string>();
  for (const file of plan.logicalTargets) {
    const captured = captureWatchInputSnapshot(file, options);
    if (captured.unknown) unknownBaselineTargets.add(file);
    else if (captured.snapshot !== undefined)
      baselineSnapshots.set(file, captured.snapshot);
  }
  return {
    ...plan,
    baselineSnapshots,
    unknownBaselineTargets,
  };
}

/** Capture one input without constructing its physical watcher topology. */
export function captureWatchInputSnapshot(
  file: string,
  options: WatchInputSnapshotOptions = {},
): CapturedWatchInputSnapshot {
  try {
    return {
      snapshot: readWatchInputSnapshot(file, options),
      unknown: false,
    };
  } catch (error) {
    if (isWatchResourceError(error)) return { unknown: true };
    throw createWatchError(file, error);
  }
}

export function didWatchInputChange(
  baseline: CapturedWatchInputSnapshot,
  current: PreparedWatchFilesPlan,
  file: string,
): boolean {
  const absolute = path.resolve(file);
  const currentUnknown = current.unknownBaselineTargets.has(absolute);
  if (baseline.unknown || currentUnknown) {
    return baseline.unknown !== currentUnknown;
  }
  return baseline.snapshot !== current.baselineSnapshots.get(absolute);
}

/** Returns an opaque semantic identity for a file or directory watch input. */
export function readWatchInputSnapshot(
  file: string,
  options: WatchInputSnapshotOptions = {},
): string {
  return readWatchInputSnapshotValue(path.resolve(file), options);
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
          options,
        )
      : (filesOrPlan as PreparedWatchFilesPlan);
  } catch (error) {
    const watchError = toError(error);
    options.onError(watchError);
    throw watchError;
  }
  const { baselineSnapshots, groups, logicalTargets, unknownBaselineTargets } =
    plan;
  const observedSnapshots = new Map(baselineSnapshots);
  const observedUnknownTargets = new Set(unknownBaselineTargets);
  const watchers: fs.FSWatcher[] = [];
  const pollingResourceRetries = new Map<string, PollingResourceRetryState>();
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
    pollingResourceRetries.clear();
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
        snapshots.set(file, readWatchInputSnapshot(file, options));
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

  const invalidateObservedTarget = (
    file: string,
    nextSnapshot: string | undefined,
    isUnknown: boolean,
    expectedMode: "events" | "polling",
  ): Error | undefined => {
    if (stopped || (expectedMode === "polling" ? !polling : polling)) {
      return reportedFailure;
    }
    const wasUnknown = observedUnknownTargets.has(file);
    const previousSnapshot = observedSnapshots.get(file);
    if (isUnknown) {
      observedSnapshots.delete(file);
      observedUnknownTargets.add(file);
    } else {
      observedUnknownTargets.delete(file);
      if (nextSnapshot !== undefined) observedSnapshots.set(file, nextSnapshot);
    }
    if (
      wasUnknown === isUnknown &&
      (isUnknown || previousSnapshot === nextSnapshot)
    ) {
      return undefined;
    }
    try {
      onChange(file);
    } catch (error) {
      return reportFailure(file, error);
    }
    return undefined;
  };

  const invalidateChangedTargets = (
    snapshots: ReadonlyMap<string, string>,
    unknownTargets: ReadonlySet<string>,
    expectedMode: "events" | "polling",
  ): Error | undefined => {
    for (const file of logicalTargets) {
      const failure = invalidateObservedTarget(
        file,
        snapshots.get(file),
        unknownTargets.has(file),
        expectedMode,
      );
      if (failure || stopped) return failure ?? reportedFailure;
    }
    return undefined;
  };

  const runPollingCycle = async (): Promise<void> => {
    const cache = createPollingReadCache();
    const nextSnapshots = new Map<string, string>();
    for (const file of logicalTargets) {
      if (stopped || !polling) return;
      const resourceRetry = pollingResourceRetries.get(file);
      if (resourceRetry && resourceRetry.retryAt > Date.now()) continue;
      try {
        const snapshot = await readPollingSnapshotAsync(
          file,
          cache,
          () => !stopped && polling,
          options,
        );
        if (snapshot === POLLING_READ_CANCELLED) return;
        pollingResourceRetries.delete(file);
        nextSnapshots.set(file, snapshot);
      } catch (error) {
        if (isWatchResourceError(error)) {
          const failureCount = (resourceRetry?.failureCount ?? 0) + 1;
          const retryDelay = Math.min(
            POLLING_INTERVAL_MS * 2 ** Math.min(failureCount, 5),
            MAX_POLLING_RESOURCE_RETRY_MS,
          );
          pollingResourceRetries.set(file, {
            failureCount,
            retryAt: Date.now() + retryDelay,
          });
          continue;
        }
        if (!stopped && polling) reportFailure(file, error);
        return;
      }
    }
    if (stopped || !polling) return;

    for (const [file, nextSnapshot] of nextSnapshots) {
      if (stopped || !polling) return;
      if (invalidateObservedTarget(file, nextSnapshot, false, "polling"))
        return;
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
    reconcileSnapshots = false,
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
    if (fallbackError) {
      try {
        options.onFallback?.(fallbackError);
      } catch (error) {
        return reportFatalError(toError(error));
      }
    }
    if (reconcileSnapshots) {
      const invalidationFailure = invalidateChangedTargets(
        current.snapshots,
        current.unknownTargets,
        "polling",
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
    if (isMissingPathError(error)) {
      return {
        failure: startPolling({
          reconcileSnapshots: true,
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
            reconcileSnapshots: true,
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
        reconcileSnapshots: true,
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
      reconcileSnapshots: true,
    });
    if (pollingFailure) throw pollingFailure;
    return stop;
  }

  for (const group of groups.values()) {
    const { targets, watchTarget } = group;
    try {
      const listener: fs.WatchListener<string> = (_eventType, filename) => {
        if (stopped || polling) return;
        if (filename !== null && options.ignorePath) {
          try {
            const changedPath = path.resolve(watchTarget, filename.toString());
            if (options.ignorePath(changedPath)) return;
          } catch (error) {
            reportFailure(watchTarget, error);
            return;
          }
        }

        const observedFiles = new Set<string>();
        for (const target of targets) {
          if (stopped || polling) return;
          if (
            observedFiles.has(target.file) ||
            !watchEventMatchesTarget(watchTarget, target, filename)
          ) {
            continue;
          }
          observedFiles.add(target.file);
          let snapshot: string;
          try {
            snapshot = readWatchInputSnapshot(target.file, options);
          } catch (error) {
            if (isWatchResourceError(error)) {
              startPolling({
                fallbackError: createWatchError(target.file, error),
                reconcileSnapshots: true,
              });
            } else {
              reportFailure(target.file, error);
            }
            return;
          }
          if (
            invalidateObservedTarget(target.file, snapshot, false, "events")
          ) {
            return;
          }
        }
      };
      const watcher = fs.watch(watchTarget, listener);
      watchers.push(watcher);
      watcher.once("close", () => {
        if (eventWatchersClosed || stopped || polling) return;
        startPolling({
          fallbackError: createWatchError(
            watchTarget,
            new Error("Native filesystem watcher closed unexpectedly."),
          ),
          reconcileSnapshots: true,
        });
      });
      watcher.on("error", (error) => {
        if (eventWatchersClosed) return;
        if (isNativeWatchUnavailableError(error)) {
          startPolling({
            fallbackError: createWatchError(watchTarget, error),
            reconcileSnapshots: true,
          });
          return;
        }
        const recovery = recoverStaleWatchTopology(group, error);
        if (recovery.handled) return;
        reportFailure(watchTarget, error);
      });
    } catch (error) {
      // The target may have been removed between graph analysis and watcher
      // setup. Poll every logical target and reconcile semantic snapshots so
      // this group does not stay unobserved until an unrelated graph change.
      const recovery = recoverStaleWatchTopology(group, error);
      if (recovery.handled) {
        if (recovery.failure) throw recovery.failure;
        break;
      }
      if (isNativeWatchUnavailableError(error)) {
        const pollingFailure = startPolling({
          fallbackError: createWatchError(watchTarget, error),
          reconcileSnapshots: true,
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
  options: CollectRouteDirectoryWatchStateOptions = {},
): Promise<RouteDirectoryWatchState> {
  if (!config.conventions) return { dependencies: [] };
  const root = path.resolve(cwd, CANONICAL_SERVER_ROUTE_ROOT);
  return collectRouteDirectoryWatchState(cwd, root, options);
}

export async function collectRouteDirectoryWatchState(
  cwd: string,
  root: string,
  options: CollectRouteDirectoryWatchStateOptions = {},
): Promise<RouteDirectoryWatchState> {
  if (!isInsideCwd(cwd, root)) return { dependencies: [] };

  const directories = new Set([root]);
  options.beforeDirectoryRead?.(root);
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
    options.beforeDirectoryRead?.(current);
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

      let linkTarget: string;
      try {
        linkTarget = fs.readlinkSync(candidate);
      } catch (error) {
        if (isReadlinkTopologyRaceError(error)) return boundaries;
        throw error;
      }
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

function isNativeWatchUnavailableError(error: unknown): boolean {
  if (isWatchResourceError(error)) return true;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ENOSYS" ||
    code === "ENOTSUP" ||
    code === "EOPNOTSUPP" ||
    code === "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM"
  );
}

function isReadlinkTopologyRaceError(error: unknown): boolean {
  return isMissingPathError(error) || isErrnoCode(error, "EINVAL");
}

type WatchInputType =
  | "block-device"
  | "character-device"
  | "directory"
  | "fifo"
  | "file"
  | "other"
  | "socket"
  | "symlink";

type DirectoryTopologyEntry = readonly string[];

function readWatchInputSnapshotValue(
  absoluteFile: string,
  options: WatchInputSnapshotOptions,
): string {
  if (options.ignorePath?.(absoluteFile)) return IGNORED_WATCH_INPUT_SNAPSHOT;

  let own: fs.BigIntStats;
  try {
    own = fs.lstatSync(absoluteFile, { bigint: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return readMissingWatchInputSnapshot(absoluteFile);
    }
    throw error;
  }

  if (own.isDirectory()) {
    const snapshot = readDirectoryTopologySnapshot(absoluteFile, options);
    return snapshot ?? readMissingWatchInputSnapshot(absoluteFile);
  }
  if (own.isFile()) {
    const contents = readFileContents(absoluteFile);
    return contents
      ? serializeFileSnapshot(contents, readRealPath(absoluteFile))
      : readMissingWatchInputSnapshot(absoluteFile);
  }
  if (!own.isSymbolicLink()) {
    return serializeTypedInputSnapshot(readWatchInputType(own));
  }
  return readSymlinkWatchInputSnapshot(absoluteFile, options);
}

function readSymlinkWatchInputSnapshot(
  file: string,
  options: WatchInputSnapshotOptions,
): string {
  let linkTarget: string;
  try {
    linkTarget = fs.readlinkSync(file);
  } catch (error) {
    if (isMissingPathError(error)) return readMissingWatchInputSnapshot(file);
    if (isErrnoCode(error, "EINVAL"))
      return readWatchInputSnapshotValue(file, options);
    throw error;
  }

  let realPath: string | undefined;
  try {
    realPath = fs.realpathSync(file);
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }

  let target: fs.BigIntStats | undefined;
  try {
    target = fs.statSync(file, { bigint: true });
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
  if (!target) {
    return serializeSymlinkSnapshot(linkTarget, realPath, undefined, "missing");
  }

  const targetType = readWatchInputType(target);
  let targetSnapshot: string;
  if (target.isDirectory()) {
    targetSnapshot =
      readDirectoryTopologySnapshot(file, options) ?? "target:missing";
  } else if (target.isFile()) {
    const contents = readFileContents(file);
    targetSnapshot = contents
      ? serializeFileSnapshot(contents, realPath)
      : "target:missing";
  } else {
    targetSnapshot = serializeTypedInputSnapshot(targetType);
  }
  return serializeSymlinkSnapshot(
    linkTarget,
    realPath,
    targetType,
    targetSnapshot,
  );
}

function readMissingWatchInputSnapshot(file: string): string {
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
        try {
          linkTarget = fs.readlinkSync(ancestor);
        } catch (error) {
          if (!isReadlinkTopologyRaceError(error)) throw error;
        }
        try {
          target = fs.statSync(ancestor, { bigint: true });
        } catch (error) {
          if (!isMissingPathError(error)) throw error;
        }
      }
      return serializeMissingWatchInputSnapshot(
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

function serializeMissingWatchInputSnapshot(
  ancestor: string,
  own: fs.BigIntStats,
  realPath: string | undefined,
  linkTarget: string | undefined,
  target: fs.BigIntStats | undefined,
): string {
  // Mutable metadata and inode identity would turn atomic same-input writes or
  // unrelated sibling generation into false framework invalidations.
  return JSON.stringify([
    "missing",
    ancestor,
    readWatchInputType(own),
    realPath ?? "realpath:missing",
    ...(own.isSymbolicLink()
      ? [
          `link:${linkTarget ?? "missing"}`,
          `target:${target ? readWatchInputType(target) : "missing"}`,
        ]
      : []),
  ]);
}

function readDirectoryTopologySnapshot(
  directory: string,
  options: WatchInputSnapshotOptions,
): string | undefined {
  let entries: string[];
  try {
    entries = fs.readdirSync(directory).sort();
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
  const realPath = readRealPath(directory);
  if (!realPath) return undefined;

  const snapshots: DirectoryTopologyEntry[] = [];
  for (const entry of entries) {
    const file = path.join(directory, entry);
    if (options.ignorePath?.(file)) continue;
    const snapshot = readDirectoryTopologyEntry(entry, file);
    if (snapshot) snapshots.push(snapshot);
  }
  return serializeDirectorySnapshot(realPath, snapshots);
}

function readDirectoryTopologyEntry(
  entry: string,
  file: string,
): DirectoryTopologyEntry | undefined {
  let own: fs.BigIntStats;
  try {
    own = fs.lstatSync(file, { bigint: true });
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
  const type = readWatchInputType(own);
  if (!own.isSymbolicLink()) return [entry, type];

  let linkTarget: string | undefined;
  try {
    linkTarget = fs.readlinkSync(file);
  } catch (error) {
    if (!isReadlinkTopologyRaceError(error)) throw error;
  }
  let realPath: string | undefined;
  try {
    realPath = fs.realpathSync(file);
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
  let target: fs.BigIntStats | undefined;
  try {
    target = fs.statSync(file, { bigint: true });
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
  return [
    entry,
    type,
    `link:${linkTarget ?? "missing"}`,
    `realpath:${realPath ?? "missing"}`,
    `target:${target ? readWatchInputType(target) : "missing"}`,
  ];
}

function createPollingReadCache(): PollingReadCache {
  return {
    directories: new Map(),
    files: new Map(),
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
  options: WatchInputSnapshotOptions,
): Promise<string | typeof POLLING_READ_CANCELLED> {
  if (!isActive()) return POLLING_READ_CANCELLED;
  if (options.ignorePath?.(file)) return IGNORED_WATCH_INPUT_SNAPSHOT;
  const own = await readCachedLstat(file, cache);
  if (!isActive()) return POLLING_READ_CANCELLED;
  if (!own) return readMissingWatchInputSnapshotAsync(file, cache, isActive);

  if (own.isDirectory()) {
    const snapshot = await readDirectoryTopologySnapshotAsync(
      file,
      cache,
      isActive,
      options,
    );
    if (snapshot === POLLING_READ_CANCELLED) return snapshot;
    return (
      snapshot ?? readMissingWatchInputSnapshotAsync(file, cache, isActive)
    );
  }
  if (own.isFile()) {
    const contents = await readCachedFile(file, cache);
    if (!isActive()) return POLLING_READ_CANCELLED;
    const realPath = await readCachedRealpath(file, cache);
    if (!isActive()) return POLLING_READ_CANCELLED;
    return contents
      ? serializeFileSnapshot(contents, realPath)
      : readMissingWatchInputSnapshotAsync(file, cache, isActive);
  }
  if (!own.isSymbolicLink()) {
    return serializeTypedInputSnapshot(readWatchInputType(own));
  }
  return readSymlinkWatchInputSnapshotAsync(file, cache, isActive, options);
}

async function readSymlinkWatchInputSnapshotAsync(
  file: string,
  cache: PollingReadCache,
  isActive: () => boolean,
  options: WatchInputSnapshotOptions,
): Promise<string | typeof POLLING_READ_CANCELLED> {
  const linkTarget = await readCachedReadlink(file, cache);
  if (!isActive()) return POLLING_READ_CANCELLED;
  if (linkTarget === undefined) {
    return readMissingWatchInputSnapshotAsync(file, cache, isActive);
  }
  const realPath = await readCachedRealpath(file, cache);
  if (!isActive()) return POLLING_READ_CANCELLED;
  const target = await readCachedStat(file, cache);
  if (!isActive()) return POLLING_READ_CANCELLED;
  if (!target) {
    return serializeSymlinkSnapshot(linkTarget, realPath, undefined, "missing");
  }

  const targetType = readWatchInputType(target);
  let targetSnapshot: string | typeof POLLING_READ_CANCELLED;
  if (target.isDirectory()) {
    targetSnapshot =
      (await readDirectoryTopologySnapshotAsync(
        file,
        cache,
        isActive,
        options,
      )) ?? "target:missing";
  } else if (target.isFile()) {
    const contents = await readCachedFile(file, cache);
    if (!isActive()) return POLLING_READ_CANCELLED;
    targetSnapshot = contents
      ? serializeFileSnapshot(contents, realPath)
      : "target:missing";
  } else {
    targetSnapshot = serializeTypedInputSnapshot(targetType);
  }
  if (targetSnapshot === POLLING_READ_CANCELLED) return targetSnapshot;
  return serializeSymlinkSnapshot(
    linkTarget,
    realPath,
    targetType,
    targetSnapshot,
  );
}

async function readMissingWatchInputSnapshotAsync(
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
      return serializeMissingWatchInputSnapshot(
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

async function readDirectoryTopologySnapshotAsync(
  directory: string,
  cache: PollingReadCache,
  isActive: () => boolean,
  options: WatchInputSnapshotOptions,
): Promise<string | undefined | typeof POLLING_READ_CANCELLED> {
  if (!isActive()) return POLLING_READ_CANCELLED;
  const entries = await readCachedDirectory(directory, cache);
  if (!isActive()) return POLLING_READ_CANCELLED;
  if (!entries) return undefined;
  const realPath = await readCachedRealpath(directory, cache);
  if (!isActive()) return POLLING_READ_CANCELLED;
  if (!realPath) return undefined;

  const snapshots: DirectoryTopologyEntry[] = [];
  for (const entry of entries) {
    if (!isActive()) return POLLING_READ_CANCELLED;
    const file = path.join(directory, entry);
    if (options.ignorePath?.(file)) continue;
    const snapshot = await readDirectoryTopologyEntryAsync(
      entry,
      file,
      cache,
      isActive,
    );
    if (snapshot === POLLING_READ_CANCELLED) return snapshot;
    if (snapshot) snapshots.push(snapshot);
  }
  return serializeDirectorySnapshot(realPath, snapshots);
}

async function readDirectoryTopologyEntryAsync(
  entry: string,
  file: string,
  cache: PollingReadCache,
  isActive: () => boolean,
): Promise<DirectoryTopologyEntry | undefined | typeof POLLING_READ_CANCELLED> {
  const own = await readCachedLstat(file, cache);
  if (!isActive()) return POLLING_READ_CANCELLED;
  if (!own) return undefined;
  const type = readWatchInputType(own);
  if (!own.isSymbolicLink()) return [entry, type];

  const linkTarget = await readCachedReadlink(file, cache);
  if (!isActive()) return POLLING_READ_CANCELLED;
  const realPath = await readCachedRealpath(file, cache);
  if (!isActive()) return POLLING_READ_CANCELLED;
  const target = await readCachedStat(file, cache);
  if (!isActive()) return POLLING_READ_CANCELLED;
  return [
    entry,
    type,
    `link:${linkTarget ?? "missing"}`,
    `realpath:${realPath ?? "missing"}`,
    `target:${target ? readWatchInputType(target) : "missing"}`,
  ];
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

function readCachedFile(
  file: string,
  cache: PollingReadCache,
): Promise<Buffer | undefined> {
  const cached = cache.files.get(file);
  if (cached) return cached;
  const pending = fs.promises.readFile(file).catch((error: unknown) => {
    if (isMissingPathError(error)) return undefined;
    throw error;
  });
  cache.files.set(file, pending);
  return pending;
}

function readCachedReadlink(
  file: string,
  cache: PollingReadCache,
): Promise<string | undefined> {
  const cached = cache.readlinks.get(file);
  if (cached) return cached;
  const pending = fs.promises.readlink(file).catch((error: unknown) => {
    if (isReadlinkTopologyRaceError(error)) return undefined;
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

function readFileContents(file: string): Buffer | undefined {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

function readRealPath(file: string): string | undefined {
  try {
    return fs.realpathSync(file);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

function readWatchInputType(stat: fs.BigIntStats): WatchInputType {
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "directory";
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isBlockDevice()) return "block-device";
  if (stat.isCharacterDevice()) return "character-device";
  if (stat.isFIFO()) return "fifo";
  if (stat.isSocket()) return "socket";
  return "other";
}

function serializeFileSnapshot(
  contents: Uint8Array,
  realPath: string | undefined,
): string {
  return JSON.stringify([
    "file",
    `realpath:${realPath ?? "missing"}`,
    createHash("sha256").update(contents).digest("hex"),
  ]);
}

function serializeDirectorySnapshot(
  realPath: string,
  entries: readonly DirectoryTopologyEntry[],
): string {
  return JSON.stringify(["directory", `realpath:${realPath}`, entries]);
}

function serializeTypedInputSnapshot(type: WatchInputType): string {
  return JSON.stringify(["type", type]);
}

function serializeSymlinkSnapshot(
  linkTarget: string,
  realPath: string | undefined,
  targetType: WatchInputType | undefined,
  targetSnapshot: string,
): string {
  return JSON.stringify([
    "symlink",
    `link:${linkTarget}`,
    `realpath:${realPath ?? "missing"}`,
    `target:${targetType ?? "missing"}`,
    targetSnapshot,
  ]);
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
