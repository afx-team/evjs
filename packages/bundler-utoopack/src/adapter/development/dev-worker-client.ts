import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import type { DevServerReadyContext, PathRewrite } from "@utoo/pack";
import { markUtoopackProcessForDev } from "./dev-process-mode.js";
import {
  PATH_REWRITE_BUFFER_BYTES,
  PATH_REWRITE_HEADER_INTS,
  type UtoopackDevWorkerCommand,
  type UtoopackDevWorkerMessage,
  type UtoopackDevWorkerOptions,
  type UtoopackDevWorkerSessionOptions,
} from "./dev-worker-protocol.js";

const PROCESS_NATIVE_OWNER_KEY = Symbol.for(
  "@evjs/bundler-utoopack/process-native-owner",
);
const PROCESS_NATIVE_OWNER = "@evjs/bundler-utoopack";
const DEV_WORKER_CLOSE_TIMEOUT_MS = 10_000;
const require = createRequire(import.meta.url);
const UTOOPACK_NATIVE_BINDING_PATH = require.resolve(
  "@utoo/pack/cjs/binding.js",
);
const DEFAULT_NATIVE_OWNER_WORKER_URL = new URL(
  "./dev-worker.js",
  import.meta.url,
);

interface PreparedWorkerOptions {
  workerOptions: UtoopackDevWorkerSessionOptions;
  pathRewriteFunctions: ReadonlyMap<
    number,
    Extract<PathRewrite, (path: string) => string>
  >;
}

interface UtoopackDevSessionRecord {
  id: number;
  prepared: PreparedWorkerOptions;
  closeTimeoutMs: number;
  closing: boolean;
  closePosted: boolean;
  startPosted: boolean;
  readySettled: boolean;
  doneSettled: boolean;
  failureReason: unknown;
  ready: Promise<UtoopackDevWorkerReadyContext>;
  resolveReady(context: UtoopackDevWorkerReadyContext): void;
  rejectReady(error: unknown): void;
  done: Promise<void>;
  resolveDone(): void;
  rejectDone(error: unknown): void;
  closePromise: Promise<void> | undefined;
}

interface UtoopackNativeOwnerGlobalState {
  owner: typeof PROCESS_NATIVE_OWNER;
  workerUrl: string;
  instance: UtoopackNativeOwner;
}

type NativeOwnerGlobal = typeof globalThis & {
  [PROCESS_NATIVE_OWNER_KEY]?: UtoopackNativeOwnerGlobalState;
};

export interface UtoopackDevWorkerReadyContext extends DevServerReadyContext {
  spaHistoryFallbackUpdated: boolean;
}

export interface UtoopackDevWorkerHandle {
  ready: Promise<UtoopackDevWorkerReadyContext>;
  /** Resolves when this Session closes; the native-owner Worker remains idle. */
  done: Promise<void>;
  /** Rejects on failure and remains pending after a successful Session close. */
  failure: Promise<never>;
  throwIfFailed(): void;
  close(): Promise<void>;
}

/**
 * Start one immutable dev Session inside the process's long-lived native-owner
 * Worker. The owner exclusively loads Utoopack's addon, registers its loader
 * scheduler, and creates every sequential Project. Function-valued proxy
 * rewrites remain in the host and cross a bounded SharedArrayBuffer bridge.
 */
export function startUtoopackDevWorker(
  options: UtoopackDevWorkerOptions,
  workerUrl = DEFAULT_NATIVE_OWNER_WORKER_URL,
  closeTimeoutMs = DEV_WORKER_CLOSE_TIMEOUT_MS,
): UtoopackDevWorkerHandle {
  if (workerUrl.href === DEFAULT_NATIVE_OWNER_WORKER_URL.href) {
    assertHostDoesNotOwnUtoopackBinding();
  }
  const prepared = prepareUtoopackDevWorkerOptions(options);
  return getOrCreateNativeOwner(workerUrl).start(prepared, closeTimeoutMs);
}

function assertHostDoesNotOwnUtoopackBinding(): void {
  if (require.cache[UTOOPACK_NATIVE_BINDING_PATH] === undefined) return;
  throw new Error(
    "[evjs] Utoopack dev cannot establish single native ownership because the host process already loaded @utoo/pack's native binding. Run build and dev as separate commands and remove host-side @utoo/pack runtime imports.",
  );
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
  const candidate: UtoopackDevWorkerSessionOptions = {
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
      "[evjs] Utoopack development config must be structured-cloneable so its native Project can run in the long-lived owner Worker. Remove non-cloneable values contributed through configureBundler().",
      { cause: error },
    );
  }
}

class UtoopackNativeOwner {
  readonly worker: Worker;
  private readonly ownerReady: Promise<void>;
  private readonly exited: Promise<number>;
  private activeSession: UtoopackDevSessionRecord | undefined;
  private failureReason: unknown;
  private nextSessionId = 1;
  private ownerReadySettled = false;
  private workerExited = false;
  private disposing = false;
  private resolveOwnerReady!: () => void;
  private rejectOwnerReady!: (error: unknown) => void;
  private resolveExit!: (code: number) => void;

  constructor(readonly workerUrl: URL) {
    markUtoopackProcessForDev();
    this.ownerReady = new Promise<void>((resolve, reject) => {
      this.resolveOwnerReady = resolve;
      this.rejectOwnerReady = reject;
    });
    void this.ownerReady.catch(() => {});
    this.exited = new Promise<number>((resolve) => {
      this.resolveExit = resolve;
    });
    this.worker = new Worker(workerUrl, {
      env: {
        ...process.env,
        NODE_ENV: "development",
      },
    });
    this.worker.unref();
    this.worker.on("message", (message: UtoopackDevWorkerMessage) => {
      this.handleMessage(message);
    });
    this.worker.once("error", (error) => this.failOwner(error));
    this.worker.once("exit", (code) => {
      this.workerExited = true;
      this.resolveExit(code);
      if (this.disposing) return;
      this.failOwner(this.createOwnerExitError(code));
    });
  }

  start(
    prepared: PreparedWorkerOptions,
    closeTimeoutMs: number,
  ): UtoopackDevWorkerHandle {
    this.throwIfFailed();
    if (this.activeSession) {
      throw new Error(
        `[evjs] Utoopack Session ${this.activeSession.id} must close before another Session can claim the native owner.`,
      );
    }

    const session = createSessionRecord(
      this.nextSessionId++,
      prepared,
      closeTimeoutMs,
    );
    this.activeSession = session;
    this.worker.ref();
    void this.ownerReady.then(
      () => {
        if (this.activeSession !== session || session.doneSettled) return;
        this.postStart(session);
        if (session.closing) this.postClose(session);
      },
      (error) => this.failOwner(error),
    );

    const failure = session.done.then<never>(
      () => new Promise<never>(() => {}),
      (error) => Promise.reject(error),
    );
    void failure.catch(() => {});

    return {
      ready: session.ready,
      done: session.done,
      failure,
      throwIfFailed: () => {
        if (session.failureReason !== undefined) throw session.failureReason;
        this.throwIfFailed();
      },
      close: () => this.closeSession(session),
    };
  }

  async dispose(): Promise<void> {
    if (this.workerExited) return;
    this.disposing = true;
    const error = new Error("[evjs] Utoopack native owner was disposed.");
    if (this.activeSession) this.failSession(this.activeSession, error);
    await this.worker.terminate();
    await this.exited;
  }

  private handleMessage(message: UtoopackDevWorkerMessage): void {
    if (message.type === "owner-ready") {
      if (this.ownerReadySettled) {
        void this.terminateWithFailure(
          new Error("[evjs] Utoopack native owner reported readiness twice."),
        );
        return;
      }
      this.ownerReadySettled = true;
      this.resolveOwnerReady();
      return;
    }
    if (message.type === "owner-error") {
      this.failOwner(createWorkerMessageError(message));
      return;
    }

    const session = this.activeSession;
    if (!session || session.id !== message.sessionId) {
      if (message.type === "path-rewrite") {
        publishPathRewriteResult(
          message.shared,
          2,
          `[evjs] Utoopack requested pathRewrite for inactive Session ${message.sessionId}.`,
        );
      }
      void this.terminateWithFailure(
        new Error(
          `[evjs] Utoopack native owner sent ${message.type} for inactive Session ${message.sessionId}.`,
        ),
      );
      return;
    }

    if (message.type === "path-rewrite") {
      executePathRewrite(session.prepared.pathRewriteFunctions, message);
      return;
    }
    if (message.type === "session-error") {
      this.failOwner(createWorkerMessageError(message));
      return;
    }
    if (message.type === "ready") {
      if (session.readySettled) {
        void this.terminateWithFailure(
          new Error(
            `[evjs] Utoopack Session ${session.id} reported readiness twice.`,
          ),
        );
        return;
      }
      session.readySettled = true;
      session.resolveReady({
        ...message.context,
        spaHistoryFallbackUpdated: message.spaHistoryFallbackUpdated,
      });
      return;
    }
    if (!session.closing) {
      void this.terminateWithFailure(
        new Error(
          `[evjs] Utoopack Session ${session.id} closed without a host shutdown request.`,
        ),
      );
      return;
    }
    session.doneSettled = true;
    session.resolveDone();
    this.activeSession = undefined;
    this.worker.unref();
  }

  private postStart(session: UtoopackDevSessionRecord): void {
    if (session.startPosted) return;
    session.startPosted = true;
    this.postMessage({
      type: "start",
      sessionId: session.id,
      options: session.prepared.workerOptions,
    });
  }

  private postClose(session: UtoopackDevSessionRecord): void {
    if (session.closePosted || !session.startPosted) return;
    session.closePosted = true;
    this.postMessage({ type: "close", sessionId: session.id });
  }

  private postMessage(message: UtoopackDevWorkerCommand): void {
    try {
      this.worker.postMessage(message);
    } catch (error) {
      void this.terminateWithFailure(error);
    }
  }

  private closeSession(session: UtoopackDevSessionRecord): Promise<void> {
    session.closePromise ??= (async () => {
      const failureBeforeClose = session.failureReason ?? this.failureReason;
      session.closing = true;
      if (session.startPosted) this.postClose(session);

      try {
        await waitForSessionClose(session.done, session.closeTimeoutMs);
      } catch (error) {
        if (failureBeforeClose !== undefined) return;
        if (error instanceof UtoopackSessionCloseTimeoutError) {
          await this.terminateWithFailure(error);
        }
        throw error;
      }

      if (
        failureBeforeClose === undefined &&
        session.failureReason !== undefined
      ) {
        throw session.failureReason;
      }
    })();
    return session.closePromise;
  }

  private failOwner(cause: unknown): void {
    if (this.failureReason !== undefined || this.disposing) return;
    const error = normalizeError(cause);
    this.failureReason = error;
    if (!this.ownerReadySettled) {
      this.ownerReadySettled = true;
      this.rejectOwnerReady(error);
    }
    if (this.activeSession) {
      this.failSession(this.activeSession, error);
      this.activeSession = undefined;
    }
    this.worker.unref();
  }

  private failSession(session: UtoopackDevSessionRecord, error: unknown): void {
    if (session.failureReason === undefined) session.failureReason = error;
    if (!session.readySettled) {
      session.readySettled = true;
      session.rejectReady(error);
    }
    if (!session.doneSettled) {
      session.doneSettled = true;
      session.rejectDone(error);
    }
  }

  private async terminateWithFailure(cause: unknown): Promise<void> {
    this.failOwner(cause);
    if (!this.workerExited) await this.worker.terminate();
    await this.exited;
  }

  private throwIfFailed(): void {
    if (this.failureReason !== undefined) throw this.failureReason;
  }

  private createOwnerExitError(code: number): Error {
    const session = this.activeSession;
    if (!session) {
      return new Error(
        `[evjs] Utoopack native-owner Worker exited unexpectedly with code ${code}. Restart ev dev.`,
      );
    }
    if (session.closing) {
      return new Error(
        `[evjs] Utoopack native-owner Worker exited with code ${code} before confirming Session ${session.id} shutdown.`,
      );
    }
    if (session.readySettled) {
      return new Error(
        `[evjs] Utoopack native-owner Worker exited unexpectedly with code ${code} during Session ${session.id}.`,
      );
    }
    return new Error(
      `[evjs] Utoopack native-owner Worker exited before Session ${session.id} readiness with code ${code}.`,
    );
  }
}

function getOrCreateNativeOwner(workerUrl: URL): UtoopackNativeOwner {
  const ownerGlobal = globalThis as NativeOwnerGlobal;
  const current = ownerGlobal[PROCESS_NATIVE_OWNER_KEY];
  if (current) {
    if (
      current.owner !== PROCESS_NATIVE_OWNER ||
      current.workerUrl !== workerUrl.href
    ) {
      throw new Error(
        `[evjs] Utoopack native ownership is already held by an incompatible Worker (${current.workerUrl}). Restart ev dev with one adapter installation.`,
      );
    }
    return current.instance;
  }

  const instance = new UtoopackNativeOwner(workerUrl);
  ownerGlobal[PROCESS_NATIVE_OWNER_KEY] = {
    owner: PROCESS_NATIVE_OWNER,
    workerUrl: workerUrl.href,
    instance,
  };
  return instance;
}

function createSessionRecord(
  id: number,
  prepared: PreparedWorkerOptions,
  closeTimeoutMs: number,
): UtoopackDevSessionRecord {
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
  void ready.catch(() => {});
  void done.catch(() => {});
  return {
    id,
    prepared,
    closeTimeoutMs,
    closing: false,
    closePosted: false,
    startPosted: false,
    readySettled: false,
    doneSettled: false,
    failureReason: undefined,
    ready,
    resolveReady,
    rejectReady,
    done,
    resolveDone,
    rejectDone,
    closePromise: undefined,
  };
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

function createWorkerMessageError(
  message: Extract<
    UtoopackDevWorkerMessage,
    { type: "owner-error" | "session-error" }
  >,
): Error {
  const error = new Error(message.message);
  if (message.stack) error.stack = message.stack;
  return error;
}

function normalizeError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

class UtoopackSessionCloseTimeoutError extends Error {}

function waitForSessionClose(
  done: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutError = new UtoopackSessionCloseTimeoutError(
    `[evjs] Timed out after ${timeoutMs}ms while waiting for the Utoopack native owner to release its Session resources. Restart ev dev to recover safely.`,
  );
  return Promise.race([
    done,
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(timeoutError), timeoutMs);
      timeout.unref();
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export const __testing = {
  getNativeOwnerThreadId(): number | undefined {
    return (globalThis as NativeOwnerGlobal)[PROCESS_NATIVE_OWNER_KEY]?.instance
      .worker.threadId;
  },
  async disposeNativeOwner(): Promise<void> {
    const ownerGlobal = globalThis as NativeOwnerGlobal;
    const state = ownerGlobal[PROCESS_NATIVE_OWNER_KEY];
    delete ownerGlobal[PROCESS_NATIVE_OWNER_KEY];
    await state?.instance.dispose();
  },
};
