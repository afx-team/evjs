const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type StaticJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly StaticJsonValue[]
  | StaticJsonObject;

/** A plain, losslessly JSON-serializable object with safe property keys. */
export type StaticJsonObject = {
  readonly [key: string]: StaticJsonValue;
};

/**
 * Validate values that cross evjs static configuration and graph boundaries.
 *
 * This is intentionally stricter than JSON.stringify(): unsupported values,
 * lossy properties, unsafe object keys, sparse arrays, and cycles fail instead
 * of being dropped or coerced.
 */
export function assertStaticJsonValue(
  value: unknown,
  source: string,
): asserts value is StaticJsonValue {
  const ancestors = new Set<object>();

  function visit(current: unknown, suffix: string): void {
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      return;
    }
    if (typeof current === "number") {
      if (Object.is(current, -0)) {
        throw new Error(
          `[evjs] ${source}${suffix} must not contain negative zero.`,
        );
      }
      if (Number.isFinite(current)) return;
      throw new Error(`[evjs] ${source}${suffix} must contain finite numbers.`);
    }
    if (typeof current !== "object") {
      throw new Error(`[evjs] ${source}${suffix} must be JSON-serializable.`);
    }
    if (ancestors.has(current)) {
      throw new Error(`[evjs] ${source}${suffix} must not contain cycles.`);
    }

    if (Array.isArray(current)) {
      assertStrictStaticJsonArray(current, `${source}${suffix}`);
    } else {
      if (!isPlainStaticJsonObject(current)) {
        throw new Error(
          `[evjs] ${source}${suffix} must contain only arrays and plain objects.`,
        );
      }
      assertEnumerableStaticJsonProperties(current, `${source}${suffix}`);
    }

    ancestors.add(current);
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        visit(current[index], `${suffix}[${index}]`);
      }
    } else {
      for (const key of Object.keys(current)) {
        visit(current[key], `${suffix}.${key}`);
      }
    }
    ancestors.delete(current);
  }

  visit(value, "");
}

/** Read and validate an optional static-JSON object without invoking accessors. */
export function readOptionalStaticJsonObjectProperty(
  owner: object,
  key: string,
  source: string,
): StaticJsonObject | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (!descriptor) {
    if (key in owner) {
      throw new Error(`[evjs] ${source} must be an own data property.`);
    }
    return undefined;
  }
  if (!descriptor.enumerable || !("value" in descriptor)) {
    throw new Error(
      `[evjs] ${source} must be an enumerable own data property.`,
    );
  }
  if (descriptor.value === undefined) return undefined;
  if (!isPlainStaticJsonObject(descriptor.value)) {
    throw new Error(`[evjs] ${source} must be a plain object.`);
  }
  assertStaticJsonValue(descriptor.value, source);
  return descriptor.value;
}

export function cloneStaticJsonValue<T>(value: T): T {
  assertStaticJsonValue(value, "static JSON value");
  return cloneValidatedStaticJsonValue(value) as T;
}

function cloneValidatedStaticJsonValue(
  value: StaticJsonValue,
): StaticJsonValue {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const clone: StaticJsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      clone.push(
        cloneValidatedStaticJsonValue(
          readValidatedStaticJsonProperty(value, String(index)),
        ),
      );
    }
    return clone;
  }

  const clone: Record<string, StaticJsonValue> = {};
  for (const key of Object.keys(value)) {
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      value: cloneValidatedStaticJsonValue(
        readValidatedStaticJsonProperty(value, key),
      ),
      writable: true,
    });
  }
  return clone;
}

function readValidatedStaticJsonProperty(
  owner: object,
  key: string,
): StaticJsonValue {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
    throw new Error("[evjs] Static JSON value changed while being cloned.");
  }
  return descriptor.value as StaticJsonValue;
}

export function deepFreezeStaticJsonValue<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value)) {
    deepFreezeStaticJsonValue(child);
  }
  return Object.freeze(value);
}

export function isPlainStaticJsonObject(
  value: unknown,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertEnumerableStaticJsonProperties(
  value: object,
  source: string,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new Error(`[evjs] ${source} contains an unsupported symbol field.`);
    }
    if (UNSAFE_KEYS.has(key)) {
      throw new Error(`[evjs] ${source}.${key} is not a safe config field.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error(
        `[evjs] ${source}.${key} must be an enumerable own data property.`,
      );
    }
  }
}

function assertStrictStaticJsonArray(value: unknown[], source: string): void {
  const indexes = new Set<number>();
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string") {
      throw new Error(`[evjs] ${source} contains an unsupported symbol field.`);
    }
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
      throw new Error(`[evjs] ${source}.${key} is not a JSON array index.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error(
        `[evjs] ${source}[${key}] must be an enumerable own data property.`,
      );
    }
    indexes.add(Number(key));
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!indexes.has(index)) {
      throw new Error(
        `[evjs] ${source}[${index}] must not be a sparse array hole.`,
      );
    }
  }
}
