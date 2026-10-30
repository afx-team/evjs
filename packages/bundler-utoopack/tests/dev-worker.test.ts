import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  UtoopackDevWorkerCommand,
  UtoopackDevWorkerMessage,
} from "../src/adapter/development/dev-worker-protocol.js";

const runtime = vi.hoisted(() => ({
  onMessage: vi.fn(),
  postMessage: vi.fn(),
  serve: vi.fn(),
  close: vi.fn(async () => {}),
  dispose: vi.fn(),
}));

vi.mock("node:worker_threads", () => ({
  parentPort: {
    on: runtime.onMessage,
    postMessage: runtime.postMessage,
  },
}));

vi.mock("node:module", () => ({
  createRequire: () => () => ({ serve: runtime.serve }),
}));

vi.mock("../src/adapter/development/dev-worker-scheduler.js", () => ({
  ensureUtoopackProcessWorkerScheduler: async () => ({
    failure: new Promise<never>(() => {}),
  }),
}));

vi.mock("../src/adapter/development/dev-worker-shutdown.js", () => ({
  createUtoopackReusableSessionLifecycle: () => ({
    close: runtime.close,
    dispose: runtime.dispose,
  }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Utoopack native owner startup cancellation", () => {
  it.each([
    false,
    true,
  ])("only reuses the owner after successful cleanup (cleanup fails: %s)", async (cleanupFails) => {
    runtime.serve.mockImplementation(async (_options, _cwd, _root, server) => {
      try {
        await server.onClientBuild({
          clientPaths: ["main.js"],
          isRebuild: false,
        });
      } catch (error) {
        // serve() rethrows the callback error after cleanup, and wraps it
        // with any cleanup error when native resource release also fails.
        if (cleanupFails) {
          throw new AggregateError(
            [error, new Error("native Project cleanup failed")],
            "Failed to start and close the dev server",
          );
        }
        throw error;
      }
    });
    await import("../src/adapter/development/dev-worker.js");
    await vi.waitFor(() =>
      expect(runtime.postMessage).toHaveBeenCalledWith({
        type: "owner-ready",
      }),
    );
    const send = runtime.onMessage.mock.calls[0]?.[1] as (
      command: UtoopackDevWorkerCommand,
    ) => void;
    const start = (sessionId: number) =>
      send({
        type: "start",
        sessionId,
        options: {
          cwd: process.cwd(),
          config: { entry: [] },
          pathRewriteFunctionIndexes: [],
          server: {
            port: 3000,
            https: false,
            hostname: "127.0.0.1",
            logServerInfo: false,
          },
        },
      });
    const messages = () =>
      runtime.postMessage.mock.calls.map(
        ([message]) => message as UtoopackDevWorkerMessage,
      );

    start(1);
    await vi.waitFor(() =>
      expect(messages()).toContainEqual(
        expect.objectContaining({ type: "client-build", sessionId: 1 }),
      ),
    );
    send({ type: "close", sessionId: 1 });

    if (cleanupFails) {
      await vi.waitFor(() =>
        expect(messages()).toContainEqual(
          expect.objectContaining({
            type: "session-error",
            sessionId: 1,
            message: "Failed to start and close the dev server",
          }),
        ),
      );
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
      expect(messages()).not.toContainEqual({ type: "closed", sessionId: 1 });
      start(2);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(runtime.serve).toHaveBeenCalledOnce();
    } else {
      await vi.waitFor(() =>
        expect(messages()).toContainEqual({ type: "closed", sessionId: 1 }),
      );
      start(2);
      await vi.waitFor(() =>
        expect(messages()).toContainEqual(
          expect.objectContaining({ type: "client-build", sessionId: 2 }),
        ),
      );
      send({ type: "close", sessionId: 2 });
      await vi.waitFor(() =>
        expect(messages()).toContainEqual({ type: "closed", sessionId: 2 }),
      );
      expect(process.exit).not.toHaveBeenCalled();
    }
    expect(runtime.close).not.toHaveBeenCalled();
  });
});
