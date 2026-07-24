import {
  getPageRouteParamSegmentValidationError,
  getPathPatternValidationError,
  type PageRouteParamSegmentValidationError,
  type PathPatternValidationError,
  pageRoutePathShapeFromPath,
} from "@evjs/shared";
import {
  assertPageMetadata,
  clonePageMetadata,
  type PageMetadata,
} from "@evjs/shared/manifest";
import type { QueryClient } from "@tanstack/react-query";
import type {
  AnyRoute,
  ErrorRouteComponent,
  NotFoundRouteComponent,
  RouteComponent,
} from "@tanstack/react-router";
import {
  createRootRouteWithContext,
  redirect as createRouterRedirect,
  createRoute as createTanStackRoute,
  Outlet,
  useMatches,
} from "@tanstack/react-router";
import {
  type ComponentType,
  createElement,
  type ReactNode,
  useEffect,
} from "react";
import { isReactComponentExport } from "../../rsc/react-component.js";
import { isRecord } from "../../shared/validation.js";
import { type App, createApp } from "../../standalone/app.js";
import { PageProvider } from "./page-context.js";
import { createPageMetadataController } from "./page-metadata.js";

interface PageRouteContext {
  queryClient: QueryClient;
}

const EV_BYPASS_ROOT_LAYOUT_STATIC_DATA = "__evjsBypassRootLayout";
const EV_PAGE_METADATA_OWNER_STATIC_DATA = "__evjsPageMetadataOwner";
const EV_PAGE_METADATA_STATIC_DATA = "__evjsPageMetadata";

interface EvRouteStaticData {
  __evjsBypassRootLayout?: boolean;
  __evjsPageMetadataOwner?: true;
  __evjsPageMetadata?: PageMetadata;
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

export interface PageWrapperModule {
  default?: ComponentType<{ children?: ReactNode }>;
}

export type PageRouteRedirect =
  | { kind: "path"; path: string }
  | { kind: "url"; href: string };

export type PageRouteKind = "page" | "layout" | "group" | "redirect";

/** Framework-generated SPA bootstrap contract. */
export interface PageDefinition {
  id?: string;
  path: string;
  parentId?: string;
  kind?: PageRouteKind;
  module?: PageModule;
  redirect?: PageRouteRedirect;
  wrappers?: PageWrapperModule[];
  /** Bypass the generated Application/root layout for this route branch. */
  layout?: false;
  /** Static Page-owned title and named meta values. */
  metadata?: PageMetadata;
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
  const definitions = normalizePageDefinitions(options.routes);
  const pageMetadataController = createPageMetadataController(
    definitions.map((route) => route.metadata),
  );

  function RootRoute() {
    const outlet = createElement(Outlet);
    const RootComponent = options.rootModule?.default;
    const bypassRootLayout = useMatches({
      select: (matches) =>
        matches.some(
          (match) =>
            (match.staticData as EvRouteStaticData)[
              EV_BYPASS_ROOT_LAYOUT_STATIC_DATA
            ] === true,
        ),
    });
    const pageMetadata = useMatches({
      select: selectActivePageMetadata,
    });
    useEffect(() => {
      pageMetadataController.apply(pageMetadata);
      return () => pageMetadataController.restore();
    }, [pageMetadata]);
    return RootComponent && !bypassRootLayout
      ? createElement(RootComponent, undefined, outlet)
      : outlet;
  }

  const rootRoute = createPageRootRoute({
    component: RootRoute,
  });
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
  const children = childrenByParentId.get(definition.id) ?? [];
  let route: AnyRoute;
  const staticData = createGeneratedRouteStaticData(definition);
  // Generated route paths are runtime data, so TanStack's literal route generics
  // cannot be preserved past this generated route-tree adapter boundary.
  route = createTanStackRoute({
    getParentRoute: () => parentRoute,
    ...createGeneratedRoutePathOptions(definition, parentFullPath),
    ...(staticData ? { staticData } : {}),
    ...createGeneratedRouteBehavior(
      definition,
      () => route,
      children.length > 0,
    ),
  });

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

function createGeneratedRouteStaticData(
  definition: NormalizedPageDefinition,
): EvRouteStaticData | undefined {
  const staticData: EvRouteStaticData = {
    ...(definition.layout === false
      ? { [EV_BYPASS_ROOT_LAYOUT_STATIC_DATA]: true }
      : {}),
    ...(definition.kind === "page"
      ? {
          [EV_PAGE_METADATA_OWNER_STATIC_DATA]: true,
          ...(definition.metadata
            ? { [EV_PAGE_METADATA_STATIC_DATA]: definition.metadata }
            : {}),
        }
      : {}),
  };
  return Object.keys(staticData).length > 0 ? staticData : undefined;
}

function selectActivePageMetadata(
  matches: readonly { staticData: unknown }[],
): PageMetadata | undefined {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const staticData = matches[index]?.staticData as
      | EvRouteStaticData
      | undefined;
    if (staticData?.[EV_PAGE_METADATA_OWNER_STATIC_DATA]) {
      return staticData[EV_PAGE_METADATA_STATIC_DATA];
    }
  }
  return undefined;
}

function createGeneratedRouteBehavior(
  definition: NormalizedPageDefinition,
  getRoute: () => AnyRoute,
  hasChildren: boolean,
): Record<string, unknown> {
  if (definition.kind === "redirect") {
    const redirect = definition.redirect as PageRouteRedirect;
    return {
      beforeLoad() {
        throw redirect.kind === "url"
          ? createRouterRedirect({ href: redirect.href })
          : createRouterRedirect({ to: redirect.path, params: true });
      },
    };
  }

  const mod = definition.module ?? {};
  if (definition.kind === "group") {
    return {
      component: function EvGroupRoute() {
        return applyRouteWrappers(
          createElement(Outlet),
          definition.wrappers ?? [],
        );
      },
    };
  }
  if (definition.kind === "layout") {
    return {
      ...pickRouteOptions(mod),
      component: function EvLayoutRoute() {
        const outlet = createElement(Outlet);
        const Layout = mod.default;
        const content = Layout
          ? createElement(Layout, undefined, outlet)
          : outlet;
        return applyRouteWrappers(content, definition.wrappers ?? []);
      },
    };
  }
  return {
    ...pickRouteOptions(mod),
    component: function EvPageRoute() {
      const Component = mod.default;
      if (!Component) {
        throw new Error(
          `[evjs] Page route ${definition.path} must export a default React component.`,
        );
      }
      const route = getRoute();
      const pageProps = {
        params: route.useParams(),
        search: route.useSearch(),
        loaderData: route.useLoaderData(),
      };
      const outlet = hasChildren ? createElement(Outlet) : undefined;
      const PageComponent = Component as ComponentType<{
        children?: ReactNode;
      }>;
      const page = createElement(
        PageComponent,
        outlet ? { children: outlet } : undefined,
      );

      return createElement(
        PageProvider,
        { value: pageProps },
        applyRouteWrappers(page, definition.wrappers ?? []),
      );
    },
  };
}

function applyRouteWrappers(
  child: ReactNode,
  wrappers: PageWrapperModule[],
): ReactNode {
  return wrappers.reduceRight<ReactNode>((content, wrapper) => {
    const Wrapper = wrapper.default as ComponentType<{ children?: ReactNode }>;
    return createElement(Wrapper, undefined, content);
  }, child);
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
    const requiresModule = routeKind === "page" || routeKind === "layout";
    if (requiresModule && !isRecord(routeDefinition.module)) {
      throw new Error(
        `[evjs] createPagesApp() ${routePath}.module must be an object.`,
      );
    }
    if (!requiresModule && routeDefinition.module !== undefined) {
      throw new Error(
        `[evjs] createPagesApp() ${routePath}.module is not supported for ${routeKind} routes.`,
      );
    }
    if (routeKind === "page" && routeDefinition.module?.default == null) {
      throw new Error(
        `[evjs] Page route ${routeDefinition.path} must export a default React component.`,
      );
    }
    if (
      routeDefinition.module?.default !== undefined &&
      !isReactComponentExport(routeDefinition.module.default)
    ) {
      throw new Error(
        `[evjs] Page route ${routeDefinition.path} default export must be a React component.`,
      );
    }
    assertPageModuleOptions(routeDefinition.module, `${routePath}.module`);
    assertPageRouteRedirect(
      routeDefinition.redirect,
      routeKind,
      `${routePath}.redirect`,
    );
    assertPageWrapperModules(
      routeDefinition.wrappers,
      routeKind,
      `${routePath}.wrappers`,
    );
    assertPageRouteLayout(routeDefinition.layout, `${routePath}.layout`);
    assertPageRouteMetadata(
      routeDefinition.metadata,
      routeKind,
      `${routePath}.metadata`,
    );
    normalizedRoutes.push({
      id: routeId,
      path: definitionPath,
      ...(routeDefinition.parentId
        ? { parentId: routeDefinition.parentId }
        : {}),
      kind: routeKind,
      ...(routeDefinition.module ? { module: routeDefinition.module } : {}),
      ...(routeDefinition.redirect
        ? { redirect: routeDefinition.redirect }
        : {}),
      ...(routeDefinition.wrappers
        ? { wrappers: routeDefinition.wrappers }
        : {}),
      ...(routeDefinition.layout === false ? { layout: false as const } : {}),
      ...(routeDefinition.metadata
        ? { metadata: clonePageMetadata(routeDefinition.metadata) }
        : {}),
    });
  });
  assertRouteParentReferences(normalizedRoutes);
  assertUniqueSiblingRouteIdentities(normalizedRoutes);
}

function normalizePageDefinitions(
  definitions: PageDefinition[],
): NormalizedPageDefinition[] {
  return definitions.map((definition, index) => ({
    ...definition,
    id: getPageDefinitionId(definition, index),
    kind: getPageDefinitionKind(definition),
    ...(definition.metadata
      ? { metadata: clonePageMetadata(definition.metadata) }
      : {}),
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
  return definition.kind ?? "page";
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
    (definition.kind === "layout" || definition.kind === "group") &&
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
  if (
    value !== undefined &&
    value !== "page" &&
    value !== "layout" &&
    value !== "group" &&
    value !== "redirect"
  ) {
    throw new Error(
      `[evjs] createPagesApp() ${path} must be "page", "layout", "group", or "redirect".`,
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
    case "star-wildcard":
      return 'uses "*" as a wildcard segment. Use "$" for page route splats.';
  }
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
    if (parent.kind === "redirect") {
      throw new Error(
        `[evjs] Page route "${definition.id}" parentId "${definition.parentId}" must not reference a redirect route.`,
      );
    }
  }
}

function assertUniqueSiblingRouteIdentities(
  definitions: NormalizedPageDefinition[],
): void {
  const routesById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const ownersByParent = new Map<
    string | undefined,
    Map<string, { path: string; source: string }>
  >();

  definitions.forEach((definition, index) => {
    const parent = definition.parentId
      ? routesById.get(definition.parentId)
      : undefined;
    const parentPath = parent?.path ?? "/";
    if (
      (definition.kind === "layout" || definition.kind === "group") &&
      normalizeGeneratedRoutePath(definition.path) ===
        normalizeGeneratedRoutePath(parentPath)
    ) {
      return;
    }

    const source = `routes[${index}]`;
    const routeShape = pageRoutePathShapeFromPath(
      normalizeGeneratedRoutePath(definition.path),
    );
    const owners = ownersByParent.get(definition.parentId) ?? new Map();
    const previous = owners.get(routeShape);
    if (previous) {
      const parentLabel = definition.parentId
        ? `parent route "${definition.parentId}"`
        : "the root route";
      throw new Error(
        `[evjs] createPagesApp() ${source}.path "${definition.path}" conflicts with sibling ${previous.source}.path "${previous.path}" under ${parentLabel} because they have the same runtime path shape. Merge the component and nested routes into one component route with children, or keep a single group for this path.`,
      );
    }
    owners.set(routeShape, { path: definition.path, source });
    ownersByParent.set(definition.parentId, owners);
  });
}

function assertPageRouteRedirect(
  value: unknown,
  routeKind: PageRouteKind,
  path: string,
): asserts value is PageRouteRedirect | undefined {
  if (routeKind !== "redirect") {
    if (value !== undefined) {
      throw new Error(
        `[evjs] createPagesApp() ${path} is only supported for redirect routes.`,
      );
    }
    return;
  }
  if (!isRecord(value)) {
    throw new Error(`[evjs] createPagesApp() ${path} must be an object.`);
  }
  const keys = Object.keys(value);
  if (value.kind === "path") {
    if (keys.some((key) => key !== "kind" && key !== "path")) {
      throw new Error(
        `[evjs] createPagesApp() ${path} path redirect can only contain kind and path.`,
      );
    }
    assertRoutePath(value.path, `${path}.path`);
    return;
  }
  if (value.kind === "url") {
    if (keys.some((key) => key !== "kind" && key !== "href")) {
      throw new Error(
        `[evjs] createPagesApp() ${path} URL redirect can only contain kind and href.`,
      );
    }
    if (typeof value.href !== "string" || value.href.trim() !== value.href) {
      throw new Error(
        `[evjs] createPagesApp() ${path}.href must be a trimmed absolute http(s) URL.`,
      );
    }
    try {
      const url = new URL(value.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw null;
    } catch {
      throw new Error(
        `[evjs] createPagesApp() ${path}.href must be a trimmed absolute http(s) URL.`,
      );
    }
    return;
  }
  throw new Error(
    `[evjs] createPagesApp() ${path}.kind must be "path" or "url".`,
  );
}

function assertPageWrapperModules(
  value: unknown,
  routeKind: PageRouteKind,
  path: string,
): asserts value is PageWrapperModule[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new Error(`[evjs] createPagesApp() ${path} must be an array.`);
  }
  if (routeKind === "redirect" && value.length > 0) {
    throw new Error(
      `[evjs] createPagesApp() ${path} is not supported for redirect routes.`,
    );
  }
  value.forEach((wrapper, index) => {
    if (!isRecord(wrapper)) {
      throw new Error(
        `[evjs] createPagesApp() ${path}[${index}] must be a module object.`,
      );
    }
    if (!isReactComponentExport(wrapper.default)) {
      throw new Error(
        `[evjs] createPagesApp() ${path}[${index}].default must be a React component.`,
      );
    }
  });
}

function assertPageRouteLayout(
  value: unknown,
  path: string,
): asserts value is false | undefined {
  if (value !== undefined && value !== false) {
    throw new Error(`[evjs] createPagesApp() ${path} must be false when set.`);
  }
}

function assertPageRouteMetadata(
  value: unknown,
  routeKind: PageRouteKind,
  path: string,
): asserts value is PageMetadata | undefined {
  if (value === undefined) return;
  if (routeKind !== "page") {
    throw new Error(
      `[evjs] createPagesApp() ${path} is only supported for page routes.`,
    );
  }
  assertPageMetadata(value, `createPagesApp() ${path}`);
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

function assertPageModuleOptions(
  mod: Partial<PageModule> | undefined,
  path: string,
): void {
  if (!mod) return;
  assertOptionalFunction(mod.beforeLoad, `${path}.beforeLoad`);
  assertOptionalFunction(mod.loader, `${path}.loader`);
  assertOptionalFunction(mod.validateSearch, `${path}.validateSearch`);
  assertOptionalReactComponent(
    mod.pendingComponent,
    `${path}.pendingComponent`,
  );
  assertOptionalReactComponent(mod.errorComponent, `${path}.errorComponent`);
  assertOptionalReactComponent(
    mod.notFoundComponent,
    `${path}.notFoundComponent`,
  );
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
