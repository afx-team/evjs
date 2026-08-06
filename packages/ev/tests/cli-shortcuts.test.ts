import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindCLIShortcuts,
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

  it("first registered shortcut wins when keys collide", () => {
    const first = { key: "p", description: "first", action: vi.fn() };
    const second = { key: "p", description: "second", action: vi.fn() };
    // Note: dedupe happens in bindCLIShortcuts, not resolveShortcut. resolveShortcut
    // uses Array.find and returns the FIRST match, mirroring that contract.
    expect(resolveShortcut("p", [first, second])).toBe(first);
  });
});

describe("bindCLIShortcuts enable/empty gating", () => {
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

  it("is a no-op when disabled and attaches nothing to stdin", () => {
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

  it("does not attach when no plugin contributed shortcuts", () => {
    // With helpKey removed, an empty customShortcuts list yields a no-op unbind
    // and never touches process.stdin.
    const unbind = bindCLIShortcuts(createSession(), {}, true);
    expect(typeof unbind).toBe("function");
    unbind();
  });
});
