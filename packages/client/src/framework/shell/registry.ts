import { isRecord } from "../../shared/validation.js";
import {
  assertAppModule,
  assertShellModuleHref,
  assertShellModuleRegistration,
} from "./module-registration.js";
import type {
  AppContext,
  AppModule,
  ShellModuleRegistration,
} from "./types.js";

declare global {
  var __EVJS_SHELL_MODULES__:
    | Record<string, ShellModuleRegistration>
    | undefined;
}

export function registerShellModule(
  href: string,
  module: ShellModuleRegistration,
): void {
  assertShellModuleHref(href, "[evjs] registerShellModule() href");
  assertShellModuleRegistration(module, "[evjs] registerShellModule() module");
  getShellModuleRegistry()[href] = module;
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
