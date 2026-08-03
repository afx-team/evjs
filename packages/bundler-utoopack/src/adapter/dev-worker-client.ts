import fs from "node:fs";
import { Worker } from "node:worker_threads";
import type {
  ConfigComplete,
  DevServerReadyContext,
  PathRewrite,
} from "@utoo/pack";

const PATH_REWRITE_HEADER_INTS = 3;
const PATH_REWRITE_BUFFER_BYTES = 256 * 1024;

interface UtoopackDevWorkerOptions {
  cwd: string;
  config: ConfigComplete;
  spaHistoryFallbackRuleIndex?: number;
  server: {
    port: number;
    https: boolean;
    hostname: string;
    logServerInfo: boolean;
  };
}

interface PreparedWorkerOptions {
  workerOptions: UtoopackDevWorkerOptions & {
    pathRewriteFunctionIndexes: number[];
  };
  pathRewriteFunctions: ReadonlyMap<
    number,
    Extract<PathRewrite, (path: string) => string>
  >;
}

export interface UtoopackDevWorkerReadyContext extends DevServerReadyContext {
  spaHistoryFallbackUpdated: boolean;
}

type UtoopackDevWorkerMessage =
  | {
      type: "ready";
      context: DevServerReadyContext;
      spaHistoryFallbackUpdated: boolean;
    }
  | { type: "error"; message: string; stack?: string }
  | {
      type: "path-rewrite";
      ruleIndex: number;
      path: string;
      shared: SharedArrayBuffer;
    };

export interface UtoopackDevWorkerHandle {
  ready: Promise<UtoopackDevWorkerReadyContext>;
  /** Rejects whenever the worker exits before `close()` is requested. */
  done: Promise<void>;
  /** Rejects on unexpected exit and remains pending after an intentional close. */
  failure: Promise<never>;
  throwIfFailed(): void;
  /** Notify the persistent compiler after Core finishes generated input. */
  invalidate(files: readonly string[]): Promise<void>;
  close(): Promise<void>;
}

/**
 * Isolate Utoopack's process-owned dev server so the adapter can always stop
 * it. Function-valued public proxy rewrites remain in the host and are invoked
 * synchronously over a bounded SharedArrayBuffer bridge.
 */
export function startUtoopackDevWorker(
  options: UtoopackDevWorkerOptions,
  workerUrl = new URL("./dev-worker.js", import.meta.url),
): UtoopackDevWorkerHandle {
  const prepared = prepareUtoopackDevWorkerOptions(options);
  const worker = new Worker(workerUrl, {
    workerData: prepared.workerOptions,
  });
  let closing = false;
  let failureReason: unknown;
  let readySettled = false;
  let resolveReady!: (context: UtoopackDevWorkerReadyContext) => void;
  let rejectReady!: (error: unknown) => void;
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const ready = new Promise<UtoopackDevWorkerReadyContext>(
    (resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    },
  );
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // Consumers attach the lifecycle race after startup completes. Keep an
  // early failure from becoming an unhandled rejection in that interval.
  void done.catch(() => {});
  const failure = done.then<never>(
    () => new Promise<never>(() => {}),
    (error) => Promise.reject(error),
  );
  void failure.catch(() => {});

  worker.on("message", (message: UtoopackDevWorkerMessage) => {
    if (message.type === "ready") {
      readySettled = true;
      resolveReady({
        ...message.context,
        spaHistoryFallbackUpdated: message.spaHistoryFallbackUpdated,
      });
      return;
    }
    if (message.type === "path-rewrite") {
      executePathRewrite(prepared.pathRewriteFunctions, message);
      return;
    }
    const error = createWorkerError(message);
    failureReason = error;
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    rejectDone(error);
  });
  worker.once("error", (error) => {
    failureReason = error;
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    rejectDone(error);
  });
  worker.once("exit", (code) => {
    if (closing) {
      resolveDone();
      return;
    }
    const error = new Error(
      readySettled
        ? `[evjs] Utoopack development worker exited unexpectedly with code ${code}.`
        : `[evjs] Utoopack development worker exited before readiness with code ${code}.`,
    );
    failureReason = error;
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    rejectDone(error);
  });

  let closePromise: Promise<void> | undefined;
  return {
    ready,
    done,
    failure,
    throwIfFailed() {
      if (failureReason !== undefined) throw failureReason;
    },
    async invalidate(files) {
      for (const file of new Set(files)) {
        const stats = await fs.promises.stat(file);
        const nextMtimeMs = Math.max(Date.now() + 1_000, stats.mtimeMs + 1_000);
        await fs.promises.utimes(file, stats.atime, new Date(nextMtimeMs));
      }
    },
    close() {
      closePromise ??= (async () => {
        closing = true;
        await worker.terminate();
        // `done` is observed by startup/the orchestrator. Do not report the
        // same unexpected-exit rejection again as a cleanup failure.
        await done.catch(() => {});
      })();
      return closePromise;
    },
  };
}

export function prepareUtoopackDevWorkerOptions(
  options: UtoopackDevWorkerOptions,
): PreparedWorkerOptions {
  const pathRewriteFunctions = new Map<
    number,
    Extract<PathRewrite, (path: string) => string>
  >();
  const proxy = options.config.devServer?.proxy;
  const serializableProxy = proxy?.map((rule, index) => {
    if (typeof rule.pathRewrite !== "function") return rule;
    pathRewriteFunctions.set(index, rule.pathRewrite);
    const { pathRewrite: _pathRewrite, ...serializableRule } = rule;
    return serializableRule;
  });
  const candidate = {
    ...options,
    config: serializableProxy
      ? {
          ...options.config,
          devServer: {
            ...options.config.devServer,
            proxy: serializableProxy,
          },
        }
      : options.config,
    pathRewriteFunctionIndexes: [...pathRewriteFunctions.keys()],
  };

  try {
    return {
      workerOptions: structuredClone(candidate),
      pathRewriteFunctions,
    };
  } catch (error) {
    throw new Error(
      "[evjs] Utoopack development config must be structured-cloneable so its process-owned server can run in an isolated, stoppable worker. Remove non-cloneable values contributed through configureBundler().",
      { cause: error },
    );
  }
}

function executePathRewrite(
  functions: ReadonlyMap<
    number,
    Extract<PathRewrite, (path: string) => string>
  >,
  message: Extract<UtoopackDevWorkerMessage, { type: "path-rewrite" }>,
): void {
  try {
    const rewrite = functions.get(message.ruleIndex);
    if (!rewrite) {
      throw new Error(
        `[evjs] Utoopack requested unknown proxy pathRewrite rule ${message.ruleIndex}.`,
      );
    }
    const result = rewrite(message.path);
    if (typeof result !== "string") {
      throw new Error(
        `[evjs] dev.proxy[${message.ruleIndex}].pathRewrite must return a string synchronously.`,
      );
    }
    publishPathRewriteResult(message.shared, 1, result);
  } catch (error) {
    publishPathRewriteResult(
      message.shared,
      2,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function publishPathRewriteResult(
  shared: SharedArrayBuffer,
  status: 1 | 2,
  value: string,
): void {
  const header = new Int32Array(shared, 0, PATH_REWRITE_HEADER_INTS);
  const payload = new Uint8Array(
    shared,
    PATH_REWRITE_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT,
  );
  let encoded = new TextEncoder().encode(value);
  if (encoded.byteLength > payload.byteLength) {
    status = 2;
    encoded = new TextEncoder().encode(
      `[evjs] Proxy pathRewrite result exceeds ${PATH_REWRITE_BUFFER_BYTES} bytes.`,
    );
  }
  payload.set(encoded);
  Atomics.store(header, 1, status);
  Atomics.store(header, 2, encoded.byteLength);
  Atomics.store(header, 0, 1);
  Atomics.notify(header, 0);
}

function createWorkerError(
  message: Extract<UtoopackDevWorkerMessage, { type: "error" }>,
): Error {
  const error = new Error(message.message);
  if (message.stack) error.stack = message.stack;
  return error;
}
