import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";
import type { DevServerReadyContext } from "@utoo/pack";
import { runUtoopackDevServer } from "../execution/utoopack.js";
import {
  PATH_REWRITE_BUFFER_BYTES,
  PATH_REWRITE_HEADER_INTS,
  PATH_REWRITE_TIMEOUT_MS,
  type UtoopackDevWorkerCommand,
  type UtoopackDevWorkerMessage,
  type UtoopackDevWorkerSessionOptions,
} from "./dev-worker-protocol.js";
import {
  ensureUtoopackProcessWorkerScheduler,
  type UtoopackProcessWorkerScheduler,
} from "./dev-worker-scheduler.js";
import {
  createUtoopackReusableSessionLifecycle,
  type UtoopackReusableSessionLifecycle,
} from "./dev-worker-shutdown.js";
import {
  createUtoopackClientDevConfig,
  startUtoopackServerProject,
} from "./server-project.js";

interface ActiveSession {
  id: number;
  lifecycle: UtoopackReusableSessionLifecycle;
  options: UtoopackDevWorkerSessionOptions;
  serverProject?: Awaited<ReturnType<typeof startUtoopackServerProject>>;
  closing: boolean;
  nextBuildId: number;
  publication?: {
    id: number;
    resolve(): void;
    reject(error: Error): void;
  };
}

type UtoopackDevRuntime = Pick<typeof import("@utoo/pack"), "serve">;

const require = createRequire(import.meta.url);
const port = requireParentPort();

let activeSession: ActiveSession | undefined;
let ownerExiting = false;
let runtime: UtoopackDevRuntime | undefined;
let commandQueue: Promise<void> = Promise.resolve();

void initializeOwner().catch((error: unknown) => failOwner(error));

async function initializeOwner(): Promise<void> {
  const scheduler = await ensureUtoopackProcessWorkerScheduler();
  observeSchedulerFailure(scheduler);

  // Loading the public runtime only after scheduler registration ensures that
  // ProjectImpl observes the owner-realm registration as already delegated.
  runtime = require("@utoo/pack") as UtoopackDevRuntime;
  port.on("message", enqueueCommand);
  postMessage({ type: "owner-ready" });
}

function observeSchedulerFailure(
  scheduler: UtoopackProcessWorkerScheduler,
): void {
  void scheduler.failure.catch((error: unknown) => failOwner(error));
}

function enqueueCommand(command: UtoopackDevWorkerCommand): void {
  // Publication acknowledgements must bypass start/close, which can themselves
  // be waiting for the current publication to finish.
  if (command.type === "server-published") {
    const session = activeSession;
    if (
      session?.id === command.sessionId &&
      session.publication?.id === command.buildId
    ) {
      if (command.error) session.publication.reject(new Error(command.error));
      else session.publication.resolve();
    }
    return;
  }
  if (command.type === "close" && activeSession?.id === command.sessionId) {
    activeSession.closing = true;
    activeSession.publication?.reject(
      new Error("[evjs] Utoopack Session closed during server publication."),
    );
  }
  commandQueue = commandQueue
    .then(() => executeCommand(command))
    .catch((error: unknown) => failOwner(error, command.sessionId));
}

async function executeCommand(
  command: Exclude<UtoopackDevWorkerCommand, { type: "server-published" }>,
): Promise<void> {
  if (ownerExiting) return;
  if (command.type === "start") {
    await startSession(command.sessionId, command.options);
    return;
  }
  await closeSession(command.sessionId);
}

async function startSession(
  sessionId: number,
  options: UtoopackDevWorkerSessionOptions,
): Promise<void> {
  if (activeSession) {
    throw new Error(
      `[evjs] Cannot start Utoopack Session ${sessionId} while Session ${activeSession.id} still owns the native Project.`,
    );
  }
  if (!runtime) {
    throw new Error(
      "[evjs] Utoopack native owner started before initialization.",
    );
  }

  const lifecycle = createUtoopackReusableSessionLifecycle();
  const session: ActiveSession = {
    id: sessionId,
    lifecycle,
    options,
    closing: false,
    nextBuildId: 0,
  };
  activeSession = session;
  installPathRewriteBridges(sessionId, options);

  if (options.config.server) {
    session.serverProject = await startUtoopackServerProject({
      cwd: options.cwd,
      config: options.config,
      onBuild: () => publishServerBuild(session),
      onError(error) {
        if (!session.closing) {
          postMessage({
            type: "server-error",
            sessionId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    });
    void session.serverProject.failure.catch((error: unknown) => {
      if (!session.closing) failOwner(error, sessionId);
    });
  }
  let readyContext: DevServerReadyContext | undefined;
  let spaHistoryFallbackUpdated = false;
  await runUtoopackDevServer(
    runtime,
    createUtoopackClientDevConfig(options.config, options.cwd),
    options.cwd,
    {
      ...options.server,
      async onReady(context: DevServerReadyContext) {
        spaHistoryFallbackUpdated = updateSpaHistoryFallback(options, context);
        readyContext = context;
      },
    },
  );

  if (!readyContext) {
    throw new Error(
      `[evjs] Utoopack Session ${sessionId} completed serve() without reporting readiness.`,
    );
  }
  postMessage({
    type: "ready",
    sessionId,
    context: readyContext,
    spaHistoryFallbackUpdated,
  });
}

async function closeSession(sessionId: number): Promise<void> {
  const session = activeSession;
  if (!session || session.id !== sessionId) {
    throw new Error(
      `[evjs] Cannot close inactive Utoopack Session ${sessionId}${session ? ` while Session ${session.id} is active` : ""}.`,
    );
  }

  const results = await Promise.allSettled([
    session.serverProject?.close(),
    session.lifecycle.close(),
  ]);
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (errors.length) {
    throw new AggregateError(
      errors,
      "[evjs] Failed to close Utoopack Session.",
    );
  }
  activeSession = undefined;
  postMessage({ type: "closed", sessionId });
}

function publishServerBuild(session: ActiveSession): Promise<void> {
  if (session.closing || activeSession !== session) return Promise.resolve();
  const buildId = ++session.nextBuildId;
  return new Promise<void>((resolve, reject) => {
    session.publication = { id: buildId, resolve, reject };
    postMessage({ type: "server-build", sessionId: session.id, buildId });
  }).finally(() => {
    if (session.publication?.id === buildId) session.publication = undefined;
  });
}

function updateSpaHistoryFallback(
  options: UtoopackDevWorkerSessionOptions,
  context: DevServerReadyContext,
): boolean {
  const ruleIndex = options.spaHistoryFallbackRuleIndex;
  if (ruleIndex === undefined) return false;
  const rule = options.config.devServer?.proxy?.[ruleIndex];
  if (!rule) return false;
  const protocol = options.server.https ? "https" : "http";
  const hostname =
    context.hostname === "0.0.0.0" ? "localhost" : context.hostname;
  rule.target = `${protocol}://${hostname}:${context.port}`;
  return true;
}

function installPathRewriteBridges(
  sessionId: number,
  options: UtoopackDevWorkerSessionOptions,
): void {
  for (const ruleIndex of options.pathRewriteFunctionIndexes) {
    const rule = options.config.devServer?.proxy?.[ruleIndex];
    if (!rule) {
      throw new Error(
        `[evjs] Utoopack proxy pathRewrite rule ${ruleIndex} is missing in Session ${sessionId}.`,
      );
    }
    rule.pathRewrite = (requestPath) =>
      invokeHostPathRewrite(sessionId, ruleIndex, requestPath);
  }
}

function invokeHostPathRewrite(
  sessionId: number,
  ruleIndex: number,
  requestPath: string,
): string {
  const shared = new SharedArrayBuffer(
    PATH_REWRITE_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT +
      PATH_REWRITE_BUFFER_BYTES,
  );
  const header = new Int32Array(shared, 0, PATH_REWRITE_HEADER_INTS);
  postMessage({
    type: "path-rewrite",
    sessionId,
    ruleIndex,
    path: requestPath,
    shared,
  });
  const waitResult = Atomics.wait(header, 0, 0, PATH_REWRITE_TIMEOUT_MS);
  if (waitResult === "timed-out") {
    throw new Error(
      `[evjs] dev.proxy[${ruleIndex}].pathRewrite did not complete within ${PATH_REWRITE_TIMEOUT_MS}ms.`,
    );
  }
  const status = Atomics.load(header, 1);
  const length = Atomics.load(header, 2);
  const value = new TextDecoder().decode(
    new Uint8Array(
      shared,
      PATH_REWRITE_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT,
      length,
    ),
  );
  if (status !== 1) throw new Error(value);
  return value;
}

function failOwner(cause: unknown, sessionId?: number): void {
  if (ownerExiting) return;
  ownerExiting = true;
  activeSession?.lifecycle.dispose();
  const error = cause instanceof Error ? cause : new Error(String(cause));
  if (sessionId === undefined) {
    postMessage({
      type: "owner-error",
      message: error.message,
      stack: error.stack,
    });
  } else {
    postMessage({
      type: "session-error",
      sessionId,
      message: error.message,
      stack: error.stack,
    });
  }
  setImmediate(() => process.exit(1));
}

function postMessage(message: UtoopackDevWorkerMessage): void {
  port.postMessage(message);
}

function requireParentPort(): NonNullable<typeof parentPort> {
  if (!parentPort) {
    throw new Error("[evjs] Utoopack native owner requires a parent port.");
  }
  return parentPort;
}
