import {
  BUILD_IDENTIFIER_DESCRIPTION,
  getPathPatternValidationError,
  getUrlStringValidationError,
  isBuildIdentifier,
  normalizeRoutePathname,
  type PathPatternValidationError,
  pageRoutePathShapeFromPath,
  type UrlStringValidationError,
} from "@evjs/shared";
import { isRecord } from "./validation.js";

export type HydrationMode = "none" | "load" | "visible" | "idle";
export type RenderMode = "csr" | "ssr" | "ssg";

export interface ClientRuntime {
  version: 1;
  buildId: string;
  runtime: {
    server?: {
      rsc?: string;
    };
    transport?: {
      baseUrl?: string;
    };
  };
  app?: ClientRuntimeApp;
  routing?: ClientRuntimeRouting;
  /** @deprecated Use routing.kind === "mpa".pages. */
  pages?: Record<string, ClientRuntimePage>;
  /** @deprecated Use routing.kind === "spa".routes or page route metadata. */
  routes?: ClientRuntimeRoute[];
}

export interface ClientAssetGroup {
  js: string[];
  css: string[];
}

export interface ClientRuntimeModule {
  type: "entry" | "lifecycle" | "react-component";
  href?: string;
}

export interface ClientRuntimeApp {
  mount?: string;
  module?: ClientRuntimeModule;
}

export interface ClientRuntimePage {
  mount?: string;
  module?: ClientRuntimeModule;
  path?: string;
  routeId?: string;
}

export interface ClientRuntimeRoute {
  id: string;
  path: string;
  pageId?: string;
}

export type ClientRuntimeRouting =
  | {
      kind: "spa";
      routes: ClientRuntimeRoute[];
    }
  | {
      kind: "mpa";
      pages: Record<string, ClientRuntimePage>;
    };

export function assertClientRuntime(
  value: unknown,
  source: string,
): asserts value is ClientRuntime {
  assertObject(value, source);
  if (value.version !== 1) {
    throw new Error(`[evjs] ${source}.version must be 1.`);
  }
  assertBuildIdentifier(value.buildId, `${source}.buildId`);
  assertObject(value.runtime, `${source}.runtime`);
  if (value.runtime.server !== undefined) {
    assertObject(value.runtime.server, `${source}.runtime.server`);
    assertRuntimePathname(
      value.runtime.server.rsc,
      `${source}.runtime.server.rsc`,
    );
  }
  if (value.runtime.transport !== undefined) {
    assertObject(value.runtime.transport, `${source}.runtime.transport`);
    assertRuntimeTransportBaseUrl(
      value.runtime.transport.baseUrl,
      `${source}.runtime.transport.baseUrl`,
    );
  }
  if (value.app !== undefined) {
    assertApp(value.app, `${source}.app`);
  }
  assertRuntimeRouting(value, source);
}

export function getClientRuntimePages(
  runtime: ClientRuntime,
): Record<string, ClientRuntimePage> {
  if (runtime.routing?.kind === "mpa") return runtime.routing.pages;
  return runtime.pages ?? {};
}

export function getClientRuntimeRoutes(
  runtime: ClientRuntime,
): ClientRuntimeRoute[] {
  if (runtime.routing?.kind === "spa") return runtime.routing.routes;
  if (runtime.routing?.kind === "mpa") {
    return createRoutesFromPages(runtime.routing.pages);
  }
  return runtime.routes ?? [];
}

function assertRuntimeRouting(
  value: Record<string, unknown>,
  source: string,
): void {
  if (value.routing !== undefined) {
    if (value.pages !== undefined || value.routes !== undefined) {
      throw new Error(
        `[evjs] ${source} must not define both routing and pages/routes.`,
      );
    }
    assertObject(value.routing, `${source}.routing`);
    if (value.routing.kind === "spa") {
      if (!Array.isArray(value.routing.routes)) {
        throw new Error(`[evjs] ${source}.routing.routes must be an array.`);
      }
      assertRoutes(value.routing.routes, `${source}.routing.routes`, {});
      return;
    }
    if (value.routing.kind === "mpa") {
      assertObject(value.routing.pages, `${source}.routing.pages`);
      assertPages(value.routing.pages, `${source}.routing.pages`);
      assertRoutes(
        createRoutesFromPages(value.routing.pages),
        `${source}.routing.pages`,
        value.routing.pages,
      );
      return;
    }
    throw new Error(`[evjs] ${source}.routing.kind must be "spa" or "mpa".`);
  }

  assertObject(value.pages, `${source}.pages`);
  assertPages(value.pages, `${source}.pages`);
  if (!Array.isArray(value.routes)) {
    throw new Error(`[evjs] ${source}.routes must be an array.`);
  }
  assertRoutes(value.routes, `${source}.routes`, value.pages);
}

function assertApp(value: unknown, source: string): void {
  assertObject(value, source);
  if (value.module !== undefined) {
    assertRuntimeModule(value.module, `${source}.module`);
  }
  if (value.mount !== undefined) {
    assertRuntimeString(value.mount, `${source}.mount`);
  }
}

function assertPages(value: Record<string, unknown>, source: string): void {
  for (const [name, page] of Object.entries(value)) {
    assertBuildIdentifierKey(name, source);
    const pageSource = `${source}.${name}`;
    assertObject(page, pageSource);
    if (page.mount !== undefined) {
      assertRuntimeString(page.mount, `${pageSource}.mount`);
    }
    if (page.module !== undefined) {
      assertRuntimeModule(page.module, `${pageSource}.module`);
    }
    if (page.path !== undefined) {
      assertRuntimePathname(page.path, `${pageSource}.path`, true);
    }
    if (page.routeId !== undefined) {
      assertRuntimeString(page.routeId, `${pageSource}.routeId`);
    }
  }
}

function createRoutesFromPages(
  pages: Record<string, unknown>,
): ClientRuntimeRoute[] {
  return Object.entries(pages).flatMap(([pageId, page]) => {
    if (!isRecord(page)) return [];
    if (typeof page.path !== "string" || typeof page.routeId !== "string") {
      return [];
    }
    return [
      {
        id: page.routeId,
        path: page.path,
        pageId,
      },
    ];
  });
}

function assertRuntimeModule(value: unknown, source: string): void {
  assertObject(value, source);
  if (
    value.type !== "entry" &&
    value.type !== "lifecycle" &&
    value.type !== "react-component"
  ) {
    throw new Error(
      `[evjs] ${source}.type must be "entry", "lifecycle", or "react-component".`,
    );
  }
  if (value.href !== undefined) {
    assertRuntimeString(value.href, `${source}.href`);
  }
}

function assertRoutes(
  value: unknown[],
  source: string,
  pages: Record<string, unknown>,
): void {
  const idOwners = new Map<string, string>();
  const pathOwners = new Map<string, { path: string; source: string }>();
  const shapeOwners = new Map<string, { path: string; source: string }>();

  value.forEach((route, index) => {
    const routeSource = `${source}[${index}]`;
    assertObject(route, routeSource);
    assertRuntimeString(route.id, `${routeSource}.id`);
    assertUniqueRouteId(route.id, `${routeSource}.id`, idOwners);
    assertRuntimePathname(route.path, `${routeSource}.path`, true);
    const path = route.path as string;
    assertUniqueRoutePath(path, `${routeSource}.path`, pathOwners);
    assertUniqueRouteShape(path, `${routeSource}.path`, shapeOwners);
    assertOptionalRecordReference(
      route.pageId,
      `${routeSource}.pageId`,
      `${source.replace(/\.routes$/, "")}.pages`,
      pages,
    );
  });
}

function assertOptionalRecordReference(
  value: unknown,
  source: string,
  recordsSource: string,
  records: Record<string, unknown>,
): void {
  if (value === undefined) return;
  assertRuntimeString(value, source);
  if (!Object.hasOwn(records, value)) {
    throw new Error(
      `[evjs] ${source} "${value}" does not match any ${formatRecordSource(recordsSource)} entry.`,
    );
  }
}

function formatRecordSource(source: string): string {
  return source.replace(/^.*? runtime\./, "runtime.");
}

function assertObject(
  value: unknown,
  source: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`[evjs] ${source} must be an object.`);
  }
}

function assertRuntimeString(
  value: unknown,
  source: string,
): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`[evjs] ${source} must be a non-empty string.`);
  }
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] ${source} must not contain leading or trailing whitespace.`,
    );
  }
}

function assertBuildIdentifier(value: unknown, source: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`[evjs] ${source} must be a non-empty string.`);
  }
  if (!isBuildIdentifier(value)) {
    throw new Error(
      `[evjs] ${source} must contain only ${BUILD_IDENTIFIER_DESCRIPTION}.`,
    );
  }
}

function assertBuildIdentifierKey(key: string, source: string): void {
  if (!isBuildIdentifier(key)) {
    throw new Error(
      `[evjs] ${source} key "${key}" must contain only ${BUILD_IDENTIFIER_DESCRIPTION}.`,
    );
  }
  if (key.trim() !== key) {
    throw new Error(
      `[evjs] ${source} key "${key}" must not contain leading or trailing whitespace.`,
    );
  }
}

function assertUniqueRouteId(
  id: string,
  source: string,
  idOwners: Map<string, string>,
): void {
  const existingSource = idOwners.get(id);
  if (existingSource) {
    throw new Error(
      `[evjs] ${source} duplicates ${existingSource} "${id}". Route ids must be unique.`,
    );
  }
  idOwners.set(id, source);
}

function assertUniqueRoutePath(
  path: string,
  source: string,
  pathOwners: Map<string, { path: string; source: string }>,
): void {
  const normalizedPath = normalizeRoutePathname(path);
  const existing = pathOwners.get(normalizedPath);
  if (existing) {
    throw new Error(
      `[evjs] ${source} duplicates ${existing.source} "${existing.path}". Page route paths must be unique.`,
    );
  }
  pathOwners.set(normalizedPath, { path, source });
}

function assertUniqueRouteShape(
  path: string,
  source: string,
  shapeOwners: Map<string, { path: string; source: string }>,
): void {
  const shape = pageRoutePathShapeFromPath(path);
  const existing = shapeOwners.get(shape);
  if (existing) {
    throw new Error(
      `[evjs] ${source} has the same route shape as ${existing.source} "${existing.path}". Use one page route per URL shape.`,
    );
  }
  shapeOwners.set(shape, { path, source });
}

function assertRuntimePathname(
  value: unknown,
  source: string,
  required = false,
): void {
  if (value === undefined) {
    if (required) {
      throw new Error(`[evjs] ${source} must be a non-empty pathname.`);
    }
    return;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`[evjs] ${source} must be a non-empty pathname.`);
  }
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] ${source} must not contain leading or trailing whitespace.`,
    );
  }
  const error = getPathPatternValidationError(value);
  if (error) {
    throw new Error(`[evjs] ${source} ${formatRuntimePathnameError(error)}`);
  }
}

function assertRuntimeTransportBaseUrl(value: unknown, source: string): void {
  if (value === undefined) return;
  const error = getUrlStringValidationError(value, {
    baseUrl: "http://evjs.local/",
  });
  if (error) {
    throw new Error(
      `[evjs] ${source} ${formatRuntimeTransportBaseUrlError(error)}`,
    );
  }
}

function formatRuntimeTransportBaseUrlError(
  error: UrlStringValidationError,
): string {
  switch (error) {
    case "empty":
      return "must be a non-empty URL string.";
    case "whitespace":
      return "must not contain leading or trailing whitespace.";
    case "invalid-url":
      return "must be a valid URL string.";
  }
}

function formatRuntimePathnameError(error: PathPatternValidationError): string {
  switch (error) {
    case "empty":
      return "must be a non-empty pathname.";
    case "missing-leading-slash":
      return 'must start with "/".';
    case "whitespace":
      return "must not contain whitespace.";
    case "query-or-hash":
      return "must not include a query string or hash.";
  }
}
