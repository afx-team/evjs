import fs from "node:fs/promises";
import path from "node:path";
import {
  getPageRouteParamNameValidationError,
  isBuildIdentifier,
  isDotRouteSegment,
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
  CONFIG_ROUTE_PROVIDER_ID,
  coreRoutePatternShape,
  coreRoutePatternsEqual,
  isCoreRoutePatternPrefix,
} from "@evjs/shared/manifest";
import type { ResolvedConfigRoute } from "../../../config/index.js";
import { DEFAULT_PAGE_RENDER_MODE } from "../page-rendering-contract.js";
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
import {
  isMissingSourcePathError,
  isProjectSourceModule,
  PROJECT_SOURCE_EXTENSIONS,
  registerProjectSourceDependencies,
  registerProjectSourceResolutionCandidates,
} from "./source-resolution.js";

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
  beforeSourceRead?: (file: string) => void;
  onSourceDependency?: (file: string) => void;
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

function createConfigRouteId(address: readonly number[]): string {
  return `${CONFIG_ROUTE_PROVIDER_ID}:route:${address.join(".")}`;
}

function formatConfigRouteAddress(address: readonly number[]): string {
  return `routes[${address.join("].routes[")}]`;
}

/** Normalize an explicit SPA route tree to CoreGraph. */
export async function createConfigRouteGraph(
  config: GraphConfig,
  cwd: string,
  beforeSourceRead?: (file: string) => void,
  onSourceDependency?: (file: string) => void,
): Promise<CoreGraph> {
  assertConfigRouteGraphConfig(config);

  const pages = createRecord<CorePageNode>();
  const routes: CoreRouteNode[] = [];
  const documents = createRecord<CoreDocumentNode>();
  const state: ConfigRouteBuildState = {
    cwd,
    config,
    beforeSourceRead,
    onSourceDependency,
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
        undefined,
        beforeSourceRead,
        onSourceDependency,
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
    plugins: {},
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
    plugins: { entries: {} },
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
        undefined,
        state.beforeSourceRead,
        state.onSourceDependency,
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
          undefined,
          state.beforeSourceRead,
          state.onSourceDependency,
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
    provenance: {
      producer: CONFIG_ROUTE_PRODUCER,
      ...(provenanceSource ? { source: provenanceSource } : {}),
    },
  });
  state.routeIds.push(contentRouteId);
  return contentRouteId;
}

async function defineConfigRoutePage(
  state: ConfigRouteBuildState,
  declaration: ResolvedConfigRoute,
  address: string,
): Promise<{ pageId: string; pageReference: string; module: string }> {
  const declaredPageReference = declaration.page;
  if (declaredPageReference !== undefined) {
    assertSafeConfigRoutePageReference(
      declaredPageReference,
      `${address}.page`,
      state.config.application.pageRoot,
    );
  }
  const explicitModule = declaration.component
    ? await resolveProjectSourceModule(
        state.cwd,
        declaration.component,
        `${address}.component`,
        "component",
        state.config.application.pageRoot,
        state.beforeSourceRead,
        state.onSourceDependency,
      )
    : undefined;
  const anchoredModule =
    explicitModule === undefined && declaredPageReference
      ? await resolveConfigRoutePageModule(
          state.cwd,
          state.config.application.pageRoot,
          declaredPageReference,
          `${address}.page`,
          state.beforeSourceRead,
          state.onSourceDependency,
        )
      : undefined;
  const module = anchoredModule ?? explicitModule;
  if (!module) {
    throw new Error(
      `[evjs] ${address} Page route must declare page or a resolved component.`,
    );
  }
  const scope = deriveConfigRoutePageScope(
    module,
    address,
    explicitModule === undefined ? "anchor" : "component",
    state.config.application.pageRoot,
  );
  const derivedReference = deriveConfigRoutePageReference(
    state.config.application.pageRoot,
    scope,
    address,
  );
  if (
    explicitModule !== undefined &&
    declaredPageReference !== undefined &&
    declaredPageReference !== derivedReference
  ) {
    throw new Error(
      `[evjs] ${address}.component resolves Page source "${derivedReference}" under application.pageRoot "${state.config.application.pageRoot}", but its normalized Page reference is "${declaredPageReference}". The explicit reference must identify one Page source.`,
    );
  }
  const pageReference = declaredPageReference ?? derivedReference;
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
    render: DEFAULT_PAGE_RENDER_MODE,
    plugins: {},
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
    `[evjs] Config-route Page config "${toProjectModulePath(state.cwd, orphan)}" under application.pageRoot "${state.config.application.pageRoot}" is not colocated with a Page referenced by application.routes. Remove it or reference that Page directory from the explicit route tree.`,
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
  source: "anchor" | "component",
  pageRoot: string,
): CorePageScope {
  const basename = path.posix.basename(module).replace(/\.(?:tsx?|jsx?)$/, "");
  if (source === "anchor" && basename !== PAGE_ENTRY_BASENAME) {
    throw new Error(
      `[evjs] ${address}.page resolves to "${module}" under application.pageRoot "${pageRoot}". Page references must select a directory with exactly one ${PAGE_ENTRY_LABEL} entry.`,
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
  pageRoot: string,
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
      `[evjs] ${source} must be a safe Page id relative to application.pageRoot "${pageRoot}".`,
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
  assertSafeConfigRoutePageReference(
    relative,
    `${address}.component`,
    pageRoot,
  );
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
    !isCoreRoutePatternPrefix(parentPattern, { segments: localSegments })
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

function parseConfigRouteSegments(
  value: string,
  source: string,
): CoreRouteSegment[] {
  if (value === "" || value === "/") return [];
  const rawSegments = value.replace(/^\//, "").split("/");
  const seenParams = new Set<string>();
  return rawSegments.map<CoreRouteSegment>((segment, index) => {
    if (isDotRouteSegment(segment)) {
      throw new Error(`[evjs] ${source} must not contain dot segments.`);
    }
    if (segment === "*") {
      if (index !== rawSegments.length - 1) {
        throw new Error(
          `[evjs] ${source} application.routes wildcard "*" must be terminal. The Page file convention uses a terminal "$...splat" directory.`,
        );
      }
      return { kind: "splat", name: "_splat" };
    }
    if (segment.startsWith(":")) {
      const name = segment.slice(1);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error(
          `[evjs] ${source} application.routes dynamic segment "${segment}" must use a valid identifier name. Optional and regexp parameters are not supported; the Page file convention uses a "$param" directory.`,
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
        `[evjs] ${source} static segment "${segment}" conflicts with application.routes syntax. Explicit route paths use ":param" and terminal "*"; the Page file convention uses "$param" and terminal "$...splat" directories.`,
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
  if (kind === "group" && coreRoutePatternsEqual(pattern, parentPattern)) {
    return;
  }
  const shape = coreRoutePatternShape(pattern);
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

async function resolveConfigRoutePageModule(
  cwd: string,
  pageRoot: string,
  pageReference: string,
  source: string,
  beforeSourceRead?: (file: string) => void,
  onSourceDependency?: (file: string) => void,
): Promise<string> {
  const absolutePageDirectory = path.resolve(cwd, pageRoot, pageReference);
  if (!isInsideCwd(cwd, absolutePageDirectory)) {
    throw new Error(`[evjs] ${source} must resolve inside the project root.`);
  }

  const candidates = registerProjectSourceDependencies(
    cwd,
    PROJECT_SOURCE_EXTENSIONS.map((extension) =>
      path.join(absolutePageDirectory, `${PAGE_ENTRY_BASENAME}${extension}`),
    ),
    onSourceDependency,
  );
  const resolvedCandidates: string[] = [];
  for (const candidate of candidates) {
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(candidate);
    } catch (error) {
      if (isMissingSourcePathError(error)) continue;
      throw error;
    }
    if (!stat.isFile()) {
      throw new Error(
        `[evjs] ${source} Page entry "${toProjectModulePath(cwd, candidate)}" under application.pageRoot "${pageRoot}" must be a regular file.`,
      );
    }
    resolvedCandidates.push(candidate);
  }

  if (resolvedCandidates.length > 1) {
    throw new Error(
      `[evjs] ${source} Page "${pageReference}" has multiple Page entries under application.pageRoot "${pageRoot}": ${resolvedCandidates
        .map((candidate) => toProjectModulePath(cwd, candidate))
        .join(", ")}. Keep exactly one ${PAGE_ENTRY_LABEL}.`,
    );
  }
  if (resolvedCandidates.length === 0) {
    const alternateResolutionCandidates = registerProjectSourceDependencies(
      cwd,
      PROJECT_SOURCE_EXTENSIONS.map((extension) =>
        path.join(absolutePageDirectory, `index${extension}`),
      ),
      onSourceDependency,
    );
    const alternateCandidates: string[] = [];
    for (const candidate of alternateResolutionCandidates) {
      try {
        if ((await fs.stat(candidate)).isFile())
          alternateCandidates.push(candidate);
      } catch (error) {
        if (!isMissingSourcePathError(error)) throw error;
      }
    }
    const explicitReferenceHint =
      alternateCandidates.length === 0
        ? ""
        : ` Found non-anchor Page modules ${alternateCandidates
            .map((candidate) => toProjectModulePath(cwd, candidate))
            .join(
              ", ",
            )}; rename the Page entry to page.*, or reference the existing module explicitly from application.routes with a component relative to application.pageRoot (for example, "@/pages/${pageReference === "." ? "index" : `${pageReference}/index`}").`;
    throw new Error(
      `[evjs] ${source} Page "${pageReference}" must resolve to exactly one ${PAGE_ENTRY_LABEL} inside application.pageRoot "${pageRoot}" at "${toProjectModulePath(cwd, absolutePageDirectory)}".${explicitReferenceHint}`,
    );
  }

  const absolute = resolvedCandidates[0] as string;
  const module = toProjectModulePath(cwd, absolute);
  if (!(await isRealPathInsideCwd(cwd, absolute))) {
    throw new Error(
      `[evjs] ${source} Page module "${module}" under application.pageRoot "${pageRoot}" must resolve inside the project root after resolving symlinks.`,
    );
  }
  if (!(await isRealPathInsideDirectory(pageRoot, absolute, cwd))) {
    throw new Error(
      `[evjs] ${source} Page module "${module}" must resolve inside application.pageRoot "${pageRoot}" after resolving symlinks.`,
    );
  }
  await assertConfigRouteReactModule(
    absolute,
    module,
    source,
    "component",
    beforeSourceRead,
  );
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
  pageRoot?: string,
  beforeSourceRead?: (file: string) => void,
  onSourceDependency?: (file: string) => void,
): Promise<string> {
  const base = path.resolve(cwd, module);
  if (!isInsideCwd(cwd, base)) {
    throw new Error(`[evjs] ${source} must resolve inside the project root.`);
  }
  const projectCandidates = registerProjectSourceResolutionCandidates(
    cwd,
    base,
    onSourceDependency,
  );
  for (const candidate of projectCandidates) {
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(candidate);
    } catch (error) {
      if (!isMissingSourcePathError(error)) throw error;
      // Try the next supported project-source candidate.
      continue;
    }
    if (stat.isFile() && isProjectSourceModule(candidate)) {
      const resolved = `./${toPosixPath(path.relative(cwd, candidate))}`;
      if (!(await isRealPathInsideCwd(cwd, candidate))) {
        throw new Error(
          `[evjs] ${source} ${kind} module "${resolved}" must resolve inside the project root. It points outside after resolving symlinks.`,
        );
      }
      if (
        pageRoot !== undefined &&
        !(await isRealPathInsideDirectory(pageRoot, candidate, cwd))
      ) {
        throw new Error(
          `[evjs] ${source} component module "${resolved}" must resolve inside application.pageRoot "${pageRoot}" after resolving symlinks.`,
        );
      }
      await assertConfigRouteReactModule(
        candidate,
        resolved,
        source,
        kind,
        beforeSourceRead,
      );
      return resolved;
    }
  }
  throw new Error(
    pageRoot === undefined
      ? `[evjs] ${source} reference "${module}" did not resolve to a project .ts, .tsx, .js, or .jsx module.`
      : `[evjs] ${source} reference "${module}" did not resolve to a .ts, .tsx, .js, or .jsx Page component inside application.pageRoot "${pageRoot}".`,
  );
}

async function isRealPathInsideDirectory(
  directory: string,
  candidate: string,
  cwd: string,
): Promise<boolean> {
  const [realDirectory, realCandidate] = await Promise.all([
    fs.realpath(path.resolve(cwd, directory)),
    fs.realpath(candidate),
  ]);
  return isInsideCwd(realDirectory, realCandidate);
}

async function assertConfigRouteReactModule(
  absolute: string,
  module: string,
  source: string,
  kind: "component" | "wrapper" | "layout",
  beforeSourceRead?: (file: string) => void,
): Promise<void> {
  beforeSourceRead?.(absolute);
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
      "[evjs] CoreGraph application-route normalization requires one resolved SPA application.routes declaration without canonical routing.",
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
