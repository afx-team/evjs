import { formatErrorDetail, isRecord } from "../../shared/validation.js";
import { readRegisteredModule, subscribeShellModule } from "./registry.js";
import type { AppContext, AppModule } from "./types.js";

const loadingScripts = new Map<string, Promise<void>>();
const MODULE_REGISTRATION_TIMEOUT_MS = 10_000;

export async function defaultLoadModule(
  href: string,
  ctx: AppContext,
): Promise<AppModule> {
  const registered = await readRegisteredModule(href, ctx);
  if (registered) return registered;

  let notifyRegistration: () => void = () => {};
  const registration = new Promise<void>((resolve) => {
    notifyRegistration = resolve;
  });
  const unsubscribe = subscribeShellModule(href, ctx, notifyRegistration);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let scriptAttempt: Promise<void> | undefined;
  try {
    const scriptLoad = loadScriptAsset(href);
    scriptAttempt = loadingScripts.get(href);
    await scriptLoad;
    const loaded = await readRegisteredModule(href, ctx);
    if (loaded) return loaded;

    // Bootstrap onload can precede its asynchronously loaded dependency chunks.
    // Registration, rather than elapsed time, signals that the entry is ready.
    await Promise.race([
      registration,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(missingModuleRegistration(href)),
          MODULE_REGISTRATION_TIMEOUT_MS,
        );
      }),
    ]);
    const ready = await readRegisteredModule(href, ctx);
    if (ready) return ready;
    throw missingModuleRegistration(href);
  } catch (error) {
    if (loadingScripts.get(href) === scriptAttempt) loadingScripts.delete(href);
    throw error;
  } finally {
    unsubscribe();
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function missingModuleRegistration(href: string): Error {
  return new Error(
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
