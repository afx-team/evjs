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

const registrationListenersKey = Symbol.for(
  "evjs.shell.module-registration-listeners",
);
type RegistrationListener = {
  href: string;
  ctx: AppContext;
  notify: (href: string) => void;
};
type ShellModuleRegistry = Record<string, ShellModuleRegistration> & {
  [registrationListenersKey]?: Set<RegistrationListener>;
};

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
  const registry = getShellModuleRegistry();
  registry[href] = module;
  for (const listener of registry[registrationListenersKey] ?? []) {
    listener.notify(href);
  }
}

export function registerPendingPageModule(
  pageId: string | undefined,
  buildId: string | undefined,
  module: AppModule,
): boolean {
  if (!pageId || !buildId) return false;
  const hrefs = new Set(
    [...(readShellModuleRegistry()?.[registrationListenersKey] ?? [])]
      .filter(
        ({ ctx }) =>
          ctx.kind === "page" &&
          ctx.id === pageId &&
          ctx.runtime.buildId === buildId,
      )
      .map(({ href }) => href),
  );
  for (const href of hrefs) registerShellModule(href, module);
  return hrefs.size > 0;
}

export function getShellModuleRegistry(): ShellModuleRegistry {
  let registry = readShellModuleRegistry();
  if (!registry) {
    registry = {};
    globalThis.__EVJS_SHELL_MODULES__ = registry;
  }
  return registry;
}

export function subscribeShellModule(
  href: string,
  ctx: AppContext,
  onRegistered: () => void,
): () => void {
  const registry = getShellModuleRegistry();
  let listeners = registry[registrationListenersKey];
  if (!listeners) {
    listeners = new Set();
    // Independent entry bundles share this state through the global registry.
    Object.defineProperty(registry, registrationListenersKey, {
      value: listeners,
      configurable: true,
    });
  }
  const keys = getRegistryKeys(href);
  const listener: RegistrationListener = {
    href,
    ctx,
    notify(registeredHref) {
      if (keys.includes(registeredHref)) onRegistered();
    },
  };
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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

function readShellModuleRegistry(): ShellModuleRegistry | undefined {
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
