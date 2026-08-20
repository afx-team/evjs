import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

const require = createRequire(import.meta.url);
const PROCESS_SCHEDULER_KEY = Symbol.for(
  "@evjs/bundler-utoopack/process-worker-scheduler",
);
const PROCESS_BUILD_KEY = Symbol.for(
  "@evjs/bundler-utoopack/process-build-runtime",
);
const PROCESS_SCHEDULER_OWNER = "@evjs/bundler-utoopack";

type UtoopackNativeBinding = typeof import("@utoo/pack/cjs/binding.js");
interface UtoopackWorkerSchedulerBinding {
  registerWorkerScheduler?: UtoopackNativeBinding["registerWorkerScheduler"];
}
type UtoopackWorkerCreation = Parameters<
  Parameters<UtoopackNativeBinding["registerWorkerScheduler"]>[0]
>[0];
type UtoopackWorkerTermination = Parameters<
  Parameters<UtoopackNativeBinding["registerWorkerScheduler"]>[1]
>[0];
export interface UtoopackProcessWorkerScheduler {
  readonly bindingPath: string;
  /** Rejects if the process-owned loader pool becomes unusable. */
  readonly failure: Promise<never>;
  throwIfFailed(): void;
}

interface LoaderWorkerRecord {
  worker: Worker;
  workerId: number;
  terminating: boolean;
}

interface UtoopackProcessWorkerSchedulerState
  extends UtoopackProcessWorkerScheduler {
  owner: typeof PROCESS_SCHEDULER_OWNER;
  registration: Promise<void>;
  failureReason: Error | undefined;
  rejectFailure(error: Error): void;
  workers: Map<string, Map<number, LoaderWorkerRecord>>;
}

type SchedulerGlobal = typeof globalThis & {
  [PROCESS_SCHEDULER_KEY]?: UtoopackProcessWorkerSchedulerState;
  [PROCESS_BUILD_KEY]?: true;
};

/**
 * Turbopack's loader-worker scheduler is a native process singleton. Own its
 * JavaScript callbacks in the long-lived adapter realm so immutable dev
 * Session workers can be replaced without registering stale callbacks.
 *
 * The native loader pool is process-wide too: workers may be reused by later
 * dev Projects and remain in development mode for this process's lifetime.
 */
export async function ensureUtoopackProcessWorkerScheduler(): Promise<UtoopackProcessWorkerScheduler> {
  const bindingPath = require.resolve("@utoo/pack/cjs/binding.js");
  const schedulerGlobal = globalThis as SchedulerGlobal;
  if (schedulerGlobal[PROCESS_BUILD_KEY]) {
    throw new Error(
      "[evjs] Utoopack dev cannot run in a process that already hosted build. Run build and dev as separate commands.",
    );
  }
  let scheduler = schedulerGlobal[PROCESS_SCHEDULER_KEY];

  if (scheduler) {
    assertMatchingScheduler(scheduler, bindingPath);
    await scheduler.registration;
    scheduler.throwIfFailed();
    return scheduler;
  }

  scheduler = createSchedulerState(bindingPath);
  schedulerGlobal[PROCESS_SCHEDULER_KEY] = scheduler;
  scheduler.registration = registerProcessWorkerScheduler(scheduler);
  void scheduler.registration.catch(() => {});

  await scheduler.registration;
  scheduler.throwIfFailed();
  return scheduler;
}

/**
 * A native loader pool cannot safely change from dev to build semantics in
 * place because existing loader workers retain their original environment.
 */
export function markUtoopackProcessForBuild(): void {
  const schedulerGlobal = globalThis as SchedulerGlobal;
  const scheduler = schedulerGlobal[PROCESS_SCHEDULER_KEY];
  if (scheduler) {
    throw new Error(
      "[evjs] Utoopack build cannot run in a process that already hosted dev. Run build and dev as separate commands.",
    );
  }
  schedulerGlobal[PROCESS_BUILD_KEY] = true;
}

/**
 * ProjectImpl registers the loader scheduler when the binding export is a
 * function. The host already owns that process-global registration, so hide
 * only this Session realm's duplicate entry point before loading @utoo/pack.
 */
export function delegateUtoopackWorkerSchedulerToHost(
  expectedBindingPath: string,
): void {
  const bindingPath = require.resolve("@utoo/pack/cjs/binding.js");
  if (bindingPath !== expectedBindingPath) {
    throw new Error(
      `[evjs] Utoopack worker resolved a different native binding than its process scheduler (${bindingPath} !== ${expectedBindingPath}). Restart ev dev with a single @utoo/pack installation.`,
    );
  }
  const binding = require(bindingPath) as UtoopackWorkerSchedulerBinding;
  binding.registerWorkerScheduler = undefined;
}

function createSchedulerState(
  bindingPath: string,
): UtoopackProcessWorkerSchedulerState {
  let rejectFailure!: (error: Error) => void;
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  void failure.catch(() => {});

  const scheduler: UtoopackProcessWorkerSchedulerState = {
    owner: PROCESS_SCHEDULER_OWNER,
    bindingPath,
    registration: Promise.resolve(),
    failure,
    failureReason: undefined,
    rejectFailure(error) {
      if (scheduler.failureReason !== undefined) return;
      scheduler.failureReason = error;
      rejectFailure(error);
    },
    throwIfFailed() {
      if (scheduler.failureReason !== undefined) {
        throw scheduler.failureReason;
      }
    },
    workers: new Map(),
  };
  return scheduler;
}

async function registerProcessWorkerScheduler(
  scheduler: UtoopackProcessWorkerSchedulerState,
): Promise<void> {
  const binding = require(
    scheduler.bindingPath,
  ) as UtoopackWorkerSchedulerBinding;
  if (typeof binding.registerWorkerScheduler !== "function") {
    const error = new Error(
      "[evjs] Utoopack's native worker scheduler was delegated before EVJS established process ownership. Restart the current command in a fresh process.",
    );
    scheduler.rejectFailure(error);
    throw error;
  }

  try {
    binding.registerWorkerScheduler(
      (creation) => createLoaderWorker(scheduler, creation),
      (termination) => terminateLoaderWorker(scheduler, termination),
    );
    // Adapter-owned host Projects must skip Utoopack's realm-local scheduler
    // registration just like outer dev Session workers do.
    binding.registerWorkerScheduler = undefined;
  } catch (cause) {
    const error = new Error(
      "[evjs] Unable to establish the Utoopack process worker scheduler. Restart the current command in a fresh process.",
      { cause },
    );
    scheduler.rejectFailure(error);
    throw error;
  }
}

function createLoaderWorker(
  scheduler: UtoopackProcessWorkerSchedulerState,
  creation: UtoopackWorkerCreation,
): void {
  scheduler.throwIfFailed();
  const filename = String(creation.options.filename);
  const cwd = String(creation.options.cwd);
  const poolId = getPoolId(cwd, filename);

  let worker: Worker;
  try {
    worker = new Worker(filename, {
      workerData: {
        bindingPath: scheduler.bindingPath,
        cwd,
      },
      env: {
        ...process.env,
        NODE_ENV: "development",
      },
    });
  } catch (cause) {
    const error = createLoaderWorkerError("create", cwd, filename, cause);
    scheduler.rejectFailure(error);
    throw error;
  }

  worker.unref();
  const workerId = worker.threadId;
  const workers = scheduler.workers.get(poolId) ?? new Map();
  scheduler.workers.set(poolId, workers);
  const record: LoaderWorkerRecord = {
    worker,
    workerId,
    terminating: false,
  };
  workers.set(workerId, record);

  worker.once("error", (cause) => {
    if (record.terminating) return;
    scheduler.rejectFailure(
      createLoaderWorkerError("run", cwd, filename, cause),
    );
  });
  worker.once("exit", (code) => {
    removeLoaderWorker(scheduler, poolId, record);
    if (!record.terminating) {
      scheduler.rejectFailure(
        new Error(
          `[evjs] Utoopack loader worker exited unexpectedly with code ${code} (${filename}, cwd ${cwd}). Restart the current command.`,
        ),
      );
    }
  });
}

function terminateLoaderWorker(
  scheduler: UtoopackProcessWorkerSchedulerState,
  termination: UtoopackWorkerTermination,
): void {
  const filename = String(termination.options.filename);
  const cwd = String(termination.options.cwd);
  const poolId = getPoolId(cwd, filename);
  const record = scheduler.workers.get(poolId)?.get(termination.workerId);
  if (!record || record.terminating) return;

  record.terminating = true;
  void record.worker.terminate().catch((cause) => {
    scheduler.rejectFailure(
      createLoaderWorkerError("terminate", cwd, filename, cause),
    );
  });
}

function removeLoaderWorker(
  scheduler: UtoopackProcessWorkerSchedulerState,
  poolId: string,
  record: LoaderWorkerRecord,
): void {
  const workers = scheduler.workers.get(poolId);
  if (workers?.get(record.workerId) !== record) return;
  workers.delete(record.workerId);
  if (workers.size === 0) scheduler.workers.delete(poolId);
}

function createLoaderWorkerError(
  action: "create" | "run" | "terminate",
  cwd: string,
  filename: string,
  cause: unknown,
): Error {
  return new Error(
    `[evjs] Failed to ${action} Utoopack loader worker (${filename}, cwd ${cwd}). Restart the current command.`,
    { cause },
  );
}

function getPoolId(cwd: string, filename: string): string {
  return `${cwd}:${filename}`;
}

function assertMatchingScheduler(
  scheduler: UtoopackProcessWorkerSchedulerState,
  bindingPath: string,
): void {
  if (
    scheduler.owner !== PROCESS_SCHEDULER_OWNER ||
    scheduler.bindingPath !== bindingPath
  ) {
    throw new Error(
      `[evjs] Utoopack's process worker scheduler is already owned by an incompatible runtime (${scheduler.bindingPath}). Restart with a single @utoo/pack installation.`,
    );
  }
}

export const __testing = {
  createLoaderWorker(
    scheduler: UtoopackProcessWorkerScheduler,
    options: { cwd: string; filename: string },
  ): void {
    createLoaderWorker(
      scheduler as UtoopackProcessWorkerSchedulerState,
      { options } as UtoopackWorkerCreation,
    );
  },
  getLoaderWorkerCount(scheduler: UtoopackProcessWorkerScheduler): number {
    let count = 0;
    for (const workers of (
      scheduler as UtoopackProcessWorkerSchedulerState
    ).workers.values()) {
      count += workers.size;
    }
    return count;
  },
};
