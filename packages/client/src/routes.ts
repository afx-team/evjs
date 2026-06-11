import type { RouteNode } from "@evjs/shared/manifest";
import { type ComponentType, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

export interface PageReference {
  kind: "evjs.react.page";
  /**
   * Static React page component module path.
   *
   * The build graph analyzer also reads the string literal passed to `page()`
   * directly from source. It becomes `RouteNode.module` in the manifest
   * contract, then `PageNode.component` / BuildPlan page renderer entries.
   */
  component: string;
}

export interface ReactRouteOptions {
  id?: string;
  page?: PageReference;
}

export type ReactRouteTarget = ComponentType | PageReference;

export interface ReactRouteDeclaration {
  kind: "evjs.react.route";
  path: string;
  id?: string;
  page?: PageReference;
  component?: ComponentType;
}

export interface ReactRoutes {
  kind: "evjs.react.routes";
  routes: ReactRouteDeclaration[];
  toRouteGraph(): RouteNode[];
}

export interface ReactAppOptions {
  entry?: string;
  html?: string;
  mount?: string;
  component?: ComponentType;
  render?: () => ReactNode;
  routes: ReactRouteDeclaration[] | ReactRoutes;
}

export interface ReactAppDeclaration {
  kind: "evjs.react.app";
  entry?: string;
  html?: string;
  mount?: string;
  component?: ComponentType;
  render?: () => ReactNode;
  routes: ReactRouteDeclaration[];
  toRouteGraph(): RouteNode[];
}

export function page(component: string): PageReference {
  return {
    kind: "evjs.react.page",
    component,
  };
}

export function route(
  path: string,
  component: ComponentType,
  options?: ReactRouteOptions,
): ReactRouteDeclaration;
export function route(
  path: string,
  page: PageReference,
  options?: ReactRouteOptions,
): ReactRouteDeclaration;
export function route(
  path: string,
  options?: ReactRouteOptions,
): ReactRouteDeclaration;
export function route(
  path: string,
  targetOrOptions: ReactRouteTarget | ReactRouteOptions = {},
  maybeOptions: ReactRouteOptions = {},
): ReactRouteDeclaration {
  const hasTarget = isRouteTarget(targetOrOptions);
  const options = hasTarget
    ? maybeOptions
    : (targetOrOptions as ReactRouteOptions);
  const target = hasTarget ? targetOrOptions : undefined;

  return {
    kind: "evjs.react.route",
    path,
    id: options.id,
    page: isPageReference(target) ? target : options.page,
    component: isComponentTarget(target) ? target : undefined,
  };
}

export function defineReactRoutes(
  routes: ReactRouteDeclaration[],
): ReactRoutes {
  return {
    kind: "evjs.react.routes",
    routes: [...routes],
    toRouteGraph() {
      return routes.map((item) => ({
        id: item.id ?? item.path,
        path: item.path,
        module: item.page?.component,
      }));
    },
  };
}

function isRouteTarget(
  value: ReactRouteTarget | ReactRouteOptions,
): value is ReactRouteTarget {
  return isComponentTarget(value) || isPageReference(value);
}

function isComponentTarget(value: unknown): value is ComponentType {
  return typeof value === "function";
}

function isPageReference(value: unknown): value is PageReference {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as PageReference).kind === "evjs.react.page"
  );
}

export function defineReactApp(options: ReactAppOptions): ReactAppDeclaration {
  const routes = Array.isArray(options.routes)
    ? [...options.routes]
    : [...options.routes.routes];
  startReactApp(options);

  return {
    kind: "evjs.react.app",
    entry: options.entry,
    html: options.html,
    mount: options.mount,
    component: options.component,
    render: options.render,
    routes,
    toRouteGraph() {
      return defineReactRoutes(routes).toRouteGraph();
    },
  };
}

const REACT_APP_ROOT = Symbol.for("evjs.reactAppRoot");

type ReactAppMountPoint = Element & {
  [REACT_APP_ROOT]?: Root;
};

function startReactApp(options: ReactAppOptions) {
  if (!options.component && !options.render) return;
  if (typeof document === "undefined") return;

  const mount = () => {
    const selector = options.mount ?? "#app";
    const mountPoint = document.querySelector(
      selector,
    ) as ReactAppMountPoint | null;
    if (!mountPoint) {
      throw new Error(`[evjs] Missing app mount point "${selector}".`);
    }

    const element = options.render
      ? options.render()
      : createElement(options.component as ComponentType);
    const root = mountPoint[REACT_APP_ROOT] ?? createRoot(mountPoint);
    mountPoint[REACT_APP_ROOT] = root;
    root.render(element);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    queueMicrotask(mount);
  }
}
