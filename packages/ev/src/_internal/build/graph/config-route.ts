import fs from "node:fs/promises";
import path from "node:path";
import {
  getPageRouteParamNameValidationError,
  isBuildIdentifier,
} from "@evjs/shared";
import type {
  CoreApplicationNode,
  CoreClientRouteNode,
  CoreDocumentNode,
  CoreGraph,
  CorePageNode,
  CorePageScope,
  CoreRouteLocation,
  CoreRouteNode,
  CoreRoutePattern,
  CoreRouteSegment,
} from "@evjs/shared/manifest";
import {
  assertCoreGraph,
  BIGFISH_ROUTE_EXTENSION_ID,
  CONFIG_ROUTE_PROVIDER_ID,
} from "@evjs/shared/manifest";
import type {
  ResolvedConfigRoute,
  ResolvedConfigRouteApplication,
} from "../../../config/index.js";
import {
  PAGE_CONFIG_FILES,
  PAGE_CONFIG_LABEL,
  PAGE_ENTRY_BASENAME,
  PAGE_ENTRY_LABEL,
} from "../page-route-conventions.js";
import {
  formatParseErrorMessage,
  hasDefaultExport,
  parseRouteModuleWithError,
} from "../routes/shared.js";
import { isInsideCwd, isRealPathInsideCwd, toPosixPath } from "../utils.js";
import type { GraphConfig } from "./index.js";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;
const CONFIG_ROUTE_PRODUCER = {
  kind: "provider",
  id: CONFIG_ROUTE_PROVIDER_ID,
} as const;
const UNSAFE_PAGE_IDS = new Set(["__proto__", "constructor", "prototype"]);

type ConfigRouteGraphConfig = GraphConfig & {
  application: NonNullable<GraphConfig["application"]>;
};

interface ConfigRouteBuildState {
  cwd: string;
  config: ConfigRouteGraphConfig;
  pages: Record<string, CorePageNode>;
  routes: CoreRouteNode[];
  documents: Record<string, CoreDocumentNode>;
  pageIds: string[];
  routeIds: string[];
  pageIdByModule: Map<string, string>;
  pageIdByScope: Map<string, string>;
  pageReferenceById: Map<string, string>;
}

interface ConfigRouteSiblingIdentityOwner {
  address: string;
  kind: "page" | "redirect" | "group";
  pattern: string;
}

export interface ConfigRoutePluginExtensionInput {
  readonly source: string;
  readonly extensions: Readonly<Record<string, unknown>>;
}

export interface ConfigRoutePluginExtensionInputs {
  readonly routes: Readonly<Record<string, ConfigRoutePluginExtensionInput>>;
  readonly documents: Readonly<Record<string, ConfigRoutePluginExtensionInput>>;
}

/**
 * Retain explicit route-tree extension inputs outside the provider graph until
 * plugin declarations have registered, merged, and validated their namespaces.
 */
export function collectConfigRoutePluginExtensionInputs(
  application: ResolvedConfigRouteApplication,
): ConfigRoutePluginExtensionInputs {
  const routes = createRecord<ConfigRoutePluginExtensionInput>();
  const documents = createRecord<ConfigRoutePluginExtensionInput>();

  const visit = (
    declarations: ResolvedConfigRoute[],
    parentAddress: number[],
  ): void => {
    for (const [index, declaration] of declarations.entries()) {
      const address = [...parentAddress, index];
      if (declaration.extensions) {
        const routeId = createConfigRouteId(address);
        const semanticRouteId =
          typeof declaration.layout === "string"
            ? `${routeId}:content`
            : routeId;
        defineRecordValue(routes, semanticRouteId, {
          source: `application.${formatConfigRouteAddress(address)}.extensions`,
          extensions: declaration.extensions,
        });
      }
      if (declaration.routes) {
        visit(declaration.routes, address);
      }
    }
  };

  visit(application.routes, []);
  if (application.document.extensions) {
    defineRecordValue(documents, "index", {
      source: "application.document.extensions",
      extensions: application.document.extensions,
    });
  }
  return { routes, documents };
}

function createConfigRouteId(address: readonly number[]): string {
  return `${CONFIG_ROUTE_PROVIDER_ID}:route:${address.join(".")}`;
}

function formatConfigRouteAddress(address: readonly number[]): string {
  return `routes[${address.join("].routes[")}]`;
}

/** Normalize an explicit Bigfish-style migration route tree to CoreGraph. */
export async function createConfigRouteGraph(
  config: GraphConfig,
  cwd: string,
): Promise<CoreGraph> {
  assertConfigRouteGraphConfig(config);

  const pages = createRecord<CorePageNode>();
  const routes: CoreRouteNode[] = [];
  const documents = createRecord<CoreDocumentNode>();
  const state: ConfigRouteBuildState = {
    cwd,
    config,
    pages,
    routes,
    documents,
    pageIds: [],
    routeIds: [],
    pageIdByModule: new Map(),
    pageIdByScope: new Map(),
    pageReferenceById: new Map(),
  };
  const rootLayoutModule = config.application.layout
    ? await resolveProjectSourceModule(
        cwd,
        config.application.layout,
        "application.layout",
        "layout",
      )
    : undefined;
  await visitConfigRoutes(
    state,
    config.application.routes,
    undefined,
    { segments: [] },
    [],
  );
  await assertNoOrphanConfigRoutePageConfigs(state);

  const applicationId = "default";
  const applications = createRecord<CoreApplicationNode>();
  defineRecordValue(applications, applicationId, {
    id: applicationId,
    root: ".",
    routingMode: "spa",
    ...(rootLayoutModule ? { layout: rootLayoutModule } : {}),
    pageIds: state.pageIds,
    routeIds: state.routeIds,
    documentIds: ["index"],
    extensions: {},
    provenance: {
      producer: CONFIG_ROUTE_PRODUCER,
      source: config.application.pageRoot,
    },
  });

  defineRecordValue(documents, "index", {
    id: "index",
    template: config.application.document.template,
    output: "index.html",
    applicationId,
    owner: { kind: "application" },
    mount: config.application.document.mount,
    bootstrap: { kind: "application" },
    extensions: {},
    provenance: {
      producer: CONFIG_ROUTE_PRODUCER,
      source: config.application.document.template,
    },
  });

  const coreGraph: CoreGraph = {
    rootDir: cwd,
    applications,
    pages,
    routes,
    documents,
    extensions: {
      namespaces: createConfigRouteExtensionNamespaces(routes),
    },
    serverFunctions: [],
    serverRoutes: [],
  };
  assertCoreGraph(coreGraph, "application-route CoreGraph");
  return coreGraph;
}

/** Project-local Application, Page, and wrapper modules graph analysis scans. */
export function collectConfigRouteCoreSourceModules(
  graph: CoreGraph,
): string[] {
  return [
    ...Object.values(graph.applications).flatMap((application) =>
      application.layout ? [application.layout] : [],
    ),
    ...Object.values(graph.pages).map((page) => page.source.module),
    ...graph.routes.flatMap((route) => [
      ...route.facets.wrappers,
      ...(typeof route.facets.layout === "string" ? [route.facets.layout] : []),
    ]),
  ];
}

async function visitConfigRoutes(
  state: ConfigRouteBuildState,
  declarations: ResolvedConfigRoute[],
  parentId: string | undefined,
  parentPattern: CoreRoutePattern,
  parentAddress: number[],
): Promise<void> {
  const siblingIdentityOwners = new Map<
    string,
    ConfigRouteSiblingIdentityOwner
  >();
  for (const [index, declaration] of declarations.entries()) {
    const addressSegments = [...parentAddress, index];
    const address = formatConfigRouteAddress(addressSegments);
    const hasPage = Boolean(declaration.page || declaration.component);
    if (hasPage && declaration.redirect) {
      throw new Error(
        `[evjs] ${address} must declare exactly one target kind: page, redirect, or group.`,
      );
    }
    if (declaration.redirect && declaration.routes) {
      throw new Error(
        `[evjs] ${address} redirect routes cannot declare nested routes.`,
      );
    }
    if (!hasPage && !declaration.redirect && !declaration.routes) {
      throw new Error(
        `[evjs] ${address} must declare page, redirect, or nested routes.`,
      );
    }
    const routeId = createConfigRouteId(addressSegments);
    const pattern = parseConfigRoutePattern(
      declaration.path,
      parentPattern,
      `${address}.path`,
      true,
    );
    const routeKind = hasPage
      ? "page"
      : declaration.redirect
        ? "redirect"
        : "group";
    assertUniqueConfigRouteSiblingIdentity(
      siblingIdentityOwners,
      pattern,
      parentPattern,
      address,
      routeKind,
    );
    const childParentId = await materializeSpaConfigRoute(
      state,
      declaration,
      routeId,
      parentId,
      parentPattern,
      pattern,
      address,
    );

    if (declaration.routes) {
      await visitConfigRoutes(
        state,
        declaration.routes,
        childParentId,
        pattern,
        addressSegments,
      );
    }
  }
}

async function materializeSpaConfigRoute(
  state: ConfigRouteBuildState,
  declaration: ResolvedConfigRoute,
  routeId: string,
  parentId: string | undefined,
  parentPattern: CoreRoutePattern,
  pattern: CoreRoutePattern,
  address: string,
): Promise<string> {
  const wrappers = await Promise.all(
    (declaration.wrappers ?? []).map((module, wrapperIndex) =>
      resolveProjectSourceModule(
        state.cwd,
        module,
        `${address}.wrappers[${wrapperIndex}]`,
        "wrapper",
      ),
    ),
  );
  const layout =
    typeof declaration.layout === "string"
      ? await resolveProjectSourceModule(
          state.cwd,
          declaration.layout,
          `${address}.layout`,
          "layout",
        )
      : declaration.layout;
  let target: CoreClientRouteNode["target"];
  let provenanceSource: string | undefined;
  if (declaration.page || declaration.component) {
    const page = await defineConfigRoutePage(state, declaration, address);
    target = { kind: "page", pageId: page.pageId };
    provenanceSource = page.module;
  } else if (declaration.redirect) {
    const redirect = parseConfigRouteRedirect(
      declaration.redirect,
      parentPattern,
      `${address}.redirect`,
    );
    assertConfigRouteRedirectParams(pattern, redirect, `${address}.redirect`);
    target = { kind: "redirect", to: redirect };
    provenanceSource = declaration.redirect;
  } else {
    target = { kind: "group" };
  }

  let contentRouteId = routeId;
  let contentParentId = parentId;
  if (typeof layout === "string") {
    state.routes.push({
      id: routeId,
      applicationId: "default",
      ...(parentId ? { parentId } : {}),
      pattern,
      target: { kind: "group" },
      facets: { layout, wrappers: [] },
      extensions: {},
      provenance: {
        producer: CONFIG_ROUTE_PRODUCER,
        source: layout,
      },
    });
    state.routeIds.push(routeId);
    contentRouteId = `${routeId}:content`;
    contentParentId = routeId;
  }

  state.routes.push({
    id: contentRouteId,
    applicationId: "default",
    ...(contentParentId ? { parentId: contentParentId } : {}),
    pattern,
    target,
    facets: {
      ...(layout === false ? { layout: false as const } : {}),
      wrappers,
    },
    extensions: createBigfishRouteExtensions(declaration),
    provenance: {
      producer: CONFIG_ROUTE_PRODUCER,
      ...(provenanceSource ? { source: provenanceSource } : {}),
    },
  });
  state.routeIds.push(contentRouteId);
  return contentRouteId;
}

function createBigfishRouteExtensions(
  declaration: ResolvedConfigRoute,
): Record<string, unknown> {
  const extensions = createRecord<unknown>();
  if (declaration.metadata) {
    defineRecordValue(
      extensions,
      BIGFISH_ROUTE_EXTENSION_ID,
      declaration.metadata,
    );
  }
  return extensions;
}

function createConfigRouteExtensionNamespaces(
  routes: CoreRouteNode[],
): CoreGraph["extensions"]["namespaces"] {
  const namespaces =
    createRecord<CoreGraph["extensions"]["namespaces"][string]>();
  if (
    routes.some((route) =>
      Object.hasOwn(route.extensions, BIGFISH_ROUTE_EXTENSION_ID),
    )
  ) {
    defineRecordValue(namespaces, BIGFISH_ROUTE_EXTENSION_ID, {
      producer: CONFIG_ROUTE_PROVIDER_ID,
      owners: ["route"],
    });
  }
  return namespaces;
}

async function defineConfigRoutePage(
  state: ConfigRouteBuildState,
  declaration: ResolvedConfigRoute,
  address: string,
): Promise<{ pageId: string; pageReference: string; module: string }> {
  const canonicalReference = declaration.page;
  if (canonicalReference !== undefined) {
    assertSafeConfigRoutePageReference(canonicalReference, `${address}.page`);
  }
  const migrationModule = declaration.component
    ? await resolveProjectSourceModule(
        state.cwd,
        declaration.component,
        `${address}.component`,
        "component",
      )
    : undefined;
  const canonicalModule =
    migrationModule === undefined && canonicalReference
      ? await resolveCanonicalPageModule(
          state.cwd,
          state.config.application.pageRoot,
          canonicalReference,
          `${address}.page`,
        )
      : undefined;
  const module = canonicalModule ?? migrationModule;
  if (!module) {
    throw new Error(
      `[evjs] ${address} Page route must declare page or its resolved component migration projection.`,
    );
  }
  const scope = deriveConfigRoutePageScope(
    module,
    address,
    migrationModule === undefined ? "canonical" : "migration",
  );
  const derivedReference = deriveConfigRoutePageReference(
    state.config.application.pageRoot,
    scope,
    address,
  );
  if (
    migrationModule !== undefined &&
    canonicalReference !== undefined &&
    canonicalReference !== derivedReference
  ) {
    throw new Error(
      `[evjs] ${address}.component resolves Page source "${derivedReference}", but its normalized Page reference is "${canonicalReference}". The migration alias must identify one Page source.`,
    );
  }
  const pageReference = canonicalReference ?? derivedReference;
  const existingId = state.pageIdByModule.get(module);
  if (existingId) {
    const existingReference = state.pageReferenceById.get(existingId);
    if (existingReference !== pageReference) {
      throw new Error(
        `[evjs] ${address} resolves Page reference "${pageReference}" to "${module}", already claimed as "${existingReference}". Use one canonical Page reference per source.`,
      );
    }
    return { pageId: existingId, pageReference, module };
  }

  const pageId = deriveConfigRoutePageId(pageReference);
  const existingPage = Object.hasOwn(state.pages, pageId)
    ? state.pages[pageId]
    : undefined;
  if (existingPage) {
    const existingReference = state.pageReferenceById.get(pageId);
    throw new Error(
      `[evjs] ${address} Page reference "${pageReference}" derives build Page id "${pageId}", which conflicts with Page reference "${existingReference}" at "${existingPage.source.module}". Rename one Page directory so their build-safe ids stay unique.`,
    );
  }
  const scopeKey = getConfigRoutePageScopeKey(scope);
  const scopeOwner = state.pageIdByScope.get(scopeKey);
  if (scopeOwner) {
    throw new Error(
      `[evjs] ${address}.component resolves to ${formatConfigRoutePageScope(scope)}, already claimed by Page "${scopeOwner}". Move one component so page-private ownership stays unambiguous.`,
    );
  }
  const configModule =
    scope.kind === "directory"
      ? await discoverConfigRoutePageConfigModule(state.cwd, scope.root, pageId)
      : undefined;

  defineRecordValue(state.pages, pageId, {
    id: pageId,
    applicationId: "default",
    source: {
      module,
      ...(configModule ? { config: configModule } : {}),
      scope,
      provider: CONFIG_ROUTE_PROVIDER_ID,
    },
    render: "csr",
    extensions: {},
    provenance: {
      producer: CONFIG_ROUTE_PRODUCER,
      source: module,
    },
  });
  state.pageIdByModule.set(module, pageId);
  state.pageIdByScope.set(scopeKey, pageId);
  state.pageReferenceById.set(pageId, pageReference);
  state.pageIds.push(pageId);
  return { pageId, pageReference, module };
}

async function discoverConfigRoutePageConfigModule(
  cwd: string,
  scopeRoot: string,
  pageId: string,
): Promise<string | undefined> {
  const absoluteDirectory = path.resolve(cwd, scopeRoot);
  const candidates: string[] = [];
  for (const fileName of PAGE_CONFIG_FILES) {
    const absolute = path.join(absoluteDirectory, fileName);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(absolute);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
    if (!stat.isFile()) {
      throw new Error(
        `[evjs] Config-route Page "${pageId}" config "${toProjectModulePath(cwd, absolute)}" must be a regular ${PAGE_CONFIG_LABEL} module.`,
      );
    }
    candidates.push(absolute);
  }

  if (candidates.length > 1) {
    throw new Error(
      `[evjs] Config-route Page "${pageId}" has more than one Page config module: ${candidates
        .map((candidate) => toProjectModulePath(cwd, candidate))
        .join(
          ", ",
        )}. Keep exactly one ${PAGE_CONFIG_LABEL} beside its Page entry.`,
    );
  }
  const absolute = candidates[0];
  if (!absolute) return undefined;
  if (!(await isRealPathInsideCwd(cwd, absolute))) {
    throw new Error(
      `[evjs] Config-route Page "${pageId}" config "${toProjectModulePath(cwd, absolute)}" must resolve inside the project root after resolving symlinks.`,
    );
  }
  return toProjectModulePath(cwd, absolute);
}

async function assertNoOrphanConfigRoutePageConfigs(
  state: ConfigRouteBuildState,
): Promise<void> {
  const ownedDirectories = new Set(
    Object.values(state.pages).flatMap((page) =>
      page.source.scope.kind === "directory"
        ? [path.resolve(state.cwd, page.source.scope.root)]
        : [],
    ),
  );
  const pageRoot = path.resolve(state.cwd, state.config.application.pageRoot);
  const configModules = await collectConfigRoutePageConfigModules(
    state.cwd,
    pageRoot,
  );
  const orphan = configModules.find(
    (module) => !ownedDirectories.has(path.dirname(module)),
  );
  if (!orphan) return;
  throw new Error(
    `[evjs] Config-route Page config "${toProjectModulePath(state.cwd, orphan)}" is not colocated with a Page referenced by application.routes. Remove it or reference that Page directory from the explicit route tree.`,
  );
}

async function collectConfigRoutePageConfigModules(
  cwd: string,
  root: string,
): Promise<string[]> {
  const modules: string[] = [];

  async function visit(current: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(current, entry.name);
      if (!isInsideCwd(cwd, absolute)) continue;
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (
        (entry.isFile() || entry.isSymbolicLink()) &&
        PAGE_CONFIG_FILES.includes(
          entry.name as (typeof PAGE_CONFIG_FILES)[number],
        )
      ) {
        modules.push(absolute);
      }
    }
  }

  await visit(root);
  return modules.sort();
}

function deriveConfigRoutePageId(pageReference: string): string {
  if (pageReference === ".") return "index";
  const pageId = pageReference.replace(/[^A-Za-z0-9_-]+/g, "_");
  if (!isBuildIdentifier(pageId) || UNSAFE_PAGE_IDS.has(pageId)) {
    throw new Error(
      `[evjs] Application-route Page reference "${pageReference}" derives unsafe build Page id "${pageId}". Rename its Page directory.`,
    );
  }
  return pageId;
}

function deriveConfigRoutePageScope(
  module: string,
  address: string,
  source: "canonical" | "migration",
): CorePageScope {
  const basename = path.posix.basename(module).replace(/\.(?:tsx?|jsx?)$/, "");
  if (source === "canonical" && basename !== PAGE_ENTRY_BASENAME) {
    throw new Error(
      `[evjs] ${address} resolves to "${module}". Canonical Pages must use a Page directory with exactly one ${PAGE_ENTRY_LABEL} entry.`,
    );
  }
  if (basename === PAGE_ENTRY_BASENAME || basename === "index") {
    return { kind: "directory", root: path.posix.dirname(module) };
  }
  return { kind: "module", file: module };
}

function getConfigRoutePageScopeKey(scope: CorePageScope): string {
  return scope.kind === "directory"
    ? `directory:${scope.root}`
    : `module:${scope.file}`;
}

function formatConfigRoutePageScope(scope: CorePageScope): string {
  return scope.kind === "directory"
    ? `Page directory scope "${scope.root}"`
    : `Page module scope "${scope.file}"`;
}

function assertSafeConfigRoutePageReference(
  value: string,
  source: string,
): void {
  if (value === ".") return;
  if (
    value.trim() !== value ||
    value === "" ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.includes("//") ||
    value.includes("?") ||
    value.includes("#") ||
    value.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      `[evjs] ${source} must be a safe Page id relative to application.pageRoot.`,
    );
  }
}

function deriveConfigRoutePageReference(
  pageRoot: string,
  scope: CorePageScope,
  address: string,
): string {
  const normalizedPageRoot = path.posix.normalize(pageRoot);
  const source =
    scope.kind === "directory"
      ? scope.root
      : scope.file.slice(0, -path.posix.extname(scope.file).length);
  const relative = path.posix.relative(normalizedPageRoot, source);
  if (
    relative === ".." ||
    relative.startsWith("../") ||
    path.posix.isAbsolute(relative)
  ) {
    throw new Error(
      `[evjs] ${address}.component Page source "${source}" must be a child of application.pageRoot "${pageRoot}".`,
    );
  }
  if (relative === "" || relative === ".") return ".";
  assertSafeConfigRoutePageReference(relative, `${address}.component`);
  return relative;
}

function parseConfigRoutePattern(
  rawPath: string | undefined,
  parentPattern: CoreRoutePattern,
  source: string,
  requireNestedAbsolutePrefix = false,
): CoreRoutePattern {
  const value = rawPath ?? "";
  if (/\s/.test(value)) {
    throw new Error(`[evjs] ${source} must not contain whitespace.`);
  }
  if (/[?#]/.test(value)) {
    throw new Error(`[evjs] ${source} must not contain a query or hash.`);
  }
  if (value.includes("//") || (value.length > 1 && value.endsWith("/"))) {
    throw new Error(
      `[evjs] ${source} must not contain duplicate or trailing slash segments.`,
    );
  }
  const localSegments = parseConfigRouteSegments(value, source);
  if (
    requireNestedAbsolutePrefix &&
    value.startsWith("/") &&
    parentPattern.segments.length > 0 &&
    !isRoutePatternPrefix(parentPattern.segments, localSegments)
  ) {
    throw new Error(
      `[evjs] ${source} absolute nested path "${value}" must equal or start with its parent route pattern "${formatPattern(parentPattern)}". Use a relative child path or preserve the parent prefix explicitly.`,
    );
  }
  return {
    segments: value.startsWith("/")
      ? localSegments
      : [...parentPattern.segments, ...localSegments],
  };
}

function isRoutePatternPrefix(
  prefix: CoreRouteSegment[],
  value: CoreRouteSegment[],
): boolean {
  return prefix.every((segment, index) => {
    const candidate = value[index];
    if (!candidate) return false;
    if (segment.kind === "static") {
      return candidate.kind === "static" && candidate.value === segment.value;
    }
    if (segment.kind === "param") {
      return candidate.kind === "param" && candidate.name === segment.name;
    }
    return candidate.kind === "splat" && candidate.name === segment.name;
  });
}

function parseConfigRouteSegments(
  value: string,
  source: string,
): CoreRouteSegment[] {
  if (value === "" || value === "/") return [];
  const rawSegments = value.replace(/^\//, "").split("/");
  const seenParams = new Set<string>();
  return rawSegments.map<CoreRouteSegment>((segment, index) => {
    if (segment === "." || segment === "..") {
      throw new Error(`[evjs] ${source} must not contain dot segments.`);
    }
    if (segment === "*") {
      if (index !== rawSegments.length - 1) {
        throw new Error(
          `[evjs] ${source} Bigfish migration/config-route wildcard "*" must be terminal. The target Page file convention uses a terminal "$...splat" directory.`,
        );
      }
      return { kind: "splat", name: "_splat" };
    }
    if (segment.startsWith(":")) {
      const name = segment.slice(1);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error(
          `[evjs] ${source} Bigfish migration/config-route dynamic segment "${segment}" must use a valid identifier name. Optional and regexp parameters are not supported; the target Page file convention uses a "$param" directory.`,
        );
      }
      const nameError = getPageRouteParamNameValidationError(name);
      if (nameError === "reserved") {
        throw new Error(
          `[evjs] ${source} dynamic segment "${segment}" uses reserved parameter name "${name}".`,
        );
      }
      if (seenParams.has(name)) {
        throw new Error(
          `[evjs] ${source} repeats dynamic parameter name "${name}".`,
        );
      }
      seenParams.add(name);
      return { kind: "param", name };
    }
    if (/^[$*]/.test(segment)) {
      throw new Error(
        `[evjs] ${source} static segment "${segment}" conflicts with Bigfish migration/config-route syntax. Explicit route paths use ":param" and terminal "*"; the target Page file convention uses "$param" and terminal "$...splat" directories.`,
      );
    }
    return { kind: "static", value: segment };
  });
}

function parseConfigRouteRedirect(
  value: string,
  parentPattern: CoreRoutePattern,
  source: string,
): CoreRouteLocation {
  if (/^https?:\/\//.test(value)) return { kind: "url", href: value };
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || value.startsWith("//")) {
    throw new Error(
      `[evjs] ${source} must be an http(s) URL or an absolute/relative application route.`,
    );
  }
  return {
    kind: "route",
    pattern: parseConfigRoutePattern(value, parentPattern, source),
  };
}

function assertConfigRouteRedirectParams(
  sourcePattern: CoreRoutePattern,
  target: CoreRouteLocation,
  source: string,
): void {
  if (target.kind === "url") return;
  const sourceParams = new Set(
    sourcePattern.segments.flatMap((segment) =>
      segment.kind === "static" ? [] : [`${segment.kind}:${segment.name}`],
    ),
  );
  for (const segment of target.pattern.segments) {
    if (segment.kind === "static") continue;
    if (sourceParams.has(`${segment.kind}:${segment.name}`)) continue;
    throw new Error(
      `[evjs] ${source} target "${formatPattern(target.pattern)}" requires ${segment.kind} parameter "${segment.name}", but source route "${formatPattern(sourcePattern)}" cannot provide it. Dynamic redirect parameters must exist on the source route with the same name and kind.`,
    );
  }
}

function assertUniqueConfigRouteSiblingIdentity(
  owners: Map<string, ConfigRouteSiblingIdentityOwner>,
  pattern: CoreRoutePattern,
  parentPattern: CoreRoutePattern,
  address: string,
  kind: ConfigRouteSiblingIdentityOwner["kind"],
): void {
  if (kind === "group" && isSameConfigRoutePattern(pattern, parentPattern)) {
    return;
  }
  const shape = JSON.stringify(
    pattern.segments.map((segment) =>
      segment.kind === "static" ? ["static", segment.value] : [segment.kind],
    ),
  );
  const previous = owners.get(shape);
  if (previous) {
    throw new Error(
      `[evjs] ${address} ${kind} route "${formatPattern(pattern)}" conflicts with sibling ${previous.address} ${previous.kind} route "${previous.pattern}" under the same parent because they have the same runtime path shape. Merge the Page and nested routes into one Page route with routes, or keep a single group for this path.`,
    );
  }
  owners.set(shape, {
    address,
    kind,
    pattern: formatPattern(pattern),
  });
}

function isSameConfigRoutePattern(
  left: CoreRoutePattern,
  right: CoreRoutePattern,
): boolean {
  if (left.segments.length !== right.segments.length) return false;
  return left.segments.every((segment, index) => {
    const candidate = right.segments[index];
    if (!candidate || segment.kind !== candidate.kind) return false;
    if (segment.kind === "static") {
      return candidate.kind === "static" && segment.value === candidate.value;
    }
    return candidate.kind !== "static" && segment.name === candidate.name;
  });
}

async function resolveCanonicalPageModule(
  cwd: string,
  pageRoot: string,
  pageReference: string,
  source: string,
): Promise<string> {
  const absolutePageDirectory = path.resolve(cwd, pageRoot, pageReference);
  if (!isInsideCwd(cwd, absolutePageDirectory)) {
    throw new Error(`[evjs] ${source} must resolve inside the project root.`);
  }

  const candidates = SOURCE_EXTENSIONS.map((extension) =>
    path.join(absolutePageDirectory, `${PAGE_ENTRY_BASENAME}${extension}`),
  );
  const resolvedCandidates: string[] = [];
  for (const candidate of candidates) {
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(candidate);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
    if (!stat.isFile()) {
      throw new Error(
        `[evjs] ${source} canonical Page entry "${toProjectModulePath(cwd, candidate)}" must be a regular file.`,
      );
    }
    resolvedCandidates.push(candidate);
  }

  if (resolvedCandidates.length > 1) {
    throw new Error(
      `[evjs] ${source} Page "${pageReference}" has multiple canonical Page entries: ${resolvedCandidates
        .map((candidate) => toProjectModulePath(cwd, candidate))
        .join(", ")}. Keep exactly one ${PAGE_ENTRY_LABEL}.`,
    );
  }
  if (resolvedCandidates.length === 0) {
    const legacyCandidates: string[] = [];
    for (const extension of SOURCE_EXTENSIONS) {
      const candidate = path.join(absolutePageDirectory, `index${extension}`);
      try {
        if ((await fs.stat(candidate)).isFile())
          legacyCandidates.push(candidate);
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          (error as { code?: unknown }).code !== "ENOENT"
        ) {
          throw error;
        }
      }
    }
    const migrationHint =
      legacyCandidates.length === 0
        ? ""
        : ` Found legacy ${legacyCandidates
            .map((candidate) => toProjectModulePath(cwd, candidate))
            .join(
              ", ",
            )}; rename the Page entry to page.*, or reference the existing module explicitly from the Bigfish application.routes migration input (for example, "home/index").`;
    throw new Error(
      `[evjs] ${source} Page "${pageReference}" must resolve to exactly one ${PAGE_ENTRY_LABEL} inside "${toProjectModulePath(cwd, absolutePageDirectory)}".${migrationHint}`,
    );
  }

  const absolute = resolvedCandidates[0] as string;
  const module = toProjectModulePath(cwd, absolute);
  if (!(await isRealPathInsideCwd(cwd, absolute))) {
    throw new Error(
      `[evjs] ${source} canonical Page module "${module}" must resolve inside the project root. It points outside after resolving symlinks.`,
    );
  }
  await assertConfigRouteReactModule(absolute, module, source, "component");
  return module;
}

function toProjectModulePath(cwd: string, absolute: string): string {
  return `./${toPosixPath(path.relative(cwd, absolute))}`;
}

async function resolveProjectSourceModule(
  cwd: string,
  module: string,
  source: string,
  kind: "component" | "wrapper" | "layout",
): Promise<string> {
  const base = path.resolve(cwd, module);
  if (!isInsideCwd(cwd, base)) {
    throw new Error(`[evjs] ${source} must resolve inside the project root.`);
  }
  const candidates = [base];
  if (!SOURCE_EXTENSIONS.includes(path.extname(base) as never)) {
    candidates.push(
      ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    );
  }
  candidates.push(
    ...SOURCE_EXTENSIONS.map((extension) =>
      path.join(base, `index${extension}`),
    ),
  );
  for (const candidate of candidates) {
    if (!isInsideCwd(cwd, candidate)) continue;
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(candidate);
    } catch {
      // Try the next supported project-source candidate.
      continue;
    }
    if (
      stat.isFile() &&
      SOURCE_EXTENSIONS.includes(path.extname(candidate) as never)
    ) {
      const resolved = `./${toPosixPath(path.relative(cwd, candidate))}`;
      if (!(await isRealPathInsideCwd(cwd, candidate))) {
        throw new Error(
          `[evjs] ${source} ${kind} module "${resolved}" must resolve inside the project root. It points outside after resolving symlinks.`,
        );
      }
      await assertConfigRouteReactModule(candidate, resolved, source, kind);
      return resolved;
    }
  }
  throw new Error(
    `[evjs] ${source} reference "${module}" did not resolve to a project .ts, .tsx, .js, or .jsx module.`,
  );
}

async function assertConfigRouteReactModule(
  absolute: string,
  module: string,
  source: string,
  kind: "component" | "wrapper" | "layout",
): Promise<void> {
  const code = await fs.readFile(absolute, "utf-8");
  const { ast, error } = parseRouteModuleWithError(code);
  if (!ast) {
    throw new Error(
      `[evjs] ${source} ${kind} module "${module}" could not be parsed: ${formatParseErrorMessage(error, { firstLine: true })}`,
    );
  }
  if (!hasDefaultExport(ast)) {
    throw new Error(
      `[evjs] ${source} ${kind} module "${module}" must default-export a React component.`,
    );
  }
}

function formatPattern(pattern: CoreRoutePattern): string {
  if (pattern.segments.length === 0) return "/";
  return `/${pattern.segments
    .map((segment) => {
      if (segment.kind === "static") return segment.value;
      if (segment.kind === "param") return `:${segment.name}`;
      return "*";
    })
    .join("/")}`;
}

function assertConfigRouteGraphConfig(
  config: GraphConfig,
): asserts config is ConfigRouteGraphConfig {
  if (!config.application || config.routing) {
    throw new Error(
      "[evjs] CoreGraph application-route normalization requires one resolved Bigfish-style SPA application.routes declaration without canonical routing.",
    );
  }
}

function createRecord<T>(): Record<string, T> {
  return {};
}

function defineRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}
