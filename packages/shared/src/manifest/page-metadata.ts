const PAGE_METADATA_KEYS = new Set(["title", "meta"]);
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Static, Page-owned document metadata.
 *
 * `meta` keys map to HTML `<meta name="...">` names. Rich head content such
 * as `property`, `charset`, links, and scripts is intentionally outside this
 * core contract.
 */
export interface PageMetadata {
  readonly title?: string;
  readonly meta?: Readonly<Record<string, string>>;
}

export function assertPageMetadata(
  value: unknown,
  source: string,
): asserts value is PageMetadata {
  const metadata = assertPlainDataObject(value, source);
  for (const key of Object.keys(metadata)) {
    if (!PAGE_METADATA_KEYS.has(key)) {
      throw new Error(`[evjs] ${source} has unknown field "${key}".`);
    }
  }
  if (Object.hasOwn(metadata, "title") && typeof metadata.title !== "string") {
    throw new Error(`[evjs] ${source}.title must be a string.`);
  }
  if (!Object.hasOwn(metadata, "meta")) return;

  const meta = assertPlainDataObject(metadata.meta, `${source}.meta`);
  const namesByAsciiLowerCase = new Map<string, string>();
  for (const [name, content] of Object.entries(meta)) {
    if (name.length === 0) {
      throw new Error(`[evjs] ${source}.meta keys must be non-empty strings.`);
    }
    if (name.trim() !== name) {
      throw new Error(
        `[evjs] ${source}.meta key "${name}" must not include leading or trailing whitespace.`,
      );
    }
    const normalizedName = asciiLowerCase(name);
    const conflictingName = namesByAsciiLowerCase.get(normalizedName);
    if (conflictingName !== undefined) {
      throw new Error(
        `[evjs] ${source}.meta keys "${conflictingName}" and "${name}" conflict because HTML meta names are ASCII case-insensitive.`,
      );
    }
    namesByAsciiLowerCase.set(normalizedName, name);
    if (typeof content !== "string") {
      throw new Error(`[evjs] ${source}.meta.${name} must be a string.`);
    }
  }
}

export function clonePageMetadata(
  value: PageMetadata | undefined,
): PageMetadata | undefined {
  if (!value) return undefined;
  return {
    ...(value.title !== undefined ? { title: value.title } : {}),
    ...(value.meta !== undefined ? { meta: { ...value.meta } } : {}),
  };
}

function assertPlainDataObject(
  value: unknown,
  source: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`[evjs] ${source} must be a plain object.`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new Error(`[evjs] ${source} contains an unsupported symbol field.`);
    }
    if (UNSAFE_KEYS.has(key)) {
      throw new Error(`[evjs] ${source}.${key} is not a safe metadata field.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error(
        `[evjs] ${source}.${key} must be an enumerable own data property.`,
      );
    }
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function asciiLowerCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}
