import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

const require = createRequire(import.meta.url);
const bindingPath = require.resolve("@utoo/pack/cjs/binding.js");
if (bindingPath !== workerData.workerSchedulerBindingPath) {
  throw new Error(
    `Native test worker resolved ${bindingPath}, expected ${workerData.workerSchedulerBindingPath}.`,
  );
}
const binding = require(bindingPath);
binding.registerWorkerScheduler = undefined;

let closeRequested = false;
let shutdownHandlerInstalled = false;

function emitShutdown() {
  if (!closeRequested || !shutdownHandlerInstalled) return;
  closeRequested = false;
  parentPort.postMessage({ type: "close-accepted" });
  process.emit("SIGTERM");
}

process.on("newListener", (event) => {
  if (event !== "SIGTERM" || shutdownHandlerInstalled) return;
  queueMicrotask(() => {
    shutdownHandlerInstalled = true;
    emitShutdown();
  });
});
parentPort.on("message", (message) => {
  if (message?.type !== "close" || closeRequested) return;
  closeRequested = true;
  emitShutdown();
});

const { serve } = require("@utoo/pack");
void serve({ config: workerData.config }, workerData.cwd, undefined, {
  ...workerData.server,
  onReady(context) {
    parentPort.postMessage({
      type: "ready",
      context,
      spaHistoryFallbackUpdated: false,
    });
  },
}).catch((error) => {
  parentPort.postMessage({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
  parentPort.close();
});
