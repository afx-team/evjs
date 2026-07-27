import {
  assertBigfishRouteExtension,
  type BigfishRouteExtension,
} from "@evjs/shared/manifest";

const ROUTE_METADATA_KEYS = [
  "name",
  "icon",
  "title",
  "hideInMenu",
  "flatMenu",
  "spmBPos",
  "access",
  "menuKey",
  "menuAssetOptions",
] as const;

/**
 * Select and clone the finite Bigfish metadata surface from a migration Route.
 *
 * The shared manifest validator owns the schema so config resolution and raw
 * CoreGraph validation cannot drift.
 */
export function resolveBigfishRouteMetadata(
  route: Record<string, unknown>,
  routePath: string,
): BigfishRouteExtension | undefined {
  const metadata = createRecord<unknown>();
  for (const key of ROUTE_METADATA_KEYS) {
    const value = route[key];
    if (value !== undefined) defineRecordValue(metadata, key, value);
  }
  if (Object.keys(metadata).length === 0) return undefined;

  assertBigfishRouteExtension(metadata, routePath);
  return cloneStaticValue(metadata) as BigfishRouteExtension;
}

function cloneStaticValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneStaticValue(item)) as T;
  }
  if (!value || typeof value !== "object") return value;

  const clone = createRecord<unknown>();
  for (const [key, item] of Object.entries(value)) {
    defineRecordValue(clone, key, cloneStaticValue(item));
  }
  return clone as T;
}

function createRecord<T>(): Record<string, T> {
  return {};
}

function defineRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}
