import {
  assertStaticJsonValue,
  cloneStaticJsonValue,
  deepFreezeStaticJsonValue,
  isPlainStaticJsonObject,
  type StaticJsonValue,
} from "@evjs/shared/_internal/static-json";

export type StaticConfigValue = StaticJsonValue;

export type StaticConfigObject = Readonly<Record<string, StaticConfigValue>>;

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
        : T extends readonly unknown[]
          ? {
              readonly [TIndex in keyof T]: StaticConfigCompatible<
                Exclude<T[TIndex], undefined>
              >;
            }
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

/** Validate, clone, and freeze one static JSON object. */
export function resolveStaticConfigObject(
  value: unknown,
  source: string,
): StaticConfigObject {
  if (!isPlainStaticJsonObject(value)) {
    throw new Error(`[evjs] ${source} must be a plain object.`);
  }
  assertStaticJsonValue(value, source);
  return deepFreezeStaticJsonValue(
    cloneStaticJsonValue(value),
  ) as StaticConfigObject;
}
