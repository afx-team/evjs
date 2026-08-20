import fs from "node:fs";
import { parentPort } from "node:worker_threads";

const HEADER_INTS = 3;
const BUFFER_BYTES = 256 * 1024;
let activeSession;

parentPort.postMessage({ type: "owner-ready" });
parentPort.on("message", (message) => {
  if (message?.type === "start") {
    startSession(message.sessionId, message.options);
    return;
  }
  if (message?.type === "close") closeSession(message.sessionId);
});

function startSession(sessionId, options) {
  if (activeSession) {
    sendSessionError(sessionId, "A test Session is already active.");
    return;
  }
  const lockPath = options.config.define?.TEST_CACHE_LOCK_PATH;
  let lockFd;
  try {
    if (lockPath) lockFd = fs.openSync(lockPath, "wx");
  } catch (error) {
    sendSessionError(
      sessionId,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  activeSession = { id: sessionId, options, lockFd, lockPath };

  const ruleIndex = options.pathRewriteFunctionIndexes[0];
  const rewrite =
    ruleIndex === undefined
      ? {}
      : invokePathRewrite(
          sessionId,
          ruleIndex,
          options.config.define?.TEST_PATH ?? "/in",
        );
  const fallbackRule =
    options.spaHistoryFallbackRuleIndex === undefined
      ? undefined
      : options.config.devServer?.proxy?.[options.spaHistoryFallbackRuleIndex];
  if (fallbackRule) fallbackRule.target = "http://localhost:4321";

  parentPort.postMessage({
    type: "ready",
    sessionId,
    context: {
      port: 4321,
      hostname: "0.0.0.0",
      clientPaths: [],
      rewrite,
      fallbackTarget: fallbackRule?.target,
    },
    spaHistoryFallbackUpdated: Boolean(fallbackRule),
  });

  if (options.config.define?.TEST_EXIT === "true") {
    process.exit(0);
  }
}

function closeSession(sessionId) {
  const session = activeSession;
  if (!session || session.id !== sessionId) {
    sendSessionError(sessionId, `Inactive test Session ${sessionId}.`);
    return;
  }
  if (session.options.config.define?.TEST_IGNORE_CLOSE === "true") return;
  if (session.options.config.define?.TEST_SKIP_CLOSE_ACK === "true") {
    process.exit(0);
  }

  if (session.lockFd !== undefined) fs.closeSync(session.lockFd);
  if (session.lockPath) fs.unlinkSync(session.lockPath);
  activeSession = undefined;
  parentPort.postMessage({ type: "closed", sessionId });
}

function invokePathRewrite(sessionId, ruleIndex, requestPath) {
  const shared = new SharedArrayBuffer(
    HEADER_INTS * Int32Array.BYTES_PER_ELEMENT + BUFFER_BYTES,
  );
  const header = new Int32Array(shared, 0, HEADER_INTS);
  parentPort.postMessage({
    type: "path-rewrite",
    sessionId,
    ruleIndex,
    path: requestPath,
    shared,
  });
  const waitResult = Atomics.wait(header, 0, 0, 5_000);
  if (waitResult === "timed-out") return { error: "timed out" };
  const status = Atomics.load(header, 1);
  const length = Atomics.load(header, 2);
  const value = new TextDecoder().decode(
    new Uint8Array(shared, HEADER_INTS * Int32Array.BYTES_PER_ELEMENT, length),
  );
  return status === 1 ? { value } : { error: value };
}

function sendSessionError(sessionId, message) {
  parentPort.postMessage({ type: "session-error", sessionId, message });
}
