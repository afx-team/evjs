import {
  assertEnumerableStaticJsonProperties,
  assertStaticJsonValue,
  cloneStaticJsonValue,
  deepFreezeStaticJsonValue,
  isPlainStaticJsonObject,
  type StaticJsonValue,
} from "@evjs/shared/_internal/static-json";

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type ConfigExtensionNamespace = `@${string}/${string}`;

export type StaticConfigValue = StaticJsonValue;

type StaticConfigPrimitive = null | boolean | number | string;

type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Preserve an authored value shape while rejecting fields that cannot cross
 * the framework's static JSON boundary.
 */
export type StaticConfigCompatible<T> =
  IsAny<T> extends true
    ? never
    : unknown extends T
      ? StaticConfigValue
      : T extends StaticConfigPrimitive
        ? T
        : T extends readonly (infer TItem)[]
          ? readonly StaticConfigCompatible<Exclude<TItem, undefined>>[]
          : T extends (...args: never[]) => unknown
            ? never
            : T extends object
              ? keyof T extends never
                ? never
                : Extract<keyof T, symbol> extends never
                  ? {
                      readonly [TKey in keyof T]: StaticConfigCompatible<
                        Exclude<T[TKey], undefined>
                      >;
                    }
                  : never
              : never;

export type ConfigExtensionValues = Partial<
  Record<ConfigExtensionNamespace, StaticConfigValue>
>;

/** Application extension values after plugin defaults, merge, and validation. */
export type ResolvedApplicationExtensionValues = Readonly<
  Record<string, StaticConfigValue>
>;

/**
 * Validate and isolate a namespaced static extension bag.
 *
 * Extension values enter the CoreGraph, so executable values, accessors,
 * class instances, unsafe keys, and lossy JSON values are rejected.
 */
export function resolveConfigExtensionValues(
  value: unknown,
  source: string,
): Readonly<Record<string, StaticConfigValue>> {
  if (value === undefined) return {};
  if (!isPlainStaticJsonObject(value)) {
    throw new Error(`[evjs] ${source} must be a plain object.`);
  }
  assertEnumerableStaticJsonProperties(value, source);
  for (const namespace of Object.keys(value)) {
    assertConfigExtensionNamespace(namespace, `${source} key`);
  }
  assertStaticJsonValue(value, source);
  return deepFreezeStaticJsonValue(cloneStaticJsonValue(value)) as Readonly<
    Record<string, StaticConfigValue>
  >;
}

export function assertConfigExtensionNamespace(
  value: unknown,
  source: string,
): asserts value is ConfigExtensionNamespace {
  if (typeof value !== "string") {
    throw new Error(
      `[evjs] ${source} must be a namespaced id such as "@company/feature".`,
    );
  }
  const separator = value.indexOf("/");
  if (
    !value.startsWith("@") ||
    separator < 2 ||
    separator === value.length - 1 ||
    value !== value.trim() ||
    /\s/.test(value) ||
    UNSAFE_KEYS.has(value)
  ) {
    throw new Error(
      `[evjs] ${source} must be a namespaced id such as "@company/feature".`,
    );
  }
}
