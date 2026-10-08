/**
 * Router-free React page runtime used by framework-generated MPA entries.
 */

import {
  createReactPageModule,
  mountReactPage,
  type ReactPageRuntimeOptions,
} from "../../rsc/react.js";
import { isRecord } from "../../shared/validation.js";
import { registerShellModule, resolveBrowserHref } from "../shell/registry.js";
import type { AppModule } from "../shell/types.js";

export type {
  ReactPageMountOptions,
  ReactPageRouteContext,
  ReactPageRuntimeOptions,
} from "../../rsc/react.js";
export {
  createReactPageModule,
  mountReactPage,
} from "../../rsc/react.js";
export { registerShellModule } from "../shell/registry.js";

type GeneratedReactPageEntryOptions = Omit<
  ReactPageRuntimeOptions,
  "component"
> & { pageId?: string };

export function createGeneratedReactPageEntry(
  component: ReactPageRuntimeOptions["component"],
  options: GeneratedReactPageEntryOptions,
  importMetaHref: string,
): AppModule {
  const { pageId, ...pageOptions } = options;
  const mod = createReactPageModule({
    component,
    hydrate: pageOptions.hydrate,
    render: pageOptions.render,
    route: pageOptions.route,
    props: pageOptions.props,
  });
  // A shared bundler runtime can evaluate this entry while it is the current
  // script. The framework manifest identifies the page's own bootstrap asset;
  // import.meta.url may instead identify an unservable source module.
  const href =
    readPageModuleHref(pageId, pageOptions.route?.id) ??
    getCurrentScriptHref(importMetaHref);
  if (href) registerShellModule(href, mod);
  if (!isShellLoadedScript(href)) {
    mountReactPage({
      component,
      ...pageOptions,
    });
  }
  return mod;
}

function readPageModuleHref(
  pageId: string | undefined,
  routeId: string | undefined,
): string | undefined {
  if ((!pageId && !routeId) || typeof document === "undefined")
    return undefined;
  const text = document.getElementById?.(
    "__EVJS_CLIENT_RUNTIME__",
  )?.textContent;
  if (!text) return undefined;

  let runtime: unknown;
  try {
    runtime = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(runtime) || !isRecord(runtime.routing)) return undefined;
  const { routing } = runtime;
  if (routing.kind !== "mpa" || !isRecord(routing.pages)) return undefined;
  const page = pageId
    ? routing.pages[pageId]
    : Object.values(routing.pages).find(
        (page) => isRecord(page) && page.routeId === routeId,
      );
  if (!isRecord(page) || !isRecord(page.module)) return undefined;
  const href = page.module.href;
  return typeof href === "string" && href
    ? (resolveBrowserHref(href) ?? href)
    : undefined;
}

function getCurrentScriptHref(importMetaHref: string): string | undefined {
  const currentScript = readCurrentScript();
  const currentScriptHref =
    currentScript && "src" in currentScript ? currentScript.src : undefined;
  return currentScriptHref ?? importMetaHref;
}

function isShellLoadedScript(href: string | undefined): boolean {
  return (
    readCurrentScript(href)?.getAttribute?.("data-evjs-shell-load") === "true"
  );
}

function readCurrentScript(href?: string): HTMLScriptElement | null {
  if (typeof document === "undefined") return null;
  const currentScript = document.currentScript;
  if (isScriptElement(currentScript) && (!href || currentScript.src === href)) {
    return currentScript;
  }
  if (href) {
    const script = Array.from(document.scripts).find(
      (script) => script.src === href,
    );
    if (script) return script;
  }
  if (isScriptElement(currentScript)) return currentScript;
  return null;
}

function isScriptElement(value: Element | null): value is HTMLScriptElement {
  return value?.tagName.toLowerCase() === "script" && "src" in value;
}
