import type {
  AppContext,
  AppModule,
  SharedScope,
  SharedScopeEntry,
  ShellModuleRegistration,
} from "./types.js";

declare global {
  var __EVJS_SHELL_MODULES__:
    | Record<string, ShellModuleRegistration>
    | undefined;
  var __EVJS_SHARED_SCOPE__: SharedScope | undefined;
}

export function registerShellModule(
  href: string,
  module: ShellModuleRegistration,
): void {
  getShellModuleRegistry()[href] = module;
}

export function registerSharedDependency(
  name: string,
  entry: SharedScopeEntry,
): void {
  getSharedScope()[name] = entry;
}

export async function loadSharedDependency(name: string): Promise<unknown> {
  const entry = getSharedScope()[name];
  if (!entry) {
    throw new Error(`[evjs] Shared dependency "${name}" is not registered.`);
  }
  return entry.get ? entry.get() : entry.value;
}

export function getShellModuleRegistry(): Record<
  string,
  ShellModuleRegistration
> {
  let registry = globalThis.__EVJS_SHELL_MODULES__;
  if (!registry) {
    registry = {};
    globalThis.__EVJS_SHELL_MODULES__ = registry;
  }
  return registry;
}

export function getSharedScope(): SharedScope {
  let scope = globalThis.__EVJS_SHARED_SCOPE__;
  if (!scope) {
    scope = {};
    globalThis.__EVJS_SHARED_SCOPE__ = scope;
  }
  return scope;
}

export async function readRegisteredModule(
  href: string,
  ctx: AppContext,
): Promise<AppModule | undefined> {
  const registry = globalThis.__EVJS_SHELL_MODULES__;
  const registered = getRegistryKeys(href)
    .map((key) => registry?.[key])
    .find((entry) => Boolean(entry));
  if (!registered) return undefined;

  return typeof registered === "function" ? registered(ctx) : registered;
}

function getRegistryKeys(href: string): string[] {
  const keys = [href];
  const absoluteHref = resolveBrowserHref(href);
  if (absoluteHref && absoluteHref !== href) {
    keys.push(absoluteHref);
  }
  return keys;
}

export function resolveBrowserHref(href: string): string | undefined {
  try {
    return new URL(href, globalThis.location?.href).toString();
  } catch {
    return undefined;
  }
}
