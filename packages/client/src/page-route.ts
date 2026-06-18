import {
  getPageRouteParamSegmentValidationError,
  getPathPatternValidationError,
  type PageRouteParamSegmentValidationError,
  type PathPatternValidationError,
  pageRoutePathShapeFromPath,
} from "@evjs/shared";
import type { QueryClient } from "@tanstack/react-query";
import type {
  AnyRoute,
  ErrorRouteComponent,
  NotFoundRouteComponent,
  RouteComponent,
} from "@tanstack/react-router";
import {
  createRootRouteWithContext,
  createRoute as createTanStackRoute,
  Outlet,
} from "@tanstack/react-router";
import { type ComponentType, createElement, type ReactNode } from "react";
import { type App, createApp } from "./app.js";
import { PageProvider } from "./page-context.js";
import { isReactComponentExport } from "./react-component.js";
import { isRecord } from "./validation.js";

interface PageRouteContext {
  queryClient: QueryClient;
}

const createPageRootRoute = createRootRouteWithContext<PageRouteContext>();

/** Framework-generated SPA bootstrap contract. */
export interface PageModule {
  default?: RouteComponent;
  beforeLoad?: (...args: unknown[]) => unknown;
  loader?: (...args: unknown[]) => unknown;
  validateSearch?: (...args: unknown[]) => unknown;
  pendingComponent?: RouteComponent;
  errorComponent?: ErrorRouteComponent;
  notFoundComponent?: NotFoundRouteComponent;
}

/** Framework-generated SPA bootstrap contract. */
export interface RootLayoutModule {
  default?: ComponentType<{ children?: ReactNode }>;
}

export type PageRouteKind = "page" | "layout";

/** Framework-generated SPA bootstrap contract. */
export interface PageDefinition {
  id?: string;
  path: string;
  parentId?: string;
  kind?: PageRouteKind;
  module: PageModule;
}

interface NormalizedPageDefinition extends PageDefinition {
  id: string;
  kind: PageRouteKind;
}

/** Framework-generated SPA bootstrap contract. */
export interface CreatePagesAppOptions {
  routes: PageDefinition[];
  rootModule?: RootLayoutModule;
}

/** Framework-generated SPA bootstrap contract. */
export interface PagesApp {
  app: App;
}

type PageModuleRouteOptions = Omit<PageModule, "default">;

/** Framework-generated SPA bootstrap. */
export function createPagesApp(options: CreatePagesAppOptions): PagesApp {
  assertCreatePagesAppOptions(options);
  const routeTree = createGeneratedRouteTree(options);
  const app = createApp({ routeTree });

  return { app };
}

function createGeneratedRouteTree(options: CreatePagesAppOptions): AnyRoute {
  function RootRoute() {
    const outlet = createElement(Outlet);
    const RootComponent = options.rootModule?.default;
    return RootComponent
      ? createElement(RootComponent, undefined, outlet)
      : outlet;
  }

  const rootRoute = createPageRootRoute({ component: RootRoute });
  const definitions = normalizePageDefinitions(options.routes);
  const childrenByParentId = groupPageDefinitionsByParentId(definitions);
  const routes = (childrenByParentId.get(undefined) ?? []).map((definition) =>
    createGeneratedRoute(
      rootRoute,
      definition,
      "/",
      childrenByParentId,
      new Set(),
    ),
  );

  return rootRoute.addChildren(routes);
}

function createGeneratedRoute<TRootRoute extends AnyRoute>(
  parentRoute: TRootRoute,
  definition: NormalizedPageDefinition,
  parentFullPath: string,
  childrenByParentId: Map<string | undefined, NormalizedPageDefinition[]>,
  visitedRouteIds: Set<string>,
): AnyRoute {
  if (visitedRouteIds.has(definition.id)) {
    throw new Error(
      `[evjs] Page route "${definition.id}" has a circular parentId chain.`,
    );
  }
  const nextVisitedRouteIds = new Set(visitedRouteIds).add(definition.id);
  let route: AnyRoute;
  // Generated route paths are runtime data, so TanStack's literal route generics
  // cannot be preserved past this generated route-tree adapter boundary.
  route = createTanStackRoute({
    getParentRoute: () => parentRoute,
    ...createGeneratedRoutePathOptions(definition, parentFullPath),
    ...pickRouteOptions(definition.module),
    component:
      definition.kind === "layout"
        ? function EvLayoutRoute() {
            const outlet = createElement(Outlet);
            const Layout = definition.module.default;
            return Layout ? createElement(Layout, undefined, outlet) : outlet;
          }
        : function EvPageRoute() {
            const Component = definition.module.default;
            if (!Component) {
              throw new Error(
                `[evjs] Page route ${definition.path} must export a default React component.`,
              );
            }
            const pageProps = {
              params: route.useParams(),
              search: route.useSearch(),
              loaderData: route.useLoaderData(),
            };

            return createElement(
              PageProvider,
              { value: pageProps },
              createElement(Component),
            );
          },
  });

  const children = childrenByParentId.get(definition.id) ?? [];
  if (children.length === 0) return route;
  return route.addChildren(
    children.map((child) =>
      createGeneratedRoute(
        route,
        child,
        definition.path,
        childrenByParentId,
        nextVisitedRouteIds,
      ),
    ),
  );
}

function assertCreatePagesAppOptions(
  options: unknown,
): asserts options is CreatePagesAppOptions {
  if (!isRecord(options)) {
    throw new Error("[evjs] createPagesApp() options must be an object.");
  }
  if (!Array.isArray(options.routes)) {
    throw new Error("[evjs] createPagesApp() routes must be an array.");
  }
  if (options.rootModule !== undefined && !isRecord(options.rootModule)) {
    throw new Error("[evjs] createPagesApp() rootModule must be an object.");
  }
  if (
    options.rootModule?.default !== undefined &&
    !isReactComponentExport(options.rootModule.default)
  ) {
    throw new Error(
      "[evjs] createPagesApp() rootModule.default must be a React component.",
    );
  }

  const routePathOwners = new Map<string, string>();
  const routeShapeOwners = new Map<string, { path: string; owner: string }>();
  const routeIdOwners = new Map<string, string>();
  const normalizedRoutes: NormalizedPageDefinition[] = [];
  options.routes.forEach((definition, index) => {
    const routePath = `routes[${index}]`;
    if (!isRecord(definition)) {
      throw new Error(
        `[evjs] createPagesApp() ${routePath} must be an object.`,
      );
    }
    const routeDefinition = definition as Partial<PageDefinition>;
    assertOptionalRouteId(routeDefinition.id, `${routePath}.id`);
    assertOptionalRouteId(routeDefinition.parentId, `${routePath}.parentId`);
    assertOptionalRouteKind(routeDefinition.kind, `${routePath}.kind`);
    assertRoutePath(routeDefinition.path, `${routePath}.path`);
    const definitionPath = routeDefinition.path;
    const routeKind = getPageDefinitionKind(routeDefinition);
    const routeId = getPageDefinitionId(
      {
        id: routeDefinition.id,
        kind: routeDefinition.kind,
        path: definitionPath,
      },
      index,
    );
    assertUniqueRouteId(routeId, routePath, routeIdOwners);
    if (routeKind !== "layout") {
      assertUniqueRoutePath(definitionPath, routePath, routePathOwners);
      assertUniqueRouteShape(definitionPath, routePath, routeShapeOwners);
    }
    if (!isRecord(routeDefinition.module)) {
      throw new Error(
        `[evjs] createPagesApp() ${routePath}.module must be an object.`,
      );
    }
    if (routeKind !== "layout" && routeDefinition.module.default == null) {
      throw new Error(
        `[evjs] Page route ${routeDefinition.path} must export a default React component.`,
      );
    }
    if (
      routeDefinition.module.default !== undefined &&
      !isReactComponentExport(routeDefinition.module.default)
    ) {
      throw new Error(
        `[evjs] Page route ${routeDefinition.path} default export must be a React component.`,
      );
    }
    assertOptionalFunction(
      routeDefinition.module.beforeLoad,
      `${routePath}.module.beforeLoad`,
    );
    assertOptionalFunction(
      routeDefinition.module.loader,
      `${routePath}.module.loader`,
    );
    assertOptionalFunction(
      routeDefinition.module.validateSearch,
      `${routePath}.module.validateSearch`,
    );
    assertOptionalReactComponent(
      routeDefinition.module.pendingComponent,
      `${routePath}.module.pendingComponent`,
    );
    assertOptionalReactComponent(
      routeDefinition.module.errorComponent,
      `${routePath}.module.errorComponent`,
    );
    assertOptionalReactComponent(
      routeDefinition.module.notFoundComponent,
      `${routePath}.module.notFoundComponent`,
    );
    normalizedRoutes.push({
      id: routeId,
      path: definitionPath,
      ...(routeDefinition.parentId
        ? { parentId: routeDefinition.parentId }
        : {}),
      kind: routeKind,
      module: routeDefinition.module,
    });
  });
  assertRouteParentReferences(normalizedRoutes);
}

function normalizePageDefinitions(
  definitions: PageDefinition[],
): NormalizedPageDefinition[] {
  return definitions.map((definition, index) => ({
    ...definition,
    id: getPageDefinitionId(definition, index),
    kind: getPageDefinitionKind(definition),
  }));
}

function groupPageDefinitionsByParentId(
  definitions: NormalizedPageDefinition[],
): Map<string | undefined, NormalizedPageDefinition[]> {
  const childrenByParentId = new Map<
    string | undefined,
    NormalizedPageDefinition[]
  >();
  for (const definition of definitions) {
    const siblings = childrenByParentId.get(definition.parentId) ?? [];
    siblings.push(definition);
    childrenByParentId.set(definition.parentId, siblings);
  }
  return childrenByParentId;
}

function getPageDefinitionKind(definition: {
  kind?: PageRouteKind;
}): PageRouteKind {
  return definition.kind === "layout" ? "layout" : "page";
}

function getPageDefinitionId(
  definition: { id?: string; kind?: PageRouteKind; path: string },
  index: number,
): string {
  if (definition.id) return definition.id;
  return `${getPageDefinitionKind(definition)}:${definition.path}:${index}`;
}

function createGeneratedRoutePathOptions(
  definition: NormalizedPageDefinition,
  parentFullPath: string,
): { id: string } | { path: string } {
  if (
    definition.kind === "layout" &&
    normalizeGeneratedRoutePath(definition.path) ===
      normalizeGeneratedRoutePath(parentFullPath)
  ) {
    return { id: definition.id };
  }
  return {
    path: toRelativeGeneratedRoutePath(definition.path, parentFullPath),
  };
}

function toRelativeGeneratedRoutePath(
  fullPath: string,
  parentFullPath: string,
): string {
  const routePath = normalizeGeneratedRoutePath(fullPath);
  const parentPath = normalizeGeneratedRoutePath(parentFullPath);
  if (routePath === parentPath) return "/";
  if (parentPath === "/") {
    return routePath === "/" ? "/" : routePath.replace(/^\/+/, "");
  }
  const prefix = `${parentPath}/`;
  if (routePath.startsWith(prefix)) {
    return routePath.slice(prefix.length) || "/";
  }
  return routePath;
}

function normalizeGeneratedRoutePath(routePath: string): string {
  if (routePath === "/") return "/";
  return routePath.replace(/\/+$/g, "");
}

function assertRoutePath(
  value: unknown,
  path: string,
): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `[evjs] createPagesApp() ${path} must be a non-empty route path string.`,
    );
  }
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] createPagesApp() ${path} must not include leading or trailing whitespace.`,
    );
  }

  const error = getPathPatternValidationError(value);
  if (error) {
    throw new Error(
      `[evjs] createPagesApp() ${path} ${formatRoutePathError(error)}`,
    );
  }

  const paramError = getPageRouteParamSegmentValidationError(value);
  if (paramError) {
    throw new Error(
      `[evjs] createPagesApp() ${path} ${formatRouteParamError(paramError)}`,
    );
  }
}

function assertOptionalRouteId(
  value: unknown,
  path: string,
): asserts value is string | undefined {
  if (value === undefined) return;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `[evjs] createPagesApp() ${path} must be a non-empty route id string.`,
    );
  }
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] createPagesApp() ${path} must not include leading or trailing whitespace.`,
    );
  }
}

function assertOptionalRouteKind(
  value: unknown,
  path: string,
): asserts value is PageRouteKind | undefined {
  if (value !== undefined && value !== "page" && value !== "layout") {
    throw new Error(
      `[evjs] createPagesApp() ${path} must be "page" or "layout".`,
    );
  }
}

function formatRoutePathError(error: PathPatternValidationError): string {
  switch (error) {
    case "empty":
      return "must be a non-empty route path string.";
    case "missing-leading-slash":
      return 'must start with "/".';
    case "whitespace":
      return "must not contain whitespace.";
    case "query-or-hash":
      return "must not include a query string or hash.";
  }
}

function formatRouteParamError(
  error: PageRouteParamSegmentValidationError,
): string {
  switch (error.error) {
    case "empty":
      return `contains dynamic segment "${error.segment}" without a param name.`;
    case "reserved":
      return `uses reserved dynamic param name "${error.name}" in segment "${error.segment}". Use a safe application-specific name.`;
    case "duplicate":
      return `uses duplicate dynamic param name "${error.name}" in segment "${error.segment}". Use unique param names within one route path.`;
    case "duplicate-wildcard":
      return `contains more than one wildcard segment "${error.segment}". Use at most one wildcard segment in a route path.`;
  }
}

function assertUniqueRoutePath(
  value: string,
  path: string,
  routePathOwners: Map<string, string>,
): void {
  const previousOwner = routePathOwners.get(value);
  if (previousOwner) {
    throw new Error(
      `[evjs] createPagesApp() ${path}.path duplicates ${previousOwner}.path "${value}".`,
    );
  }
  routePathOwners.set(value, path);
}

function assertUniqueRouteShape(
  value: string,
  path: string,
  routeShapeOwners: Map<string, { path: string; owner: string }>,
): void {
  const routeShape = pageRoutePathShapeFromPath(value);
  const previousOwner = routeShapeOwners.get(routeShape);
  if (previousOwner) {
    throw new Error(
      `[evjs] createPagesApp() ${path}.path "${value}" has the same route shape as ${previousOwner.owner}.path "${previousOwner.path}". Use one dynamic param name for each URL shape.`,
    );
  }
  routeShapeOwners.set(routeShape, { path: value, owner: path });
}

function assertUniqueRouteId(
  value: string,
  path: string,
  routeIdOwners: Map<string, string>,
): void {
  const previousOwner = routeIdOwners.get(value);
  if (previousOwner) {
    throw new Error(
      `[evjs] createPagesApp() ${path}.id duplicates ${previousOwner}.id "${value}".`,
    );
  }
  routeIdOwners.set(value, path);
}

function assertRouteParentReferences(
  definitions: NormalizedPageDefinition[],
): void {
  const routesById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  for (const definition of definitions) {
    if (!definition.parentId) continue;
    const parent = routesById.get(definition.parentId);
    if (!parent) {
      throw new Error(
        `[evjs] Page route "${definition.id}" parentId "${definition.parentId}" does not match another route id.`,
      );
    }
    if (parent.kind !== "layout") {
      throw new Error(
        `[evjs] Page route "${definition.id}" parentId "${definition.parentId}" must reference a layout route.`,
      );
    }
  }
}

function assertOptionalFunction(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "function") {
    throw new Error(`[evjs] createPagesApp() ${path} must be a function.`);
  }
}

function assertOptionalReactComponent(value: unknown, path: string): void {
  if (value !== undefined && !isReactComponentExport(value)) {
    throw new Error(
      `[evjs] createPagesApp() ${path} must be a React component.`,
    );
  }
}

function pickRouteOptions(mod: PageModule): Partial<PageModuleRouteOptions> {
  return {
    ...(typeof mod.beforeLoad === "function"
      ? { beforeLoad: mod.beforeLoad }
      : {}),
    ...(typeof mod.loader === "function" ? { loader: mod.loader } : {}),
    ...(typeof mod.validateSearch === "function"
      ? { validateSearch: mod.validateSearch }
      : {}),
    ...(mod.pendingComponent ? { pendingComponent: mod.pendingComponent } : {}),
    ...(mod.errorComponent ? { errorComponent: mod.errorComponent } : {}),
    ...(mod.notFoundComponent
      ? { notFoundComponent: mod.notFoundComponent }
      : {}),
  };
}
