import type { PprRegionCache, PprRegionCacheEntry } from "./framework.js";

export const DEFAULT_PPR_REGION_CACHE_MAX_ENTRIES = 256;

export function createDefaultPprRegionCache(
  maxEntries = DEFAULT_PPR_REGION_CACHE_MAX_ENTRIES,
): PprRegionCache {
  const entries = new Map<string, PprRegionCacheEntry>();

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (isPprRegionCacheEntryExpired(entry)) {
        entries.delete(key);
        return undefined;
      }

      entries.delete(key);
      entries.set(key, entry);
      return entry;
    },
    set(key, entry) {
      entries.delete(key);
      entries.set(key, entry);
      evictLeastRecentlyUsedEntries(entries, maxEntries);
    },
    delete(key) {
      entries.delete(key);
    },
  };
}

function isPprRegionCacheEntryExpired(entry: PprRegionCacheEntry): boolean {
  return (entry.staleUntil ?? entry.expiresAt) <= Date.now();
}

function evictLeastRecentlyUsedEntries(
  entries: Map<string, PprRegionCacheEntry>,
  maxEntries: number,
): void {
  while (entries.size > maxEntries) {
    const oldest = entries.keys().next();
    if (oldest.done) return;
    entries.delete(oldest.value);
  }
}
