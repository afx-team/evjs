import { afterEach, describe, expect, it, vi } from "vitest";
import type { PprRegionCacheEntry } from "../src/framework-rendering/framework.js";
import {
  createDefaultPprRegionCache,
  DEFAULT_PPR_REGION_CACHE_MAX_ENTRIES,
} from "../src/framework-rendering/ppr-region-cache.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("default PPR region cache", () => {
  it("enforces its finite default capacity", () => {
    const cache = createDefaultPprRegionCache();

    for (
      let index = 0;
      index <= DEFAULT_PPR_REGION_CACHE_MAX_ENTRIES;
      index += 1
    ) {
      cache.set(String(index), createEntry());
    }

    expect(cache.get("0")).toBeUndefined();
    expect(cache.get("1")).toBeDefined();
    expect(
      cache.get(String(DEFAULT_PPR_REGION_CACHE_MAX_ENTRIES)),
    ).toBeDefined();
  });

  it("deletes fully expired entries when they are read", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const now = Date.now();
    const cache = createDefaultPprRegionCache(2);
    const stale = createEntry({
      expiresAt: now - 1,
      staleUntil: now + 1_000,
    });

    cache.set("expired", createEntry({ expiresAt: now - 1 }));
    cache.set("stale", stale);

    expect(cache.get("expired")).toBeUndefined();
    expect(cache.get("stale")).toBe(stale);

    vi.setSystemTime(now + 1_000);
    expect(cache.get("stale")).toBeUndefined();
  });

  it("promotes cache hits before evicting the least recently used key", () => {
    const cache = createDefaultPprRegionCache(2);
    const first = createEntry();
    const second = createEntry();
    const third = createEntry();

    cache.set("first", first);
    cache.set("second", second);
    expect(cache.get("first")).toBe(first);
    cache.set("third", third);

    expect(cache.get("second")).toBeUndefined();
    expect(cache.get("first")).toBe(first);
    expect(cache.get("third")).toBe(third);
  });

  it("updates an existing key without evicting another entry", () => {
    const cache = createDefaultPprRegionCache(2);
    const updated = createEntry({ statusText: "updated" });

    cache.set("first", createEntry());
    cache.set("second", createEntry());
    cache.set("first", updated);

    expect(cache.get("first")).toBe(updated);
    expect(cache.get("second")).toBeDefined();

    cache.set("first", updated);
    cache.set("third", createEntry());
    expect(cache.get("second")).toBeUndefined();
    expect(cache.get("first")).toBe(updated);
  });
});

function createEntry(
  overrides: Partial<PprRegionCacheEntry> = {},
): PprRegionCacheEntry {
  return {
    expiresAt: Date.now() + 60_000,
    status: 200,
    statusText: "",
    headers: [["content-type", "text/html; charset=utf-8"]],
    body: new Uint8Array([1]).buffer,
    ...overrides,
  };
}
