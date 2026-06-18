/**
 * Router-free React page runtime used by framework-generated MPA entries.
 */

import {
  createReactPageModule,
  mountReactPage,
  type ReactPageRuntimeOptions,
} from "./react.js";
import type { AppModule } from "./shell.js";
import { registerShellModule } from "./shell.js";

export type {
  ReactPageMountOptions,
  ReactPageRouteContext,
  ReactPageRuntimeOptions,
} from "./react.js";
export {
  createReactPageModule,
  mountReactPage,
} from "./react.js";
export { registerShellModule } from "./shell.js";

type GeneratedReactPageEntryOptions = Omit<
  ReactPageRuntimeOptions,
  "component"
>;

export function createGeneratedReactPageEntry(
  component: ReactPageRuntimeOptions["component"],
  options: GeneratedReactPageEntryOptions,
  importMetaHref: string,
): AppModule {
  const mod = createReactPageModule({
    component,
    hydrate: options.hydrate,
    render: options.render,
    route: options.route,
    props: options.props,
  });
  const href = getCurrentScriptHref(importMetaHref);
  if (href) registerShellModule(href, mod);
  if (!isShellLoadedScript(importMetaHref)) {
    mountReactPage({
      component,
      ...options,
    });
  }
  return mod;
}

function getCurrentScriptHref(importMetaHref: string): string | undefined {
  const currentScript = readCurrentScript();
  const currentScriptHref =
    currentScript && "src" in currentScript ? currentScript.src : undefined;
  return currentScriptHref ?? importMetaHref;
}

function isShellLoadedScript(importMetaHref: string): boolean {
  return (
    readCurrentScript(importMetaHref)?.getAttribute?.(
      "data-evjs-shell-load",
    ) === "true"
  );
}

function readCurrentScript(importMetaHref?: string): HTMLScriptElement | null {
  if (typeof document === "undefined") return null;
  const currentScript = document.currentScript;
  if (isScriptElement(currentScript)) return currentScript;
  if (!importMetaHref) return null;
  return (
    Array.from(document.scripts).find(
      (script) => script.src === importMetaHref,
    ) ?? null
  );
}

function isScriptElement(value: Element | null): value is HTMLScriptElement {
  return value?.tagName.toLowerCase() === "script" && "src" in value;
}
