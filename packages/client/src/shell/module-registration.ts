import { isRecord } from "../validation.js";
import type { AppModule, ShellModuleRegistration } from "./types.js";

export function assertShellModuleHref(
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

export function assertShellModuleRegistration(
  value: unknown,
  prefix: string,
): asserts value is ShellModuleRegistration {
  if (typeof value === "function") return;
  assertAppModule(value, prefix);
}

export function assertAppModule(
  value: unknown,
  prefix: string,
): asserts value is AppModule {
  if (!isRecord(value)) {
    throw new Error(`${prefix} must be a lifecycle module object.`);
  }

  assertOptionalLifecycleHook(value.init, prefix, "init");
  assertOptionalLifecycleHook(value.mount, prefix, "mount");
  assertOptionalLifecycleHook(value.hydrate, prefix, "hydrate");
  assertOptionalLifecycleHook(value.unmount, prefix, "unmount");
}

export function assertRenderableAppModule(
  value: AppModule,
  prefix: string,
): void {
  if (!value.mount && !value.hydrate) {
    throw new Error(`${prefix} must export mount or hydrate to render.`);
  }
}

function assertOptionalLifecycleHook(
  value: unknown,
  prefix: string,
  name: keyof AppModule,
): void {
  if (value !== undefined && typeof value !== "function") {
    throw new Error(`${prefix} ${name} must be a function when provided.`);
  }
}
