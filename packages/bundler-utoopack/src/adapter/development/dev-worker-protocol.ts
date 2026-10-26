import type { ConfigComplete, DevServerReadyContext } from "@utoo/pack";

export const PATH_REWRITE_HEADER_INTS = 3;
export const PATH_REWRITE_BUFFER_BYTES = 256 * 1024;
export const PATH_REWRITE_TIMEOUT_MS = 5_000;

export interface UtoopackDevWorkerOptions {
  cwd: string;
  rootPath?: string;
  config: ConfigComplete;
  /** Host publication must finish before the next server write begins. */
  onServerBuild?(): Promise<void>;
  onServerError?(error: Error): void;
  spaHistoryFallbackRuleIndex?: number;
  server: {
    port: number;
    https: boolean;
    hostname: string;
    logServerInfo: boolean;
  };
}

export interface UtoopackDevWorkerSessionOptions
  extends Omit<UtoopackDevWorkerOptions, "onServerBuild" | "onServerError"> {
  pathRewriteFunctionIndexes: number[];
}

export type UtoopackDevWorkerCommand =
  | {
      type: "start";
      sessionId: number;
      options: UtoopackDevWorkerSessionOptions;
    }
  | { type: "close"; sessionId: number }
  | {
      type: "server-published";
      sessionId: number;
      buildId: number;
      error?: string;
    };

export type UtoopackDevWorkerMessage =
  | { type: "owner-ready" }
  | {
      type: "ready";
      sessionId: number;
      context: DevServerReadyContext;
      spaHistoryFallbackUpdated: boolean;
    }
  | { type: "closed"; sessionId: number }
  | { type: "server-build"; sessionId: number; buildId: number }
  | { type: "server-error"; sessionId: number; message: string }
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
