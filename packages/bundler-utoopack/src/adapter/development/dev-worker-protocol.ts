import type { ConfigComplete, DevServerReadyContext } from "@utoo/pack";

export const PATH_REWRITE_HEADER_INTS = 3;
export const PATH_REWRITE_BUFFER_BYTES = 256 * 1024;
export const PATH_REWRITE_TIMEOUT_MS = 5_000;

export interface UtoopackDevWorkerOptions {
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

export interface UtoopackDevWorkerSessionOptions
  extends UtoopackDevWorkerOptions {
  pathRewriteFunctionIndexes: number[];
}

export type UtoopackDevWorkerCommand =
  | {
      type: "start";
      sessionId: number;
      options: UtoopackDevWorkerSessionOptions;
    }
  | { type: "close"; sessionId: number };

export type UtoopackDevWorkerMessage =
  | { type: "owner-ready" }
  | {
      type: "ready";
      sessionId: number;
      context: DevServerReadyContext;
      spaHistoryFallbackUpdated: boolean;
    }
  | { type: "closed"; sessionId: number }
  | {
      type: "session-error";
      sessionId: number;
      message: string;
      stack?: string;
    }
  | { type: "owner-error"; message: string; stack?: string }
  | {
      type: "path-rewrite";
      sessionId: number;
      ruleIndex: number;
      path: string;
      shared: SharedArrayBuffer;
    };
