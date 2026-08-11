import { randomUUID } from "node:crypto";
import path from "node:path";
import { getLogger } from "@logtape/logtape";
import type { Config, ResolvedConfig } from "../../config/index.js";
import type {
  PluginCliShortcut,
  PluginDevSession,
  PluginSetupContext,
} from "../../plugin/index.js";
import type { BundlerAdapter } from "./bundler.js";
import { bindCLIShortcuts, type UnbindCLIShortcuts } from "./cli-shortcuts.js";
import { syncPageRouteTypesFromCoreGraph } from "./convention-config.js";
import type {
  DevDependencyCollector,
  DevDependencyKind,
  PreparedDevRevision,
} from "./dev-revision.js";
import { prepareDevRevision } from "./dev-revision.js";
import {
  assertNoActiveDevDistLock,
  type DevPortReservation,
  reserveDevPorts,
} from "./dev-runtime.js";
import type { DevSession } from "./dev-session.js";
import { startDevSession } from "./dev-session.js";
import {
  collectWatchFilesChangedSince,
  createWatchFilesPlan,
  listConfigDependencyFiles,
  type PreparedWatchFilesPlan,
  prepareWatchFilesPlan,
  resolveInitialDevWatchMode,
  watchFiles,
} from "./dev-watch.js";
import {
  GENERATED_IR_DIR,
  publishFrameworkIR,
} from "./generated-contributions.js";
import { getPageRouteTypesPath } from "./page-route-types.js";
import { collectPluginCliShortcuts } from "./plugin-lifecycle.js";
import { getPluginTypesPath, syncPluginTypes } from "./plugin-types.js";

const logger = getLogger(["evjs", "ev"]);
const DEV_RECONCILE_DEBOUNCE_MS = 50;
const DEV_CLI_SHORTCUT_ACTION_DRAIN_TIMEOUT_MS = 1_000;

export interface DevSupervisorOptions<TBundlerCfg> {
  readonly bundler?: BundlerAdapter<TBundlerCfg>;
  readonly cwd: string;
  readonly fallbackBundler?: BundlerAdapter<TBundlerCfg>;
  readonly flags?: PluginSetupContext<TBundlerCfg>["flags"];
  readonly cliShortcuts?: false;
  readonly loadConfig?: (
    cwd: string,
    context?: { onDependency(file: string): void },
  ) =>
    | Config<TBundlerCfg>
    | undefined
    | Promise<Config<TBundlerCfg> | undefined>;
  readonly reloadInitialConfig?: boolean;
  readonly registerExitCleanup: (cleanup: () => void) => () => void;
  readonly userConfig?: Config<TBundlerCfg>;
}

interface ActiveDevState<TBundlerCfg> {
  readonly fingerprint: string;
  readonly revision: PreparedDevRevision<TBundlerCfg>;
  readonly session: DevSession;
  readonly sessionWatchFiles: Set<string>;
}

interface ActiveShortcutBinding {
  readonly unbind: UnbindCLIShortcuts;
}

class DevPortChangeError extends Error {}

/**
 * Long-lived dev control plane. Filesystem observation, ports, signals, and
 * revision coalescing survive immutable bundler Session replacements.
 */
export async function runDevSupervisor<TBundlerCfg>(
  options: DevSupervisorOptions<TBundlerCfg>,
): Promise<void> {
  const fixedDependencies = new Set<string>([
    ...listConfigDependencyFiles(options.cwd),
    path.resolve(options.cwd, "package.json"),
    path.resolve(options.cwd, "src/pages"),
    path.resolve(options.cwd, "src/apis"),
  ]);
  const devBuildId = `dev-${randomUUID()}`;
  const retainedFailedDependencies = new Set<string>();
  let active: ActiveDevState<TBundlerCfg> | undefined;
  let ports: DevPortReservation | undefined;
  let unregisterPortsExitCleanup = () => {};
  let watcher: { key: string; stop(): void } | undefined;
  let watchMode = resolveInitialDevWatchMode();
  let desiredRevision = 1;
  let attemptedRevision = 0;
  let reconcileRunning = false;
  let reconcileRequested = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  let fatalError: unknown;
  let shortcutBinding: ActiveShortcutBinding | undefined;
  let shortcutOwnerSession: DevSession | undefined;
  const pendingShortcutActions = new Set<Promise<void>>();
  const shortcutContributions = new WeakMap<
    DevSession,
    Promise<PluginCliShortcut[]>
  >();
  let settleCompletion!: () => void;
  let rejectCompletion!: (error: unknown) => void;
  const completion = new Promise<void>((resolve, reject) => {
    settleCompletion = resolve;
    rejectCompletion = reject;
  });

  const collectSessionShortcuts = (
    state: ActiveDevState<TBundlerCfg>,
  ): Promise<PluginCliShortcut[]> => {
    let contribution = shortcutContributions.get(state.session);
    if (!contribution) {
      contribution = collectPluginCliShortcuts(state.revision.config.plugins, {
        onError(error) {
          logger.warn`A plugin CLI shortcut contribution was ignored: ${error}`;
        },
      });
      shortcutContributions.set(state.session, contribution);
    }
    return contribution;
  };

  const refreshCLIShortcuts = async (): Promise<void> => {
    if (stopping || shortcutBinding || pendingShortcutActions.size > 0) return;
    const state = active;
    if (
      !state?.revision.config.dev.cliShortcuts ||
      shortcutOwnerSession !== state.session
    ) {
      return;
    }
    const customShortcuts = await collectSessionShortcuts(state);
    if (
      stopping ||
      active?.session !== state.session ||
      shortcutOwnerSession !== state.session ||
      shortcutBinding ||
      pendingShortcutActions.size > 0
    ) {
      return;
    }
    const pluginSession: PluginDevSession = {
      origin: state.session.origin,
      close() {
        onSignal();
        return Promise.resolve();
      },
    };
    shortcutBinding = {
      unbind: bindCLIShortcuts(pluginSession, { customShortcuts }),
    };
  };

  const refreshCLIShortcutsSafely = async (): Promise<void> => {
    try {
      await refreshCLIShortcuts();
    } catch (error) {
      logger.warn`Plugin CLI shortcuts could not be bound: ${error}`;
    }
  };

  const trackPendingShortcutAction = (idle: Promise<void>): void => {
    pendingShortcutActions.add(idle);
    const settled = () => {
      pendingShortcutActions.delete(idle);
      if (pendingShortcutActions.size === 0 && !stopping) {
        void refreshCLIShortcutsSafely();
      }
    };
    void idle.then(settled, settled);
  };

  const detachCLIShortcuts = async (
    actionDrainTimeoutMs: number,
  ): Promise<void> => {
    const binding = shortcutBinding;
    shortcutBinding = undefined;
    if (!binding) return;
    const result = await binding.unbind({ actionDrainTimeoutMs });
    if (result.drained) return;
    trackPendingShortcutAction(result.idle);
    if (stopping) {
      logger.warn`Plugin CLI shortcuts were detached with an action still running; dev shutdown will continue without waiting for it.`;
    } else {
      logger.warn`Plugin CLI shortcuts were detached, but the running action did not finish within ${actionDrainTimeoutMs}ms. New shortcuts will be bound after it finishes.`;
    }
  };

  const isIgnoredDependency = (file: string): boolean => {
    const absolute = path.resolve(file);
    const generatedRoot = path.resolve(options.cwd, GENERATED_IR_DIR);
    if (isPathInside(generatedRoot, absolute)) return true;
    if (
      absolute === path.resolve(getPageRouteTypesPath(options.cwd).file) ||
      absolute === path.resolve(getPluginTypesPath(options.cwd).file)
    ) {
      return true;
    }
    const relative = path.relative(options.cwd, absolute);
    return (
      relative === "dist" ||
      relative.startsWith(`dist${path.sep}`) ||
      (path.basename(absolute).startsWith(".evjs-") &&
        path.basename(absolute).endsWith(".tmp"))
    );
  };

  const createPreparedWatchPlan = (
    dependencies: Iterable<string>,
  ): PreparedWatchFilesPlan => {
    const files = [
      ...new Set([...dependencies].map((file) => path.resolve(file))),
    ]
      .filter((file) => !isIgnoredDependency(file))
      .sort();
    return prepareWatchFilesPlan(createWatchFilesPlan(files, new Set(files)), {
      ignorePath: isIgnoredDependency,
    });
  };

  const currentDependencySet = (extra: Iterable<string> = []): Set<string> =>
    new Set([
      ...fixedDependencies,
      ...(active?.revision.dependencies ?? []),
      ...(active?.sessionWatchFiles ?? []),
      ...retainedFailedDependencies,
      ...extra,
    ]);

  const fail = (error: unknown) => {
    if (stopping || fatalError !== undefined) return;
    fatalError = error;
    void stop().then(
      () => rejectCompletion(error),
      (cleanupError) =>
        rejectCompletion(
          new AggregateError(
            [error, cleanupError],
            "[evjs] Dev failed and cleanup also failed.",
            { cause: error },
          ),
        ),
    );
  };

  const refreshWatcher = (dependencies: Iterable<string>) => {
    if (stopping) return;
    const nextPlan = createPreparedWatchPlan(dependencies);
    if (watcher?.key === nextPlan.key) return;
    const nextStop = watchFiles(nextPlan, scheduleFileChange, {
      ignorePath: isIgnoredDependency,
      mode: watchMode,
      recoverableMissingTargets: new Set(nextPlan.logicalTargets),
      onError: fail,
      onFallback(error) {
        if (watchMode !== "polling") {
          watchMode = "polling";
          logger.warn`Development dependency event watchers are unavailable; falling back to polling: ${error}`;
        }
      },
    });
    const previous = watcher;
    watcher = {
      key: nextPlan.key,
      stop: nextStop,
    };
    previous?.stop();
  };

  function scheduleFileChange(file: string): void {
    if (stopping || isIgnoredDependency(file)) return;
    desiredRevision += 1;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      requestReconcile();
    }, DEV_RECONCILE_DEBOUNCE_MS);
  }

  const requestReconcile = () => {
    if (stopping) return;
    reconcileRequested = true;
    if (reconcileRunning) return;
    reconcileRunning = true;
    void runReconcileLoop().catch(fail);
  };

  const registerSessionWatchFile = (
    target: Set<string>,
    file: string,
    switchingDependencies: Iterable<string>,
  ) => {
    const absolute = path.resolve(options.cwd, file);
    if (isIgnoredDependency(absolute) || target.has(absolute)) return;
    target.add(absolute);
    refreshWatcher(currentDependencySet([...switchingDependencies, ...target]));
  };

  const applyReservedPorts = async (
    config: ResolvedConfig<TBundlerCfg>,
  ): Promise<ResolvedConfig<TBundlerCfg>> => {
    if (!ports) {
      ports = await reserveDevPorts(
        options.cwd,
        config.dev.port,
        config.server.dev.port,
      );
      unregisterPortsExitCleanup = options.registerExitCleanup(() =>
        ports?.releaseSync(),
      );
      logDevPortSelection(ports);
    } else if (
      ports.client.requestedPort !== config.dev.port ||
      ports.server.requestedPort !== config.server.dev.port
    ) {
      throw new DevPortChangeError(
        "[evjs] dev.port or server.dev.port changed while ev dev is running. Restart ev dev to apply the new ports.",
      );
    }
    return withReservedDevPorts(config, ports);
  };

  const monitorSession = (state: ActiveDevState<TBundlerCfg>) => {
    void state.session.done.then(
      () => {
        if (!stopping && active?.session === state.session) {
          fail(
            new Error(
              `[evjs] Bundler "${state.revision.bundler.name}" development service stopped unexpectedly.`,
            ),
          );
        }
      },
      (error) => {
        if (!stopping && active?.session === state.session) fail(error);
      },
    );
  };

  const activateSession = async (
    state: ActiveDevState<TBundlerCfg>,
  ): Promise<void> => {
    try {
      await state.session.activate();
    } catch (error) {
      if (!stopping && active?.session === state.session) fail(error);
    }
  };

  const switchSession = async (
    prepared: PreparedDevRevision<TBundlerCfg>,
  ): Promise<void> => {
    const previous = active;
    // Revoke eligibility before the asynchronous detach so a late contribution
    // cannot rebind shortcuts for the Session being retired.
    shortcutOwnerSession = undefined;
    await detachCLIShortcuts(DEV_CLI_SHORTCUT_ACTION_DRAIN_TIMEOUT_MS);
    // Detach identity before close so an intentional controller.done settle is
    // never classified as an unexpected active-session failure.
    active = undefined;
    if (previous) await previous.session.close();
    if (stopping) return;

    await publishFrameworkIR(options.cwd, prepared.generatedIR);
    await syncPluginTypes({ cwd: options.cwd });
    await syncPageRouteTypesFromCoreGraph(options.cwd, prepared.graph);
    await assertNoActiveDevDistLock(options.cwd, prepared.plan.distDir);
    if (stopping) return;

    const sessionWatchFiles = new Set<string>();
    const session = await startDevSession({
      bundler: prepared.bundler,
      config: prepared.config,
      cwd: options.cwd,
      flags: options.flags,
      graph: prepared.graph,
      plan: prepared.plan,
      registerExitCleanup: options.registerExitCleanup,
      registerWatchFile(file) {
        registerSessionWatchFile(
          sessionWatchFiles,
          file,
          prepared.dependencies,
        );
      },
    });
    if (stopping) {
      await session.close();
      return;
    }
    const nextState: ActiveDevState<TBundlerCfg> = {
      fingerprint: prepared.semanticFingerprint,
      revision: prepared,
      session,
      sessionWatchFiles,
    };
    active = nextState;
    shortcutOwnerSession = session;
    retainedFailedDependencies.clear();
    refreshWatcher(currentDependencySet());
    monitorSession(nextState);
    void activateSession(nextState);
    void refreshCLIShortcutsSafely();
  };

  const reconcileAttemptChanged = (
    baselines: ReadonlyMap<string, PreparedWatchFilesPlan>,
  ): boolean => {
    let changed = false;
    for (const [file, baseline] of baselines) {
      const current = createPreparedWatchPlan([file]);
      if (collectWatchFilesChangedSince(baseline, current).length === 0) {
        continue;
      }
      changed = true;
    }
    return changed;
  };

  async function runReconcileLoop(): Promise<void> {
    try {
      while (!stopping && reconcileRequested) {
        reconcileRequested = false;
        const targetRevision = desiredRevision;
        if (attemptedRevision === targetRevision) continue;
        attemptedRevision = targetRevision;
        const attemptDependencies = new Set<string>();
        const baselines = new Map<string, PreparedWatchFilesPlan>();
        const collector: DevDependencyCollector = {
          add(file: string, _kind: DevDependencyKind) {
            const absolute = path.resolve(file);
            if (isIgnoredDependency(absolute)) return;
            attemptDependencies.add(absolute);
            if (!baselines.has(absolute)) {
              baselines.set(absolute, createPreparedWatchPlan([absolute]));
            }
          },
        };

        let prepared: PreparedDevRevision<TBundlerCfg>;
        try {
          prepared = await prepareDevRevision({
            buildId: devBuildId,
            bundler: options.bundler,
            cwd: options.cwd,
            fallbackBundler: options.fallbackBundler,
            flags: options.flags,
            cliShortcuts: options.cliShortcuts,
            loadConfig: options.loadConfig,
            reloadConfig:
              options.loadConfig !== undefined &&
              (active !== undefined ||
                options.reloadInitialConfig === true ||
                options.userConfig === undefined),
            userConfig: options.userConfig,
            dependencies: collector,
            inheritedOpaqueDependencies: [...(active?.sessionWatchFiles ?? [])],
            resolveRuntimeConfig: applyReservedPorts,
          });
        } catch (error) {
          for (const dependency of attemptDependencies) {
            retainedFailedDependencies.add(dependency);
          }
          refreshWatcher(currentDependencySet(attemptDependencies));
          if (error instanceof DevPortChangeError) {
            logger.warn`${error.message}`;
          } else if (active) {
            logger.warn`Unable to prepare framework update; keeping the active dev session: ${error}`;
          } else {
            logger.warn`Unable to prepare the initial framework state; waiting for an authored input change: ${error}`;
          }
          continue;
        }

        if (
          targetRevision !== desiredRevision ||
          reconcileAttemptChanged(baselines)
        ) {
          if (targetRevision === desiredRevision) desiredRevision += 1;
          reconcileRequested = true;
          continue;
        }
        refreshWatcher(currentDependencySet(prepared.dependencies));
        if (active?.fingerprint === prepared.semanticFingerprint) {
          retainedFailedDependencies.clear();
          const current = active;
          active = {
            ...current,
            revision: {
              ...prepared,
              // The running Session still owns its immutable config/plan;
              // only dependency ownership advances on a semantic no-op.
              config: current.revision.config,
              graph: current.revision.graph,
              plan: current.revision.plan,
            },
          };
          refreshWatcher(currentDependencySet());
          continue;
        }
        await switchSession(prepared);
      }
    } finally {
      reconcileRunning = false;
      if (!stopping && reconcileRequested) requestReconcile();
    }
  }

  function onSignal(): void {
    void stop().then(
      () => settleCompletion(),
      (error) => rejectCompletion(error),
    );
  }
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  async function stop(): Promise<void> {
    stopPromise ??= (async () => {
      stopping = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = undefined;
      watcher?.stop();
      watcher = undefined;
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      while (reconcileRunning) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      const errors: unknown[] = [];
      try {
        await detachCLIShortcuts(0);
      } catch (error) {
        errors.push(error);
      }
      const current = active;
      active = undefined;
      try {
        await current?.session.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        await ports?.release();
      } catch (error) {
        errors.push(error);
      } finally {
        unregisterPortsExitCleanup();
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, "[evjs] Failed to stop dev.");
      }
    })();
    return stopPromise;
  }

  refreshWatcher(fixedDependencies);
  reconcileRequested = true;
  requestReconcile();

  try {
    await completion;
  } finally {
    if (!stopping) await stop();
  }
}

function withReservedDevPorts<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
  ports: DevPortReservation,
): ResolvedConfig<TBundlerCfg> {
  return {
    ...config,
    dev: { ...config.dev, port: ports.client.port },
    server: {
      ...config.server,
      dev: { ...config.server.dev, port: ports.server.port },
    },
  };
}

function logDevPortSelection(ports: DevPortReservation): void {
  const changes = [
    ports.client.port === ports.client.requestedPort
      ? undefined
      : `client ${ports.client.requestedPort} -> ${ports.client.port}`,
    ports.server.port === ports.server.requestedPort
      ? undefined
      : `server ${ports.server.requestedPort} -> ${ports.server.port}`,
  ].filter((change): change is string => Boolean(change));
  if (changes.length > 0) {
    logger.warn`Configured dev ports are unavailable; reserved ${changes.join(", ")} for this session.`;
  }
}

function isPathInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}
