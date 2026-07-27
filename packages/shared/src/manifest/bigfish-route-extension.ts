import {
  assertEnumerableStaticJsonProperties,
  assertStaticJsonValue,
  isPlainStaticJsonObject,
} from "../_internal/static-json.js";

/**
 * Built-in Route extension retaining the finite Bigfish metadata surface that
 * existing plugins consume while an explicit route tree is being migrated.
 */
export const BIGFISH_ROUTE_EXTENSION_ID = "@evjs/bigfish-route";

export type BigfishRouteMappedString = string | Record<string, string>;
export type BigfishRouteMenuKey = string | null | Record<string, string | null>;
export type BigfishRouteStaticValue =
  | null
  | boolean
  | number
  | string
  | BigfishRouteStaticValue[]
  | { [key: string]: BigfishRouteStaticValue };

export interface BigfishRouteExtension {
  name?: string;
  icon?: string;
  title?: string;
  hideInMenu?: boolean;
  flatMenu?: boolean;
  spmBPos?: BigfishRouteMappedString;
  access?: string;
  menuKey?: BigfishRouteMenuKey;
  menuAssetOptions?: Record<string, BigfishRouteStaticValue>;
}

const EXTENSION_KEYS = new Set([
  "name",
  "icon",
  "title",
  "hideInMenu",
  "flatMenu",
  "spmBPos",
  "access",
  "menuKey",
  "menuAssetOptions",
]);

/** Validate the built-in Bigfish migration extension without opening a JSON bag. */
export function assertBigfishRouteExtension(
  value: unknown,
  source: string,
): asserts value is BigfishRouteExtension {
  assertStaticJsonValue(value, source);
  const extension = assertPlainRecord(value, source);
  const keys = Object.keys(extension);
  if (keys.length === 0) {
    throw new Error(`[evjs] ${source} must contain retained route metadata.`);
  }
  for (const key of keys) {
    if (!EXTENSION_KEYS.has(key)) {
      throw new Error(`[evjs] ${source}.${key} is not supported.`);
    }
  }
  for (const key of ["name", "icon", "title", "access"] as const) {
    if (!Object.hasOwn(extension, key)) continue;
    assertNonEmptyString(extension[key], `${source}.${key}`);
  }
  for (const key of ["hideInMenu", "flatMenu"] as const) {
    if (!Object.hasOwn(extension, key)) continue;
    if (typeof extension[key] !== "boolean") {
      throw new Error(`[evjs] ${source}.${key} must be a boolean.`);
    }
  }
  if (Object.hasOwn(extension, "spmBPos")) {
    assertMappedString(extension.spmBPos, `${source}.spmBPos`, false);
  }
  if (Object.hasOwn(extension, "menuKey")) {
    assertMappedString(extension.menuKey, `${source}.menuKey`, true);
  }
  if (Object.hasOwn(extension, "menuAssetOptions")) {
    assertPlainRecord(extension.menuAssetOptions, `${source}.menuAssetOptions`);
  }
}

function assertMappedString(
  value: unknown,
  source: string,
  allowEmptyOrNull: boolean,
): void {
  if (value === null) {
    if (allowEmptyOrNull) return;
    throw new Error(`[evjs] ${source} must be a non-empty string or map.`);
  }
  if (typeof value === "string") {
    if (
      (allowEmptyOrNull && value === "") ||
      (value.trim() !== "" && value === value.trim())
    ) {
      return;
    }
    throw new Error(`[evjs] ${source} must be a non-empty string or map.`);
  }
  const mapping = assertPlainRecord(value, source);
  if (Object.keys(mapping).length === 0) {
    throw new Error(`[evjs] ${source} map must not be empty.`);
  }
  for (const [key, mappedValue] of Object.entries(mapping)) {
    if (!key.trim() || key !== key.trim()) {
      throw new Error(`[evjs] ${source} map key "${key}" is not safe.`);
    }
    if (mappedValue === null) {
      if (allowEmptyOrNull) continue;
      throw new Error(`[evjs] ${source}.${key} must be a non-empty string.`);
    }
    if (
      typeof mappedValue !== "string" ||
      !(
        (allowEmptyOrNull && mappedValue === "") ||
        (mappedValue.trim() !== "" && mappedValue === mappedValue.trim())
      )
    ) {
      throw new Error(
        `[evjs] ${source}.${key} must be ${allowEmptyOrNull ? "a string or null" : "a non-empty string"}.`,
      );
    }
  }
}

function assertPlainRecord(
  value: unknown,
  source: string,
): Record<string, unknown> {
  if (!isPlainStaticJsonObject(value)) {
    throw new Error(`[evjs] ${source} must be a plain object.`);
  }
  assertEnumerableStaticJsonProperties(value, source);
  return value;
}

function assertNonEmptyString(
  value: unknown,
  source: string,
): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`[evjs] ${source} must be a non-empty string.`);
  }
}
