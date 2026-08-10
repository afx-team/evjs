export type UtoopackDevWorkerCommand = { type: "close" };

export type UtoopackDevWorkerLifecycleMessage = { type: "close-accepted" };

interface UtoopackDevWorkerShutdownPort {
  on(
    event: "message",
    listener: (message: UtoopackDevWorkerCommand) => void,
  ): unknown;
  postMessage(message: UtoopackDevWorkerLifecycleMessage): void;
}

interface ProcessSignalTarget {
  on(event: "newListener", listener: (event: string | symbol) => void): unknown;
  emit(event: "SIGTERM"): boolean;
}

/**
 * @utoo/pack owns its native project, persistent-cache lock, and HTTP server
 * behind process signal handlers. Terminating the worker thread skips that
 * cleanup and leaves the process-wide cache lock held. Forward the host close
 * request through Utoopack's SIGTERM handler and acknowledge only when that
 * handler is installed.
 */
export function installUtoopackGracefulShutdownBridge(
  port: UtoopackDevWorkerShutdownPort | null,
  signalTarget: ProcessSignalTarget = process,
): void {
  let shutdownRequested = false;
  let shutdownHandlerInstalled = false;

  function emitShutdown() {
    if (!shutdownRequested || !shutdownHandlerInstalled) return;
    shutdownRequested = false;
    port?.postMessage({ type: "close-accepted" });
    signalTarget.emit("SIGTERM");
  }

  // Utoopack registers its cleanup listener only after the server is ready.
  // Observe that exact registration so an early close request cannot emit the
  // synthetic signal before project.shutdown() is reachable.
  signalTarget.on("newListener", function onNewListener(event) {
    if (event !== "SIGTERM" || shutdownHandlerInstalled) return;
    queueMicrotask(() => {
      shutdownHandlerInstalled = true;
      emitShutdown();
    });
  });

  port?.on("message", function onMessage(message) {
    if (message?.type !== "close" || shutdownRequested) return;
    shutdownRequested = true;
    emitShutdown();
  });
}
