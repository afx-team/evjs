import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultLoadModule } from "../src/framework/shell/assets.js";
import { registerShellModule } from "../src/framework/shell/registry.js";
import type { AppContext } from "../src/framework/shell/types.js";

let sequence = 0;
let scripts: HTMLScriptElement[];

beforeEach(() => {
  vi.useFakeTimers();
  scripts = [];
  vi.stubGlobal("__EVJS_SHELL_MODULES__", undefined);
  vi.stubGlobal("location", { href: "https://example.com/start" });
  vi.stubGlobal("document", {
    createElement() {
      return { setAttribute: vi.fn() };
    },
    head: {
      appendChild(script: HTMLScriptElement) {
        scripts.push(script);
        return script;
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shell module registration readiness", () => {
  it("waits for a page entry to register after its bootstrap onload", async () => {
    const { href, ctx } = target();
    const mod = { mount: vi.fn() };
    const resolved = vi.fn();
    const loading = defaultLoadModule(href, ctx);
    void loading.then(resolved);
    await scriptLoaded();

    expect(resolved).not.toHaveBeenCalled();
    registerShellModule("/unrelated.js", {});
    await vi.advanceTimersByTimeAsync(100);
    expect(resolved).not.toHaveBeenCalled();

    registerShellModule(new URL(href, location.href).toString(), mod);

    await expect(loading).resolves.toBe(mod);
    expect(vi.getTimerCount()).toBe(0);
    expect(listenerCount()).toBe(0);
  });

  it("receives registration from another independently loaded registry module", async () => {
    const { href, ctx } = target();
    const mod = { mount: vi.fn() };
    const loading = defaultLoadModule(href, ctx);
    await scriptLoaded();
    vi.resetModules();
    const otherRegistry = await import("../src/framework/shell/registry.js");
    expect(otherRegistry.registerShellModule).not.toBe(registerShellModule);

    otherRegistry.registerShellModule(href, mod);

    await expect(loading).resolves.toBe(mod);
    expect(Object.keys(globalThis.__EVJS_SHELL_MODULES__ ?? {})).toEqual([
      href,
    ]);
    expect(listenerCount()).toBe(0);
  });

  it("calls a delayed registered factory once with the requesting context", async () => {
    const { href, ctx } = target();
    const mod = { mount: vi.fn() };
    const factory = vi.fn(async () => mod);
    const loading = defaultLoadModule(href, ctx);
    await scriptLoaded();

    registerShellModule(href, factory);

    await expect(loading).resolves.toBe(mod);
    expect(factory).toHaveBeenCalledExactlyOnceWith(ctx);
  });

  it("times out an unregistered entry and lets a later attempt reload its script", async () => {
    const { href, ctx } = target();
    const loading = defaultLoadModule(href, ctx);
    const rejection = expect(loading).rejects.toThrow(
      `Shell module script "${href}" loaded but did not register a module.`,
    );
    await scriptLoaded();

    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    const retry = defaultLoadModule(href, ctx);
    await vi.waitFor(() => expect(scripts).toHaveLength(2));
    const mod = { mount: vi.fn() };
    registerShellModule(href, mod);
    scripts[1]?.onload?.call(scripts[1], new Event("load"));
    await expect(retry).resolves.toBe(mod);
  });

  it("preserves script load errors and removes the registration listener before retry", async () => {
    const { href, ctx } = target();
    const loading = defaultLoadModule(href, ctx);
    const rejection = expect(loading).rejects.toThrow(
      `[evjs] Failed to load shell module script "${href}".`,
    );
    await vi.waitFor(() => expect(scripts).toHaveLength(1));

    scripts[0]?.onerror?.call(scripts[0], new Event("error"));

    await rejection;
    expect(listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const retry = defaultLoadModule(href, ctx);
    await vi.waitFor(() => expect(scripts).toHaveLength(2));
    registerShellModule(href, {});
    scripts[1]?.onload?.call(scripts[1], new Event("load"));
    await expect(retry).resolves.toEqual({});
  });

  it("keeps a retry deduplicated when an older caller times out later", async () => {
    const { href, ctx } = target();
    const first = defaultLoadModule(href, ctx);
    const firstRejection = expect(first).rejects.toThrow("did not register");
    await scriptLoaded();
    await vi.advanceTimersByTimeAsync(2_000);
    const second = defaultLoadModule(href, ctx);
    const secondRejection = expect(second).rejects.toThrow("did not register");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(8_000);
    await firstRejection;

    const retry = defaultLoadModule(href, ctx);
    await vi.waitFor(() => expect(scripts).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(2_000);
    await secondRejection;
    const third = defaultLoadModule(href, ctx);
    await vi.advanceTimersByTimeAsync(0);

    expect(scripts).toHaveLength(2);
    const mod = { mount: vi.fn() };
    registerShellModule(href, mod);
    scripts[1]?.onload?.call(scripts[1], new Event("load"));
    await expect(Promise.all([retry, third])).resolves.toEqual([mod, mod]);
    expect(listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

async function scriptLoaded() {
  await vi.waitFor(() => expect(scripts).toHaveLength(1));
  scripts[0]?.onload?.call(scripts[0], new Event("load"));
  await vi.advanceTimersByTimeAsync(0);
}

function listenerCount(): number {
  const registry = globalThis.__EVJS_SHELL_MODULES__;
  if (!registry) return 0;
  const descriptor = Object.getOwnPropertyDescriptor(
    registry,
    Symbol.for("evjs.shell.module-registration-listeners"),
  );
  expect(descriptor?.enumerable).toBe(false);
  return descriptor?.value.size ?? 0;
}

function target(): { href: string; ctx: AppContext } {
  const href = `/delayed-page-${sequence++}.js`;
  const output = { module: { type: "lifecycle" as const, href } };
  return {
    href,
    ctx: {
      id: "about",
      kind: "page",
      output,
      runtime: {
        version: 1,
        buildId: "test-build",
        runtime: {},
        routing: { kind: "mpa", pages: { about: output } },
      },
      request: { pageId: "about" },
    },
  };
}
