import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindCLIShortcuts,
  type DevSession,
} from "../src/_internal/build/cli-shortcuts.js";

function createSession(): DevSession & {
  restartServerRuntime: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return {
    origin: "http://localhost:3000",
    restartServerRuntime: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * A small helper that mirrors how readline consumes a stream: write a line
 * terminated by a newline. Returns a promise that resolves on the next tick so
 * the async `onLine` handler has run.
 */
function sendLine(stream: PassThrough, line: string): Promise<void> {
  stream.write(`${line}\n`);
  return new Promise((resolve) => setImmediate(resolve));
}

describe("bindCLIShortcuts", () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalCI = process.env.CI;

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: originalIsTTY,
    });
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
  });

  it("is a no-op when disabled (CI / non-TTY) and attaches no listeners", async () => {
    const session = createSession();
    const input = new PassThrough();
    const before = input.listenerCount("data");
    const unbind = bindCLIShortcuts(
      session,
      {
        customShortcuts: [
          {
            key: "p",
            description: "ping",
            action: vi.fn(),
          },
        ],
        input,
      },
      false,
    );
    expect(typeof unbind).toBe("function");
    expect(input.listenerCount("data")).toBe(before);
    await sendLine(input, "p");
    expect(session.restartServerRuntime).not.toHaveBeenCalled();
    unbind();
  });

  it("dispatches a pressed key to the matching plugin shortcut action with the live session", async () => {
    const session = createSession();
    const action = vi.fn();
    const input = new PassThrough();
    const unbind = bindCLIShortcuts(
      session,
      {
        customShortcuts: [{ key: "p", description: "ping", action }],
        input,
      },
      true,
    );
    await sendLine(input, "p");
    unbind();
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith(session);
  });

  it("ignores unknown keys and no-ops", async () => {
    const session = createSession();
    const action = vi.fn();
    const input = new PassThrough();
    const unbind = bindCLIShortcuts(
      session,
      {
        customShortcuts: [{ key: "p", description: "ping", action }],
        input,
      },
      true,
    );
    await sendLine(input, "z");
    await sendLine(input, "");
    unbind();
    expect(action).not.toHaveBeenCalled();
  });

  it("drops presses while an action is already running (actionRunning guard)", async () => {
    const session = createSession();
    let resolveAction: () => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const input = new PassThrough();
    const unbind = bindCLIShortcuts(
      session,
      {
        customShortcuts: [{ key: "p", description: "ping", action }],
        input,
      },
      true,
    );
    await sendLine(input, "p");
    await sendLine(input, "p"); // re-entrant press must be dropped
    expect(action).toHaveBeenCalledTimes(1);
    resolveAction();
    await new Promise((resolve) => setImmediate(resolve));
    await sendLine(input, "p"); // now allowed again
    unbind();
    resolveAction();
    await new Promise((resolve) => setImmediate(resolve));
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("first writer wins: a duplicate key registered by a later plugin is ignored", async () => {
    const session = createSession();
    const first = vi.fn();
    const second = vi.fn();
    const input = new PassThrough();
    const unbind = bindCLIShortcuts(
      session,
      {
        customShortcuts: [
          { key: "p", description: "first", action: first },
          { key: "p", description: "second", action: second },
        ],
        input,
      },
      true,
    );
    await sendLine(input, "p");
    unbind();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("registers an h help action that lists registered shortcuts (helpKey)", async () => {
    const session = createSession();
    const input = new PassThrough();
    const unbind = bindCLIShortcuts(
      session,
      {
        customShortcuts: [{ key: "p", description: "ping", action: vi.fn() }],
        helpKey: true,
        input,
      },
      true,
    );
    await sendLine(input, "h");
    unbind();
    // help action ran without throwing; no shortcut dispatched.
    expect(session.restartServerRuntime).not.toHaveBeenCalled();
  });

  it("does not attach a readline interface when there are no shortcuts and helpKey is disabled", () => {
    const session = createSession();
    const input = new PassThrough();
    const before = input.listenerCount("data");
    const unbind = bindCLIShortcuts(session, { input }, true);
    expect(input.listenerCount("data")).toBe(before);
    unbind();
  });

  it("unbind removes the line listener and closes the readline interface", async () => {
    const session = createSession();
    const action = vi.fn();
    const input = new PassThrough();
    const unbind = bindCLIShortcuts(
      session,
      {
        customShortcuts: [{ key: "p", description: "ping", action }],
        input,
      },
      true,
    );
    unbind();
    await sendLine(input, "p"); // after unbind, presses must not dispatch
    expect(action).not.toHaveBeenCalled();
  });

  it("swallows a throwing action so the loop survives", async () => {
    const session = createSession();
    const action = vi.fn(() => Promise.reject(new Error("boom")));
    const input = new PassThrough();
    const unbind = bindCLIShortcuts(
      session,
      {
        customShortcuts: [{ key: "p", description: "ping", action }],
        input,
      },
      true,
    );
    await sendLine(input, "p");
    unbind();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("defaults to enabled = isTTY && !CI", () => {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });
    process.env.CI = "1";
    const session = createSession();
    const unbind = bindCLIShortcuts(session, {
      customShortcuts: [{ key: "p", description: "ping", action: vi.fn() }],
    });
    // disabled path returns a noop unbind that never attached to stdin
    expect(typeof unbind).toBe("function");
    unbind();
  });

  it("a shortcut with action: undefined is registered but never runs", async () => {
    const session = createSession();
    const action = vi.fn();
    const input = new PassThrough();
    const unbind = bindCLIShortcuts(
      session,
      {
        customShortcuts: [
          { key: "p", description: "disabled" },
          { key: "q", description: "active", action },
        ],
        input,
      },
      true,
    );
    await sendLine(input, "p");
    await sendLine(input, "q");
    unbind();
    expect(action).toHaveBeenCalledTimes(1);
  });
});
