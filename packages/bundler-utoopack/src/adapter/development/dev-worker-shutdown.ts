const UTOOPACK_SESSION_EVENTS = [
  "SIGINT",
  "SIGTERM",
  "rejectionHandled",
  "uncaughtException",
  "unhandledRejection",
] as const;

type UtoopackSessionEvent = (typeof UTOOPACK_SESSION_EVENTS)[number];
type ProcessExit = NodeJS.Process["exit"];
type ProcessListener = Parameters<NodeJS.Process["removeListener"]>[1];
type RawProcessListener = ReturnType<NodeJS.Process["rawListeners"]>[number];

interface UtoopackSessionProcess {
  exit: ProcessExit;
  rawListeners(event: UtoopackSessionEvent): RawProcessListener[];
  removeListener(
    event: UtoopackSessionEvent,
    listener: ProcessListener,
  ): unknown;
}

export interface UtoopackReusableSessionLifecycle {
  /**
   * Runs Utoopack's own SIGTERM cleanup and resolves when its final
   * `process.exit(0)` confirms that Project, cache lock, and server teardown
   * completed.
   */
  close(): Promise<void>;
  /** Restores process APIs and removes only listeners installed by this Session. */
  dispose(): void;
}

/**
 * Utoopack's public `serve()` API installs process-level cleanup handlers and
 * finishes a graceful shutdown by calling `process.exit()`. A long-lived
 * native-owner Worker must retain that cleanup while turning the final exit
 * into a Session boundary. Unexpected exits still terminate the owner.
 */
export function createUtoopackReusableSessionLifecycle(
  target: UtoopackSessionProcess = process,
): UtoopackReusableSessionLifecycle {
  const baselineListeners = new Map(
    UTOOPACK_SESSION_EVENTS.map((event) => [event, target.rawListeners(event)]),
  );
  const originalExit = target.exit;
  let closeRequested = false;
  let disposed = false;
  let closePromise: Promise<void> | undefined;
  let resolveClose: (() => void) | undefined;
  let rejectClose: ((error: Error) => void) | undefined;

  const interceptedExit = ((code) => {
    if (!closeRequested) {
      return originalExit.call(target, code);
    }

    const exitCode = code === undefined || code === null ? 0 : Number(code);
    if (exitCode === 0) {
      resolveClose?.();
    } else {
      rejectClose?.(
        new Error(
          `[evjs] Utoopack reported exit code ${String(code)} while closing its development Session.`,
        ),
      );
    }
    return undefined as never;
  }) as ProcessExit;
  target.exit = interceptedExit;

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (target.exit === interceptedExit) target.exit = originalExit;
    removeSessionListeners(target, baselineListeners);
  }

  return {
    close() {
      closePromise ??= (async () => {
        const shutdownListeners = getSessionListeners(
          target,
          baselineListeners,
          "SIGTERM",
        );
        if (shutdownListeners.length === 0) {
          throw new Error(
            "[evjs] Utoopack completed serve() without installing its SIGTERM cleanup handler.",
          );
        }

        closeRequested = true;
        try {
          await new Promise<void>((resolve, reject) => {
            resolveClose = resolve;
            rejectClose = reject;
            try {
              for (const listener of shutdownListeners) {
                Reflect.apply(listener, target, []);
              }
            } catch (cause) {
              reject(
                new Error(
                  "[evjs] Utoopack threw while beginning graceful Session shutdown.",
                  { cause },
                ),
              );
            }
          });
        } finally {
          dispose();
        }
      })();
      return closePromise;
    },
    dispose,
  };
}

function getSessionListeners(
  target: UtoopackSessionProcess,
  baseline: ReadonlyMap<UtoopackSessionEvent, readonly RawProcessListener[]>,
  event: UtoopackSessionEvent,
): RawProcessListener[] {
  const remaining = [...(baseline.get(event) ?? [])];
  const sessionListeners: RawProcessListener[] = [];
  for (const listener of target.rawListeners(event)) {
    const index = remaining.indexOf(listener);
    if (index === -1) {
      sessionListeners.push(listener);
    } else {
      remaining.splice(index, 1);
    }
  }
  return sessionListeners;
}

function removeSessionListeners(
  target: UtoopackSessionProcess,
  baseline: ReadonlyMap<UtoopackSessionEvent, readonly RawProcessListener[]>,
): void {
  for (const event of UTOOPACK_SESSION_EVENTS) {
    const remaining = [...(baseline.get(event) ?? [])];
    for (const listener of target.rawListeners(event)) {
      const index = remaining.indexOf(listener);
      if (index !== -1) {
        remaining.splice(index, 1);
        continue;
      }
      target.removeListener(event, listener as ProcessListener);
    }
  }
}
