type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type Builtin = Primitive | RegExp | ((...args: never[]) => unknown);

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
  for (const [key, value] of Object.entries(patch)) {
    const current = Reflect.get(target, key);

    if (isPlainObject(current) && isPlainObject(value)) {
      mergeObject(current, value);
      continue;
    }

    Reflect.set(target, key, value);
  }
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
