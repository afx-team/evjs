import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  installUtoopackGracefulShutdownBridge,
  type UtoopackDevWorkerCommand,
  type UtoopackDevWorkerLifecycleMessage,
} from "../src/adapter/dev-worker-shutdown.js";

class TestShutdownPort extends EventEmitter {
  readonly postMessage =
    vi.fn<(message: UtoopackDevWorkerLifecycleMessage) => void>();

  request(message: UtoopackDevWorkerCommand): void {
    this.emit("message", message);
  }
}

describe("Utoopack dev worker shutdown bridge", () => {
  it("holds an early close until Utoopack installs its signal handler", async () => {
    const port = new TestShutdownPort();
    const signalTarget = new EventEmitter();
    const cleanup = vi.fn();
    installUtoopackGracefulShutdownBridge(port, signalTarget);

    port.request({ type: "close" });
    expect(port.postMessage).not.toHaveBeenCalled();

    signalTarget.on("SIGTERM", cleanup);
    await Promise.resolve();

    expect(port.postMessage).toHaveBeenCalledOnce();
    expect(port.postMessage).toHaveBeenCalledWith({ type: "close-accepted" });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("acknowledges close before invoking an installed cleanup handler", async () => {
    const order: string[] = [];
    const port = new TestShutdownPort();
    port.postMessage.mockImplementation(() => order.push("accepted"));
    const signalTarget = new EventEmitter();
    installUtoopackGracefulShutdownBridge(port, signalTarget);
    signalTarget.on("SIGTERM", () => order.push("cleanup"));
    await Promise.resolve();

    port.request({ type: "close" });

    expect(order).toEqual(["accepted", "cleanup"]);
  });
});
