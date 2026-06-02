import type {
  HydrationMode,
  RenderMode,
  RouteNode,
  ServerRuntime,
} from "@evjs/shared/manifest";

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
  render?: RenderMode;
  hydrate?: HydrationMode;
  runtime?: ServerRuntime;
}

export interface ReactRouteDeclaration {
  kind: "evjs.react.route";
  path: string;
  id?: string;
  page?: PageReference;
  render?: RenderMode;
  hydrate?: HydrationMode;
  runtime?: ServerRuntime;
}

export interface ReactRoutes {
  kind: "evjs.react.routes";
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
  options: ReactRouteOptions = {},
): ReactRouteDeclaration {
  return {
    kind: "evjs.react.route",
    path,
    id: options.id,
    page: options.page,
    render: options.render,
    hydrate: options.hydrate,
    runtime: options.runtime,
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
        render: item.render,
        hydrate: item.hydrate,
        runtime: item.runtime,
      }));
    },
  };
}
