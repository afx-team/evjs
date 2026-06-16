import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AnyRoute } from "@tanstack/react-router";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { formatErrorDetail } from "./validation.js";

/**
 * Options for creating a framework-owned SPA runtime.
 */
export interface CreateAppOptions<TRouteTree extends AnyRoute> {
  /** The root route tree assembled by the generated page-route bootstrap. */
  routeTree: TRouteTree;
  /**
   * Optional custom QueryClient instance.
   */
  queryClient?: QueryClient;
}

/**
 * An initialized framework-owned SPA runtime.
 */
export interface App {
  /** The TanStack Query Client instance. */
  queryClient: QueryClient;
  /**
   * Mount the application into the DOM.
   * @param container - A CSS selector string or an HTMLElement.
   */
  render(container: string | HTMLElement): void;
  /**
   * Unmount the application from the DOM.
   */
  unmount(): void;
}

/**
 * Create a framework-owned SPA runtime from the generated page route tree.
 */
export function createApp<TRouteTree extends AnyRoute>(
  options: CreateAppOptions<TRouteTree>,
): App {
  const { routeTree, queryClient = new QueryClient() } = options;

  const router = createRouter({
    routeTree,
    defaultPreload: "intent",
    context: { queryClient },
  });

  let root: ReturnType<typeof createRoot> | undefined;

  function render(container: string | HTMLElement): void {
    const el = resolveAppContainer(container);

    root = createRoot(el);
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }

  function unmount(): void {
    root?.unmount();
    root = undefined;
  }

  return { queryClient, render, unmount };
}

function resolveAppContainer(container: string | HTMLElement): HTMLElement {
  if (typeof container === "string") {
    const selector = assertAppContainerSelector(container);
    const doc = resolveAppDocument(selector);
    let element: HTMLElement | null;
    try {
      element = doc.querySelector<HTMLElement>(selector);
    } catch (error) {
      throw new Error(
        `[evjs] App container selector "${selector}" is invalid${formatErrorDetail(error)}`,
      );
    }
    if (!element) {
      throw new Error(
        `[evjs] Could not find app container element: ${selector}`,
      );
    }
    return element;
  }

  if (!container || typeof container !== "object") {
    throw new Error(
      "[evjs] App container must be a selector string or HTMLElement.",
    );
  }
  return container;
}

function assertAppContainerSelector(selector: string): string {
  if (!selector.trim()) {
    throw new Error(
      "[evjs] App container selector must be a non-empty string.",
    );
  }
  if (selector.trim() !== selector) {
    throw new Error(
      "[evjs] App container selector must not include leading or trailing whitespace.",
    );
  }
  return selector;
}

function resolveAppDocument(selector: string): Document {
  const doc = globalThis.document;
  if (!doc) {
    throw new Error(
      `[evjs] Document is not available to resolve app container selector "${selector}".`,
    );
  }
  if (typeof doc.querySelector !== "function") {
    throw new Error(
      "[evjs] App container selector document.querySelector must be a function.",
    );
  }
  return doc;
}
