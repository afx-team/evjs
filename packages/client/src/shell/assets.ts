import { formatErrorDetail, isRecord } from "../validation.js";
import { readRegisteredModule } from "./registry.js";
import type { AppContext, AppModule } from "./types.js";

const loadingScripts = new Map<string, Promise<void>>();

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

async function loadScriptAsset(href: string): Promise<void> {
  const doc = globalThis.document;
  if (!doc) {
    throw new Error(
      `[evjs] Shell cannot load "${href}" outside a browser document. Pass loadModule to createShell().`,
    );
  }
  assertShellAssetDocument(doc, href, "module script");

  let promise = loadingScripts.get(href);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const script = createShellAssetElement<HTMLScriptElement>(
        doc,
        "script",
        href,
        "module script",
      );
      script.async = true;
      script.src = href;
      script.setAttribute?.("data-evjs-shell-load", "true");
      script.onload = () => resolve();
      script.onerror = () =>
        reject(
          new Error(`[evjs] Failed to load shell module script "${href}".`),
        );
      appendShellAssetElement(doc, script, href, "module script");
    }).catch((error) => {
      loadingScripts.delete(href);
      throw error;
    });
    loadingScripts.set(href, promise);
  }

  await promise;
}

function assertShellAssetDocument(
  doc: Document,
  href: string,
  assetKind: "module script" | "stylesheet",
): asserts doc is Document & {
  createElement: Document["createElement"];
  head: NonNullable<Document["head"]> & {
    appendChild: NonNullable<Document["head"]>["appendChild"];
  };
} {
  if (typeof doc.createElement !== "function") {
    throw new Error(
      `[evjs] Shell cannot load ${assetKind} "${href}": document.createElement must be a function.`,
    );
  }
  if (!isRecord(doc.head) || typeof doc.head.appendChild !== "function") {
    throw new Error(
      `[evjs] Shell cannot load ${assetKind} "${href}": document.head.appendChild must be a function.`,
    );
  }
}

function createShellAssetElement<T extends Element>(
  doc: Document,
  tagName: string,
  href: string,
  assetKind: "module script" | "stylesheet",
): T {
  const element = doc.createElement(tagName);
  if (!isRecord(element)) {
    throw new Error(
      `[evjs] Shell cannot load ${assetKind} "${href}": document.createElement("${tagName}") must return an element.`,
    );
  }
  return element as T;
}

function appendShellAssetElement(
  doc: Document & {
    head: NonNullable<Document["head"]> & {
      appendChild: NonNullable<Document["head"]>["appendChild"];
    };
  },
  element: Element,
  href: string,
  assetKind: "module script" | "stylesheet",
): void {
  try {
    doc.head.appendChild(element);
  } catch (error) {
    throw new Error(
      `[evjs] Shell cannot load ${assetKind} "${href}": document.head.appendChild failed${formatErrorDetail(error)}`,
    );
  }
}
