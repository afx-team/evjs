import type { ConfigComplete, DevServerReadyContext } from "@utoo/pack";
import type { UtoopackClientBuildContext } from "../execution/utoopack.js";

export const PATH_REWRITE_HEADER_INTS = 3;
export const PATH_REWRITE_BUFFER_BYTES = 256 * 1024;
export const PATH_REWRITE_TIMEOUT_MS = 5_000;

export interface UtoopackDevWorkerOptions {
  cwd: string;
  config: ConfigComplete;
  /** Host publication must finish before the next server write begins. */
  onServerBuild?(): Promise<void>;
  onClientBuild?(context: UtoopackClientBuildContext): Promise<void>;
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
  extends Omit<
    UtoopackDevWorkerOptions,
    "onServerBuild" | "onClientBuild" | "onServerError"
  > {
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
    }
  | {
      type: "client-published";
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
  | {
      type: "client-build";
      sessionId: number;
      buildId: number;
      context: UtoopackClientBuildContext;
    }
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
