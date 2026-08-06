import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindCLIShortcuts,
  createShortcutDispatcher,
  dedupeShortcuts,
  normalizeShortcutKey,
  resolveShortcut,
} from "../src/_internal/build/cli-shortcuts.js";
import type {
  PluginCliShortcut,
  PluginDevSession,
} from "../src/plugin/index.js";

function createSession(): PluginDevSession & {
  close: ReturnType<typeof vi.fn>;
} {
  return {
    origin: "http://localhost:3000",
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("resolveShortcut (pure dispatch logic)", () => {
  const shortcuts: PluginCliShortcut[] = [
    { key: "p", description: "ping", action: vi.fn() },
    { key: "o", description: "open", action: vi.fn() },
  ];

  it("matches a registered key", () => {
    expect(resolveShortcut("p", shortcuts)?.key).toBe("p");
    expect(resolveShortcut("o", shortcuts)?.key).toBe("o");
  });

  it("trims whitespace and is case-insensitive", () => {
    expect(resolveShortcut("  P ", shortcuts)?.key).toBe("p");
    expect(resolveShortcut("O\n", shortcuts)?.key).toBe("o");
  });

  it("returns undefined for unknown, empty, and multi-character input", () => {
    expect(resolveShortcut("z", shortcuts)).toBeUndefined();
    expect(resolveShortcut("", shortcuts)).toBeUndefined();
    expect(resolveShortcut("   ", shortcuts)).toBeUndefined();
    expect(resolveShortcut("open", shortcuts)).toBeUndefined();
  });

  it("returns a shortcut even when its action is undefined (caller skips)", () => {
    const disabled: PluginCliShortcut[] = [
      { key: "d", description: "disabled" },
    ];
    expect(resolveShortcut("d", disabled)?.key).toBe("d");
  });
});

describe("dedupeShortcuts", () => {
  it("normalizes keys and drops later duplicates by first-writer order", () => {
    const first = { key: " P ", description: "first", action: vi.fn() };
    const second = { key: "p", description: "second", action: vi.fn() };
    const third = { key: "q", description: "third", action: vi.fn() };
    const deduped = dedupeShortcuts([first, second, third]);
    expect(deduped.map((s) => s.key)).toEqual(["p", "q"]);
    expect(deduped[0]?.description).toBe("first");
    expect(deduped[0]?.action).toBe(first.action);
    expect(Object.isFrozen(deduped[0])).toBe(true);
  });

  it("rejects empty and multi-character registration keys", () => {
    expect(() => normalizeShortcutKey(" ")).toThrow("single non-whitespace");
    expect(() => normalizeShortcutKey("open")).toThrow("single non-whitespace");
  });
});

describe("createShortcutDispatcher", () => {
  it("drops concurrent presses while an action is already running", async () => {
    // The action returns a long-pending promise on its first call (which we
    // control), and a self-resolving promise thereafter so the second press
    // can be awaited deterministically.
    let resolveFirst: () => void = () => {};
    let calls = 0;
    const action = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? new Promise<void>((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve();
    });
    const session = createSession();
    const dispatcher = createShortcutDispatcher(session, [
      { key: "p", description: "ping", action },
    ]);

    // Fire the first press without awaiting; its action stays pending while we
    // re-enter.
    const first = dispatcher.dispatch("p");
    // These presses arrive while the first action is still pending; they must
    // be dropped.
    await dispatcher.dispatch("p");
    await dispatcher.dispatch("p");
    expect(action).toHaveBeenCalledTimes(1);

    resolveFirst();
    await first;

    // Once the first action finished, the next press runs again (and resolves).
    await dispatcher.dispatch("p");
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("survives a throwing action; the loop keeps dispatching", async () => {
    const firstAction = vi.fn(() => Promise.reject(new Error("boom")));
    const secondAction = vi.fn().mockResolvedValue(undefined);
    const session = createSession();
    const dispatcher = createShortcutDispatcher(session, [
      { key: "a", description: "throws", action: firstAction },
      { key: "b", description: "ok", action: secondAction },
    ]);

    await expect(dispatcher.dispatch("a")).resolves.toBeUndefined();
    await dispatcher.dispatch("b");
    expect(firstAction).toHaveBeenCalledTimes(1);
    expect(secondAction).toHaveBeenCalledTimes(1);
  });

  it("no-ops for unknown keys and shortcuts with undefined action", async () => {
    const action = vi.fn();
    const dispatcher = createShortcutDispatcher(createSession(), [
      { key: "d", description: "disabled" },
      { key: "p", description: "ping", action },
    ]);
    await dispatcher.dispatch("z");
    await dispatcher.dispatch("d");
    expect(action).not.toHaveBeenCalled();
    await dispatcher.dispatch("p");
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-flight action before becoming idle", async () => {
    let resolveAction: () => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const dispatcher = createShortcutDispatcher(createSession(), [
      { key: "p", description: "pending", action },
    ]);

    const dispatch = dispatcher.dispatch("p");
    let idle = false;
    const waitForIdle = dispatcher.waitForIdle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);

    resolveAction();
    await Promise.all([dispatch, waitForIdle]);
    expect(idle).toBe(true);
  });
});

describe("bindCLIShortcuts enable gating", () => {
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

  it("is a no-op when disabled", async () => {
    const dataListeners = process.stdin.listenerCount("data");
    const unbind = bindCLIShortcuts(
      createSession(),
      {
        customShortcuts: [{ key: "p", description: "ping", action: vi.fn() }],
      },
      false,
    );
    expect(typeof unbind).toBe("function");
    expect(process.stdin.listenerCount("data")).toBe(dataListeners);
    await unbind();
  });

  it("defaults to disabled under CI / non-TTY", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });
    process.env.CI = "1";
    const dataListeners = process.stdin.listenerCount("data");
    const unbind = bindCLIShortcuts(createSession(), {
      customShortcuts: [{ key: "p", description: "ping", action: vi.fn() }],
    });
    expect(typeof unbind).toBe("function");
    expect(process.stdin.listenerCount("data")).toBe(dataListeners);
    await unbind();
  });

  it("detaches input without waiting forever for a stuck action", async () => {
    const action = vi.fn(() => new Promise<void>(() => {}));
    const unbind = bindCLIShortcuts(
      createSession(),
      {
        customShortcuts: [{ key: "p", description: "pending", action }],
      },
      true,
    );
    process.stdin.emit("data", Buffer.from("p\n"));
    await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());

    const result = await unbind({ actionDrainTimeoutMs: 5 });
    expect(result.drained).toBe(false);
  });

  it("reports an idle binding as drained with a zero timeout", async () => {
    const unbind = bindCLIShortcuts(
      createSession(),
      {
        customShortcuts: [{ key: "p", description: "unused", action: vi.fn() }],
      },
      true,
    );

    const result = await unbind({ actionDrainTimeoutMs: 0 });
    expect(result.drained).toBe(true);
    await expect(result.idle).resolves.toBeUndefined();
  });
});
