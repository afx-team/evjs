type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type Builtin = Primitive | RegExp | ((...args: never[]) => unknown);

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type ConfigPatch<T> = T extends Builtin
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]?: ConfigPatch<T[K]> }
      : T;

export function merge<T extends object>(target: T, patch: ConfigPatch<T>): T {
  if (isObject(patch)) {
    mergeObject(target, patch);
  }
  return target;
}

function mergeObject(target: object, patch: object): void {
  for (const key of Object.keys(patch)) {
    if (UNSAFE_KEYS.has(key)) {
      throw new Error(`[evjs] merge() patch field "${key}" is not safe.`);
    }

    const patchDescriptor = Object.getOwnPropertyDescriptor(patch, key);
    if (!patchDescriptor || !("value" in patchDescriptor)) {
      throw new Error(
        `[evjs] merge() patch field "${key}" must be an enumerable own data property.`,
      );
    }

    const value = patchDescriptor.value;
    const targetDescriptor = Object.getOwnPropertyDescriptor(target, key);
    const current =
      targetDescriptor && "value" in targetDescriptor
        ? targetDescriptor.value
        : undefined;

    if (isPlainObject(current) && isPlainObject(value)) {
      mergeObject(current, value);
      continue;
    }

    defineOwnDataProperty(target, key, value, targetDescriptor);
  }
}

function defineOwnDataProperty(
  target: object,
  key: string,
  value: unknown,
  current: PropertyDescriptor | undefined,
): void {
  Object.defineProperty(
    target,
    key,
    current && "value" in current
      ? { ...current, value }
      : {
          configurable: true,
          enumerable: true,
          value,
          writable: true,
        },
  );
}

function isObject(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

function isPlainObject(value: unknown): value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
