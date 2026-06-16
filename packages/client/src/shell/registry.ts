import { isRecord } from "../validation.js";
import {
  assertAppModule,
  assertShellModuleHref,
  assertShellModuleRegistration,
} from "./module-registration.js";
import {
  assertSharedDependencyName,
  assertSharedScope,
  assertSharedScopeEntry,
} from "./shared-scope.js";
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
  assertShellModuleHref(href, "[evjs] registerShellModule() href");
  assertShellModuleRegistration(module, "[evjs] registerShellModule() module");
  getShellModuleRegistry()[href] = module;
}

export function registerSharedDependency(
  name: string,
  entry: SharedScopeEntry,
): void {
  assertSharedDependencyName(name, "[evjs] registerSharedDependency() name");
  assertSharedScopeEntry(entry, "[evjs] registerSharedDependency() entry");
  const scope = getSharedScope();
  assertSharedScope(scope, "[evjs] global shared scope");
  scope[name] = entry;
}

export async function loadSharedDependency(name: string): Promise<unknown> {
  assertSharedDependencyName(name, "[evjs] loadSharedDependency() name");
  const scope = getSharedScope();
  assertSharedScope(scope, "[evjs] global shared scope");
  const entry = scope[name];
  if (!entry) {
    throw new Error(`[evjs] Shared dependency "${name}" is not registered.`);
  }
  return entry.get ? entry.get() : entry.value;
}

export function getShellModuleRegistry(): Record<
  string,
  ShellModuleRegistration
> {
  let registry = readShellModuleRegistry();
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
  assertShellModuleHref(href, "[evjs] readRegisteredModule() href");
  const registry = readShellModuleRegistry();
  if (!registry) return undefined;

  const match = getRegistryKeys(href)
    .map((key) => ({
      key,
      hasEntry: Object.hasOwn(registry, key),
      registered: registry[key],
    }))
    .find(({ hasEntry }) => hasEntry);
  if (!match) return undefined;

  const prefix = `[evjs] shell module registry["${match.key}"]`;
  assertShellModuleRegistration(match.registered, prefix);
  if (typeof match.registered !== "function") return match.registered;

  const module = await match.registered(ctx);
  assertAppModule(module, `${prefix} factory result`);
  return module;
}

function readShellModuleRegistry():
  | Record<string, ShellModuleRegistration>
  | undefined {
  const registry = globalThis.__EVJS_SHELL_MODULES__;
  if (registry === undefined) return undefined;
  if (!isRecord(registry)) {
    throw new Error("[evjs] shell module registry must be an object.");
  }
  return registry;
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
