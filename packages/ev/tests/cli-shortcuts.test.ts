import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindCLIShortcuts,
  createShortcutDispatcher,
  dedupeShortcuts,
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

  it("returns undefined for unknown keys and empty input", () => {
    expect(resolveShortcut("z", shortcuts)).toBeUndefined();
    expect(resolveShortcut("", shortcuts)).toBeUndefined();
    expect(resolveShortcut("   ", shortcuts)).toBeUndefined();
  });

  it("returns a shortcut even when its action is undefined (caller skips)", () => {
    const disabled: PluginCliShortcut[] = [
      { key: "d", description: "disabled" },
    ];
    expect(resolveShortcut("d", disabled)?.key).toBe("d");
  });
});

describe("dedupeShortcuts", () => {
  it("drops later duplicates, keeping first-writer order", () => {
    const first = { key: "p", description: "first", action: vi.fn() };
    const second = { key: "p", description: "second", action: vi.fn() };
    const third = { key: "q", description: "third", action: vi.fn() };
    expect(dedupeShortcuts([first, second, third]).map((s) => s.key)).toEqual([
      "p",
      "q",
    ]);
    // The kept "p" is the first one.
    expect(dedupeShortcuts([first, second, third])[0]).toBe(first);
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

  it("is a no-op when disabled", () => {
    const unbind = bindCLIShortcuts(
      createSession(),
      {
        customShortcuts: [{ key: "p", description: "ping", action: vi.fn() }],
      },
      false,
    );
    expect(typeof unbind).toBe("function");
    unbind();
  });

  it("defaults to disabled under CI / non-TTY", () => {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });
    process.env.CI = "1";
    const unbind = bindCLIShortcuts(createSession(), {
      customShortcuts: [{ key: "p", description: "ping", action: vi.fn() }],
    });
    expect(typeof unbind).toBe("function");
    unbind();
  });
});
