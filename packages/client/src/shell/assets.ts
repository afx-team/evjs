import type { RemoteManifest, RemoteOutput } from "@evjs/shared/manifest";
import { readRegisteredModule, resolveBrowserHref } from "./registry.js";
import { resolveRemoteHref } from "./routing.js";
import type { AppContext, AppModule } from "./types.js";

const loadingScripts = new Map<string, Promise<void>>();
const loadingStylesheets = new Map<string, Promise<void>>();
const stylesheetReferences = new Map<
  string,
  { count: number; element?: HTMLLinkElement }
>();

export async function defaultLoadModule(
  href: string,
  ctx: AppContext,
): Promise<AppModule> {
  const registered = await readRegisteredModule(href, ctx);
  if (registered) return registered;

  await loadScriptAsset(href);

  const loaded = await readRegisteredModule(href, ctx);
  if (loaded) return loaded;

  throw new Error(
    `[evjs] Shell module script "${href}" loaded but did not register a module. ` +
      `Call registerShellModule("${href}", module) from the built entry or pass loadModule to createShell().`,
  );
}

export async function defaultLoadRemoteManifest(
  remote: RemoteOutput,
): Promise<RemoteManifest> {
  const response = await fetch(remote.manifest);
  if (!response.ok) {
    throw new Error(
      `[evjs] Failed to load remote manifest "${remote.manifest}": ${response.status} ${response.statusText}`,
    );
  }
  const manifest = (await response.json()) as RemoteManifest;
  if (isLocalRemoteManifestUrl(remote.manifest)) {
    return {
      ...manifest,
      baseUrl: resolveRemoteManifestBaseUrl(remote.manifest),
    };
  }
  return {
    ...manifest,
    baseUrl: manifest.baseUrl || resolveRemoteManifestBaseUrl(remote.manifest),
  };
}

export async function loadRemoteStylesheets(
  ctx: AppContext,
): Promise<string[]> {
  if (ctx.kind !== "remote" || !ctx.remote) return [];

  const remote = ctx.remote;
  const cssAssets = remote.entry.assets?.css ?? [];
  if (cssAssets.length === 0) return [];

  const hrefs = [
    ...new Set(
      cssAssets.map((asset) =>
        resolveRemoteHref(remote.manifest.baseUrl, asset),
      ),
    ),
  ];
  return Promise.all(hrefs.map((href) => acquireStylesheetAsset(href)));
}

export function releaseStylesheets(hrefs: string[]): void {
  for (const href of hrefs) {
    const reference = stylesheetReferences.get(href);
    if (!reference) continue;

    reference.count -= 1;
    if (reference.count > 0) continue;

    reference.element?.remove?.();
    stylesheetReferences.delete(href);
    loadingStylesheets.delete(href);
  }
}

async function loadScriptAsset(href: string): Promise<void> {
  const doc = globalThis.document;
  if (!doc) {
    throw new Error(
      `[evjs] Shell cannot load "${href}" outside a browser document. Pass loadModule to createShell().`,
    );
  }

  let promise = loadingScripts.get(href);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const script = doc.createElement("script");
      script.async = true;
      script.src = href;
      script.setAttribute?.("data-evjs-shell-load", "true");
      script.onload = () => resolve();
      script.onerror = () =>
        reject(
          new Error(`[evjs] Failed to load shell module script "${href}".`),
        );
      doc.head.appendChild(script);
    }).catch((error) => {
      loadingScripts.delete(href);
      throw error;
    });
    loadingScripts.set(href, promise);
  }

  await promise;
}

async function acquireStylesheetAsset(href: string): Promise<string> {
  const doc = globalThis.document;
  if (!doc) {
    throw new Error(
      `[evjs] Shell cannot load stylesheet "${href}" outside a browser document.`,
    );
  }

  const current = stylesheetReferences.get(href);
  if (current) {
    current.count += 1;
    await loadingStylesheets.get(href);
    return href;
  }

  const existing = findManagedStylesheet(doc, href);
  if (existing) {
    stylesheetReferences.set(href, {
      count: 1,
      element: existing,
    });
    return href;
  }

  let element: HTMLLinkElement | undefined;
  let promise = loadingStylesheets.get(href);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const link = doc.createElement("link");
      element = link;
      link.rel = "stylesheet";
      link.href = href;
      link.setAttribute?.("data-evjs-shell-style", "true");
      link.onload = () => resolve();
      link.onerror = () =>
        reject(new Error(`[evjs] Failed to load shell stylesheet "${href}".`));
      doc.head.appendChild(link);
    }).catch((error) => {
      loadingStylesheets.delete(href);
      stylesheetReferences.delete(href);
      throw error;
    });
    loadingStylesheets.set(href, promise);
    stylesheetReferences.set(href, {
      count: 1,
      element,
    });
  }

  await promise;
  return href;
}

function findManagedStylesheet(
  doc: Document,
  href: string,
): HTMLLinkElement | undefined {
  if (!doc.querySelectorAll) return undefined;
  const links = doc.querySelectorAll<HTMLLinkElement>(
    "link[data-evjs-shell-style]",
  );

  return Array.from(links).find((link) => {
    const rawHref = link.getAttribute("href");
    return rawHref === href || link.href === resolveBrowserHref(href);
  });
}

function isLocalRemoteManifestUrl(manifestUrl: string): boolean {
  try {
    const url = new URL(manifestUrl, globalThis.location?.href);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function resolveRemoteManifestBaseUrl(manifestUrl: string): string {
  try {
    return new URL(
      ".",
      new URL(manifestUrl, globalThis.location?.href),
    ).toString();
  } catch {
    return "/";
  }
}
