import type { App } from "../../standalone/app.js";
import { resolveAppContainer } from "../../standalone/app.js";

const PAGE_HYDRATION_ATTRIBUTE = "data-evjs-hydrate";

/**
 * Start a generated SPA entry. A server-owned hydration marker selects
 * hydration; an unmarked mount remains a normal CSR render.
 */
export function startPagesApp(app: App, container: string | HTMLElement): void {
  const mount = resolveAppContainer(container);
  const hydrationMode = readPageHydrationMode(mount);

  if (!hydrationMode) {
    startAppRender(app, mount, false);
    return;
  }

  startAppRender(app, mount, true);
}

function readPageHydrationMode(mount: HTMLElement): "load" | undefined {
  const value = mount.getAttribute(PAGE_HYDRATION_ATTRIBUTE);
  if (value === null) return undefined;
  if (value === "load") return value;
  throw new Error(`[evjs] ${PAGE_HYDRATION_ATTRIBUTE} must be "load".`);
}

function startAppRender(app: App, mount: HTMLElement, hydrate: boolean): void {
  try {
    void Promise.resolve(app.render(mount, { hydrate })).catch(
      reportPagesAppError,
    );
  } catch (error) {
    reportPagesAppError(error);
  }
}

function reportPagesAppError(error: unknown): void {
  const runtime = globalThis as typeof globalThis & {
    reportError?: (error: unknown) => void;
  };
  if (typeof runtime.reportError === "function") {
    runtime.reportError(error);
    return;
  }
  setTimeout(() => {
    throw error;
  }, 0);
}
