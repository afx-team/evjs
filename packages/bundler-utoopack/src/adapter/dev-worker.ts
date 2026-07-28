import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";
import type { ConfigComplete, DevServerReadyContext } from "@utoo/pack";
import { runUtoopackDevServer } from "./runtime.js";

const PATH_REWRITE_HEADER_INTS = 3;
const PATH_REWRITE_BUFFER_BYTES = 256 * 1024;
const PATH_REWRITE_TIMEOUT_MS = 5_000;

interface UtoopackDevWorkerData {
  cwd: string;
  config: ConfigComplete;
  pathRewriteFunctionIndexes: number[];
  spaHistoryFallbackRuleIndex?: number;
  server: {
    port: number;
    https: boolean;
    hostname: string;
    logServerInfo: boolean;
  };
}

const require = createRequire(import.meta.url);
const data = workerData as UtoopackDevWorkerData;

installPathRewriteBridges(data);

async function run(): Promise<void> {
  const { serve } = require("@utoo/pack") as Pick<
    typeof import("@utoo/pack"),
    "serve"
  >;
  await runUtoopackDevServer({ serve }, data.config, data.cwd, {
    ...data.server,
    async onReady(context: DevServerReadyContext) {
      const spaHistoryFallbackUpdated = updateSpaHistoryFallback(context);
      parentPort?.postMessage({
        type: "ready",
        context,
        spaHistoryFallbackUpdated,
      });
    },
  });
}

function updateSpaHistoryFallback(context: DevServerReadyContext): boolean {
  const ruleIndex = data.spaHistoryFallbackRuleIndex;
  if (ruleIndex === undefined) return false;
  const rule = data.config.devServer?.proxy?.[ruleIndex];
  if (!rule) return false;
  const protocol = data.server.https ? "https" : "http";
  const hostname =
    context.hostname === "0.0.0.0" ? "localhost" : context.hostname;
  rule.target = `${protocol}://${hostname}:${context.port}`;
  return true;
}

function installPathRewriteBridges(workerOptions: UtoopackDevWorkerData): void {
  for (const ruleIndex of workerOptions.pathRewriteFunctionIndexes) {
    const rule = workerOptions.config.devServer?.proxy?.[ruleIndex];
    if (!rule) {
      throw new Error(
        `[evjs] Utoopack proxy pathRewrite rule ${ruleIndex} is missing in the worker config.`,
      );
    }
    rule.pathRewrite = (requestPath) =>
      invokeHostPathRewrite(ruleIndex, requestPath);
  }
}

function invokeHostPathRewrite(ruleIndex: number, requestPath: string): string {
  const shared = new SharedArrayBuffer(
    PATH_REWRITE_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT +
      PATH_REWRITE_BUFFER_BYTES,
  );
  const header = new Int32Array(shared, 0, PATH_REWRITE_HEADER_INTS);
  parentPort?.postMessage({
    type: "path-rewrite",
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

void run().catch((error: unknown) => {
  const normalized = error instanceof Error ? error : new Error(String(error));
  parentPort?.postMessage({
    type: "error",
    message: normalized.message,
    stack: normalized.stack,
  });
  process.exitCode = 1;
  parentPort?.close();
});
