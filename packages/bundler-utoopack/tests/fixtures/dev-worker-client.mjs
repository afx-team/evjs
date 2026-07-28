import { parentPort, workerData } from "node:worker_threads";

const HEADER_INTS = 3;
const BUFFER_BYTES = 256 * 1024;

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
  parentPort.on("message", () => {});
}
