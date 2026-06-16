import { isRecord } from "../validation.js";
import type { SharedScope, SharedScopeEntry } from "./types.js";

export function assertSharedDependencyName(
  value: unknown,
  prefix: string,
): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${prefix} must be a non-empty string.`);
  }
  if (value.trim() !== value) {
    throw new Error(
      `${prefix} must not contain leading or trailing whitespace.`,
    );
  }
}

export function assertSharedScopeEntry(
  value: unknown,
  prefix: string,
): asserts value is SharedScopeEntry {
  if (!isRecord(value)) {
    throw new Error(`${prefix} must be a shared dependency object.`);
  }
  assertOptionalSharedString(value.version, `${prefix}.version`);
  assertOptionalSharedBoolean(value.singleton, `${prefix}.singleton`);
  assertOptionalSharedBoolean(value.eager, `${prefix}.eager`);
  assertOptionalSharedBoolean(value.loaded, `${prefix}.loaded`);
  assertOptionalSharedString(value.from, `${prefix}.from`);
  if (value.get !== undefined && typeof value.get !== "function") {
    throw new Error(`${prefix}.get must be a function when provided.`);
  }
}

export function assertSharedScope(
  value: unknown,
  prefix: string,
): asserts value is SharedScope | undefined {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new Error(`${prefix} must be an object.`);
  }

  for (const [name, entry] of Object.entries(value)) {
    if (!name.trim()) {
      throw new Error(`${prefix} must not contain empty keys.`);
    }
    if (name.trim() !== name) {
      throw new Error(
        `${prefix} key "${name}" must not contain leading or trailing whitespace.`,
      );
    }

    assertSharedScopeEntry(entry, `${prefix}.${name}`);
  }
}

function assertOptionalSharedString(value: unknown, path: string): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string when provided.`);
  }
  if (value.trim() !== value) {
    throw new Error(`${path} must not contain leading or trailing whitespace.`);
  }
}

function assertOptionalSharedBoolean(value: unknown, path: string): void {
  if (value === undefined || typeof value === "boolean") return;
  throw new Error(`${path} must be a boolean when provided.`);
}
