import { createActivationRequestFromUrl } from "./routing.js";
import type {
  BrowserWindowLike,
  HistoryDriver,
  HistoryDriverOptions,
  PageDriver,
  PageDriverOptions,
} from "./types.js";

export function createPageDriver(options: PageDriverOptions = {}): PageDriver {
  return {
    current() {
      const doc = options.document ?? globalThis.document;
      const root = doc.documentElement;
      const kind = getOptionalAttribute(root, "data-evjs-kind");
      const id = getOptionalAttribute(root, "data-evjs-id");

      return {
        appId: kind === "app" ? id : undefined,
        pageId: kind === "page" ? id : undefined,
        buildId: getOptionalAttribute(root, "data-evjs-build"),
        url: doc.location?.href,
      };
    },
  };
}

export function createHistoryDriver(
  options: HistoryDriverOptions,
): HistoryDriver {
  return {
    current() {
      return createActivationRequestFromUrl(
        options.manifest,
        getWindow(options).location.href,
      );
    },
    subscribe(callback) {
      const win = getWindow(options);
      const listener = () =>
        callback(
          createActivationRequestFromUrl(options.manifest, win.location.href),
        );
      win.addEventListener("popstate", listener);
      return () => win.removeEventListener("popstate", listener);
    },
  };
}

function getOptionalAttribute(
  element: Element | null | undefined,
  name: string,
): string | undefined {
  return element?.getAttribute(name) ?? undefined;
}

function getWindow(options: HistoryDriverOptions): BrowserWindowLike {
  const win = options.window ?? globalThis.window;
  if (!win) {
    throw new Error("[evjs] HistoryDriver requires a browser window.");
  }
  return win;
}
