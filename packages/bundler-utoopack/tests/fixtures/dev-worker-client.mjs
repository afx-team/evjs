import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

const HEADER_INTS = 3;
const BUFFER_BYTES = 256 * 1024;
const require = createRequire(import.meta.url);
const lockPath = workerData.config.define?.TEST_CACHE_LOCK_PATH;
const cacheLock = lockPath
  ? require("@utoo/pack/cjs/utils/lockfile.js").PersistentCacheLock.tryAcquire(
      lockPath,
      JSON.stringify({ pid: process.pid, processName: "evjs worker test" }),
    )
  : undefined;

if (lockPath && !cacheLock) {
  throw new Error(`Unable to acquire test cache lock at ${lockPath}.`);
}

function invokePathRewrite(ruleIndex, requestPath) {
  const shared = new SharedArrayBuffer(
    HEADER_INTS * Int32Array.BYTES_PER_ELEMENT + BUFFER_BYTES,
  );
  const header = new Int32Array(shared, 0, HEADER_INTS);
  parentPort.postMessage({
    type: "path-rewrite",
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

const ruleIndex = workerData.pathRewriteFunctionIndexes[0];
const rewrite =
  ruleIndex === undefined
    ? {}
    : invokePathRewrite(
        ruleIndex,
        workerData.config.define?.TEST_PATH ?? "/in",
      );
const fallbackRule =
  workerData.spaHistoryFallbackRuleIndex === undefined
    ? undefined
    : workerData.config.devServer?.proxy?.[
        workerData.spaHistoryFallbackRuleIndex
      ];
if (fallbackRule) fallbackRule.target = "http://localhost:4321";

parentPort.postMessage({
  type: "ready",
  context: {
    port: 4321,
    hostname: "0.0.0.0",
    clientPaths: [],
    rewrite,
    fallbackTarget: fallbackRule?.target,
  },
  spaHistoryFallbackUpdated: Boolean(fallbackRule),
});

if (workerData.config.define?.TEST_EXIT === "true") {
  parentPort.close();
} else {
  parentPort.on("message", (message) => {
    if (message?.type !== "close") return;
    if (workerData.config.define?.TEST_IGNORE_CLOSE === "true") return;
    if (workerData.config.define?.TEST_SKIP_CLOSE_ACK !== "true") {
      parentPort.postMessage({ type: "close-accepted" });
    }
    cacheLock?.unlockSync();
    parentPort.close();
  });
}
