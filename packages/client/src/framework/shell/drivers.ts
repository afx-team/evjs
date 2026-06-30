import { assertClientRuntime } from "../../shared/runtime-config.js";
import { formatErrorDetail, isRecord } from "../../shared/validation.js";
import { createActivationRequestFromUrl } from "./routing.js";
import type {
  BrowserWindowLike,
  HistoryDriver,
  HistoryDriverOptions,
  PageDriver,
  PageDriverOptions,
} from "./types.js";

export function createPageDriver(options: PageDriverOptions = {}): PageDriver {
  assertPageDriverOptions(options);
  return {
    current() {
      const doc = getPageDocument(options);
      const root = getDocumentElement(doc);
      const kind = getOptionalAttribute(root, "data-evjs-kind");
      const id = getOptionalAttribute(root, "data-evjs-id");

      return {
        appId: kind === "app" ? id : undefined,
        pageId: kind === "page" ? id : undefined,
        buildId: getOptionalAttribute(root, "data-evjs-build"),
        url: getDocumentHref(doc),
      };
    },
  };
}

export function createHistoryDriver(
  options: HistoryDriverOptions,
): HistoryDriver {
  assertHistoryDriverOptions(options);
  return {
    current() {
      return createActivationRequestFromUrl(
        options.runtime,
        getWindowHref(getWindow(options)),
      );
    },
    subscribe(callback) {
      const win = getWindow(options);
      const listener = () =>
        callback(
          createActivationRequestFromUrl(options.runtime, getWindowHref(win)),
        );
      addHistoryPopStateListener(win, listener);
      return () => removeHistoryPopStateListener(win, listener);
    },
  };
}

function getOptionalAttribute(
  element: Element | null | undefined,
  name: string,
): string | undefined {
  if (element === null || element === undefined) return undefined;
  if (typeof element.getAttribute !== "function") {
    throw new Error(
      "[evjs] createPageDriver() document.documentElement.getAttribute must be a function when documentElement is provided.",
    );
  }
  return element?.getAttribute(name) ?? undefined;
}

function assertPageDriverOptions(
  options: unknown,
): asserts options is PageDriverOptions {
  if (!isRecord(options)) {
    throw new Error("[evjs] createPageDriver() options must be an object.");
  }
  if (options.document !== undefined) {
    assertPageDocument(options.document);
  }
}

function getPageDocument(options: PageDriverOptions): Document {
  const doc = options.document ?? globalThis.document;
  assertPageDocument(doc);
  return doc;
}

function assertPageDocument(value: unknown): asserts value is Document {
  if (!isRecord(value)) {
    throw new Error(
      "[evjs] createPageDriver() document must be available or provided.",
    );
  }
}

function getDocumentElement(document: Document): Element | null | undefined {
  const element = document.documentElement;
  if (element !== null && element !== undefined && !isRecord(element)) {
    throw new Error(
      "[evjs] createPageDriver() document.documentElement must be an object when provided.",
    );
  }
  return element;
}

function getDocumentHref(document: Document): string | undefined {
  const location = document.location;
  if (location === null || location === undefined) return undefined;
  if (!isRecord(location)) {
    throw new Error(
      "[evjs] createPageDriver() document.location must be an object when provided.",
    );
  }
  if (location.href === undefined) return undefined;
  if (typeof location.href !== "string") {
    throw new Error(
      "[evjs] createPageDriver() document.location.href must be a string when provided.",
    );
  }
  return location.href;
}

function getWindow(options: HistoryDriverOptions): BrowserWindowLike {
  const win = options.window ?? globalThis.window;
  assertBrowserWindow(win, "window");
  return win;
}

function getWindowHref(win: BrowserWindowLike): string {
  const href = win.location.href;
  if (typeof href !== "string" || !href.trim()) {
    throw new Error(
      "[evjs] createHistoryDriver() window.location.href must be a non-empty string.",
    );
  }
  return href;
}

function addHistoryPopStateListener(
  win: BrowserWindowLike,
  listener: EventListener,
): void {
  try {
    win.addEventListener("popstate", listener);
  } catch (error) {
    throw new Error(
      `[evjs] createHistoryDriver() window.addEventListener("popstate") failed${formatErrorDetail(error)}`,
    );
  }
}

function removeHistoryPopStateListener(
  win: BrowserWindowLike,
  listener: EventListener,
): void {
  try {
    win.removeEventListener("popstate", listener);
  } catch (error) {
    throw new Error(
      `[evjs] createHistoryDriver() window.removeEventListener("popstate") failed${formatErrorDetail(error)}`,
    );
  }
}

function assertHistoryDriverOptions(
  options: unknown,
): asserts options is HistoryDriverOptions {
  if (!isRecord(options)) {
    throw new Error("[evjs] createHistoryDriver() options must be an object.");
  }
  assertHistoryDriverRuntime(options.runtime);
  if (options.window !== undefined) {
    assertBrowserWindow(options.window, "window");
  }
}

function assertHistoryDriverRuntime(
  runtime: unknown,
): asserts runtime is HistoryDriverOptions["runtime"] {
  if (!isRecord(runtime)) {
    throw new Error("[evjs] createHistoryDriver() runtime must be an object.");
  }
  assertClientRuntime(runtime, "createHistoryDriver() runtime");
}

function assertBrowserWindow(
  value: unknown,
  path: string,
): asserts value is BrowserWindowLike {
  if (!isRecord(value)) {
    throw new Error(
      `[evjs] createHistoryDriver() ${path} must be available or provided.`,
    );
  }
  if (!isRecord(value.location)) {
    throw new Error(
      `[evjs] createHistoryDriver() ${path}.location must be an object.`,
    );
  }
  if (typeof value.addEventListener !== "function") {
    throw new Error(
      `[evjs] createHistoryDriver() ${path}.addEventListener must be a function.`,
    );
  }
  if (typeof value.removeEventListener !== "function") {
    throw new Error(
      `[evjs] createHistoryDriver() ${path}.removeEventListener must be a function.`,
    );
  }
}
