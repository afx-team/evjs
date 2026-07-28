import fs from "node:fs/promises";
import path from "node:path";
import type { PageRouteNode } from "@evjs/shared/manifest";
import type {
  PageAnchorMetadata,
  PageRouteDiscoveryMetadata,
  PageRoutingMode,
} from "../../config/index.js";
import { collectModuleExportNames } from "./module-exports.js";
import {
  findPageRouteSegmentConventionViolation,
  formatPageRouteSegmentConventionViolation,
  isPageRouteGroupSegment,
  isPageRouteSourceModuleFile,
  normalizePageRouteConventionPath,
  PAGE_CONFIG_FILES,
  PAGE_CONFIG_LABEL,
  PAGE_ENTRY_LABEL,
  type PageRouteSegmentConventionViolation,
  parsePageAnchorRouteFile,
  routeIdPathFromSegments,
  routePathFromSegments,
  routeShapeFromSegments,
} from "./page-route-conventions.js";
import { sortPageRoutes } from "./page-route-order.js";
import {
  formatParseErrorMessage,
  hasDefaultExport,
  parseRouteModuleWithError,
} from "./routes/shared.js";
import {
  deriveRouteIdFromPath,
  isInsideCwd,
  isRealPathInsideCwd,
  toPosixPath,
  toProjectPath,
} from "./utils.js";

export interface DiscoverPageRoutesOptions {
  dir: string;
  mode: PageRoutingMode;
  required?: boolean;
}

export interface PageRouteDiscoveryDiagnostic {
  level: "warning" | "error";
  message: string;
  file?: string;
}

export interface PageRouteDiscovery {
  routes: PageRouteNode[];
  rootModule?: string;
  files: string[];
  dependencies: string[];
  metadata?: PageRouteDiscoveryMetadata;
  diagnostics: PageRouteDiscoveryDiagnostic[];
}

export type PageComponentExportKind = "default" | "named-page";

export type PageComponentExportAnalysis =
  | { kind: PageComponentExportKind }
  | { error: string };

const SPA_ONLY_PAGE_EXPORTS = new Set([
  "beforeLoad",
  "loader",
  "validateSearch",
  "pendingComponent",
  "errorComponent",
  "notFoundComponent",
]);

/** Find a component export that can be bridged into a canonical Page. */
export function analyzePageComponentExports(
  source: string,
): PageComponentExportAnalysis {
  const { ast, error } = parseRouteModuleWithError(source);
  if (!ast) {
    return {
      error: `the module could not be parsed: ${formatParseErrorMessage(error, {
        firstLine: true,
      })}`,
    };
  }

  const exportNames = new Set(collectModuleExportNames(ast.body));
  if (exportNames.has("default")) return { kind: "default" };
  if (exportNames.has("Page")) return { kind: "named-page" };
  return {
    error:
      'the module must export a default component or a named "Page" component',
  };
}

export async function discoverPageRoutes(
  cwd: string,
  options: DiscoverPageRoutesOptions,
): Promise<PageRouteDiscovery> {
  if (options.mode !== "spa" && options.mode !== "mpa") {
    throw new Error(
      '[evjs] Internal Page route discovery requires mode "spa" or "mpa".',
    );
  }
  const absoluteDir = path.resolve(cwd, options.dir);
  const diagnostics: PageRouteDiscoveryDiagnostic[] = [];
  const validDirectory = await validatePageRouteDirectory(
    cwd,
    absoluteDir,
    options.required === true,
    diagnostics,
  );
  if (!validDirectory) {
    return {
      routes: [],
      files: [],
      dependencies: [],
      diagnostics,
    };
  }

  const { files } = await collectPageRouteTree(cwd, absoluteDir);
  return discoverPageAnchorRoutes(
    cwd,
    absoluteDir,
    files,
    options,
    diagnostics,
  );
}

async function discoverPageAnchorRoutes(
  cwd: string,
  absoluteDir: string,
  files: string[],
  options: DiscoverPageRoutesOptions,
  diagnostics: PageRouteDiscoveryDiagnostic[],
): Promise<PageRouteDiscovery> {
  const anchors = files.flatMap((file) => {
    const routeRel = toPosixPath(path.relative(absoluteDir, file));
    const parsed = parsePageAnchorRouteFile(routeRel);
    return parsed
      ? [
          {
            file,
            routeRel,
            sourceRel: toProjectPath(cwd, file),
            segments: parsed.segments,
          },
        ]
      : [];
  });
  const anchorDirectories = new Set(
    anchors.map((anchor) => path.dirname(anchor.file)),
  );
  for (const file of files) {
    if (
      PAGE_CONFIG_FILES.includes(
        path.basename(file) as (typeof PAGE_CONFIG_FILES)[number],
      ) &&
      !anchorDirectories.has(path.dirname(file))
    ) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticPath(toProjectPath(cwd, file)),
        message: `Page config modules must be colocated with a ${PAGE_ENTRY_LABEL} anchor. A componentless layout or pathless group Route cannot own page.config.ts route extensions; add the Page anchor, keep its data in explicit application.routes, use Route-extension defaults, or rename this ordinary module.`,
      });
    }
  }

  if (anchors.length === 0) {
    return { routes: [], files, dependencies: [], diagnostics };
  }

  const activeScopeKeys = new Set<string>();
  for (const anchor of anchors) {
    for (let length = 0; length <= anchor.segments.length; length += 1) {
      activeScopeKeys.add(routeSegmentKey(anchor.segments.slice(0, length)));
    }
  }

  const routeCandidates: PageRouteCandidate[] = [];
  const layoutCandidatesBySegments = new Map<string, PageRouteCandidate>();
  const errorModulesBySegments = new Map<string, PageRouteConventionModule>();
  const notFoundModulesBySegments = new Map<
    string,
    PageRouteConventionModule
  >();
  const routeByPath = new Map<string, string>();
  const routeByShape = new Map<string, { file: string; path: string }>();
  const routeById = new Map<string, { file: string; path: string }>();
  const discoveredFiles = new Set(files);
  const dependencies = new Set<string>();
  const pages: PageAnchorMetadata[] = [];

  for (const file of files) {
    const sourceRel = toProjectPath(cwd, file);
    const routeRel = toPosixPath(path.relative(absoluteDir, file));
    const conventionFile = parsePageRouteConventionFile(routeRel);
    if (conventionFile) {
      const scopeKey = routeSegmentKey(conventionFile.segments);
      if (!activeScopeKeys.has(scopeKey)) continue;
      if (options.mode === "mpa") {
        diagnostics.push({
          level: "error",
          file: toDiagnosticPath(sourceRel),
          message: `${formatPageRouteConventionKind(conventionFile.kind)} conventions are SPA-only and cannot be used with routing.mode "mpa". Remove the facet or use routing.mode "spa".`,
        });
        continue;
      }
      const segmentViolation = findPageRouteSegmentConventionViolation(
        conventionFile.segments,
        { allowCatchAll: true },
      );
      if (segmentViolation) {
        diagnostics.push({
          level: "error",
          file: toDiagnosticPath(sourceRel),
          message: formatPageAnchorSegmentViolation(segmentViolation),
        });
        continue;
      }
      const validConventionModule = await validatePageRouteConventionModule(
        file,
        conventionFile.kind,
        diagnostics,
        sourceRel,
      );
      if (!validConventionModule) continue;

      const map =
        conventionFile.kind === "error"
          ? errorModulesBySegments
          : notFoundModulesBySegments;
      const previous = map.get(scopeKey);
      if (previous) {
        diagnostics.push({
          level: "error",
          file: toDiagnosticPath(sourceRel),
          message: `Duplicate ${formatPageRouteConventionKind(conventionFile.kind)} convention for ${formatPageRouteConventionScope(conventionFile.segments)}. ${previous.module} already owns this scope. Keep one ${conventionFile.kind === "error" ? "error" : "not-found"}.* module per route directory.`,
        });
        continue;
      }
      map.set(scopeKey, {
        module: sourceRel,
        segments: conventionFile.segments,
      });
      continue;
    }

    const layoutFile = parsePageLayoutRouteFile(routeRel);
    if (!layoutFile || layoutFile.segments.length === 0) continue;
    if (!activeScopeKeys.has(routeSegmentKey(layoutFile.segments))) continue;

    const segmentViolation = findPageRouteSegmentConventionViolation(
      layoutFile.segments,
      { allowCatchAll: true },
    );
    if (segmentViolation) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticPath(sourceRel),
        message: formatPageAnchorSegmentViolation(segmentViolation),
      });
      continue;
    }
    const validRouteModule = await validateRouteModule(file, diagnostics, {
      file: sourceRel,
      parseError: "Layout route module could not be parsed",
      missingDefaultExport:
        "Page-anchor layout modules must default-export a React component.",
    });
    if (!validRouteModule) continue;

    const routePath = routePathFromSegments(layoutFile.segments);
    const routeId = deriveLayoutRouteIdFromSegments(layoutFile.segments);
    const previousIdOwner = routeById.get(routeId);
    if (previousIdOwner) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticPath(sourceRel),
        message: `Duplicate page route id "${routeId}" for layout path "${routePath}" also generated by ${previousIdOwner.file} (${previousIdOwner.path}). Rename one route directory so generated route ids are unique.`,
      });
      continue;
    }
    routeById.set(routeId, { file: sourceRel, path: routePath });
    const candidate: PageRouteCandidate = {
      id: routeId,
      path: routePath,
      module: sourceRel,
      segments: layoutFile.segments,
      kind: "layout",
    };
    routeCandidates.push(candidate);
    layoutCandidatesBySegments.set(
      routeSegmentKey(layoutFile.segments),
      candidate,
    );
  }

  for (const anchor of anchors) {
    const segmentViolation = findPageRouteSegmentConventionViolation(
      anchor.segments,
      { allowCatchAll: true },
    );
    if (segmentViolation) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticPath(anchor.sourceRel),
        message: formatPageAnchorSegmentViolation(segmentViolation),
      });
      continue;
    }

    const validRouteModule = await validateRouteModule(
      anchor.file,
      diagnostics,
      {
        file: anchor.sourceRel,
        parseError: "Page-anchor route module could not be parsed",
        missingDefaultExport:
          "page.* anchor modules must default-export a React component. Rename ordinary modules so only route anchors use the page.* basename.",
        ...(options.mode === "mpa"
          ? { unsupportedExports: SPA_ONLY_PAGE_EXPORTS }
          : {}),
      },
    );
    if (!validRouteModule) continue;

    const routePath = routePathFromSegments(anchor.segments);
    const previous = routeByPath.get(routePath);
    if (previous) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticPath(anchor.sourceRel),
        message: `Duplicate page.* anchor for route path "${routePath}" also declared by ${previous}. Keep exactly one page.ts, page.tsx, page.js, or page.jsx module per route directory.`,
      });
      continue;
    }
    routeByPath.set(routePath, anchor.sourceRel);

    const routeShape = routeShapeFromSegments(anchor.segments);
    const previousShapeOwner = routeByShape.get(routeShape.key);
    if (previousShapeOwner) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticPath(anchor.sourceRel),
        message: createAmbiguousRouteShapeDiagnostic(
          routeShape.label,
          routePath,
          previousShapeOwner,
        ),
      });
      continue;
    }
    routeByShape.set(routeShape.key, {
      file: anchor.sourceRel,
      path: routePath,
    });

    const routeId = deriveRouteIdFromPath(
      routeIdPathFromSegments(anchor.segments),
    );
    const previousIdOwner = routeById.get(routeId);
    if (previousIdOwner) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticPath(anchor.sourceRel),
        message: `Duplicate page route id "${routeId}" for path "${routePath}" also generated by ${previousIdOwner.file} (${previousIdOwner.path}). Rename one route directory so generated route ids are unique.`,
      });
      continue;
    }
    routeById.set(routeId, { file: anchor.sourceRel, path: routePath });
    const html =
      options.mode === "mpa"
        ? await discoverPageAnchorHtmlTemplate(
            cwd,
            anchor.file,
            discoveredFiles,
            diagnostics,
          )
        : undefined;
    routeCandidates.push({
      id: routeId,
      path: routePath,
      module: anchor.sourceRel,
      ...(html ? { html } : {}),
      scope: {
        kind: "directory",
        root: toProjectPath(cwd, path.dirname(anchor.file)),
      },
      segments: anchor.segments,
      kind: "page",
    });
    pages.push(
      await discoverPageAnchorMetadata(
        cwd,
        anchor.file,
        routeId,
        discoveredFiles,
        dependencies,
        diagnostics,
      ),
    );
  }

  for (const candidate of routeCandidates) {
    const scopedConventions = findScopedPageRouteConventions(
      candidate.segments,
      errorModulesBySegments,
      notFoundModulesBySegments,
    );
    candidate.errorModule ??= scopedConventions.errorModule;
    candidate.notFoundModule ??= scopedConventions.notFoundModule;
  }

  const rootModule = await discoverPageAnchorRootLayout(
    cwd,
    absoluteDir,
    files,
    diagnostics,
  );

  return {
    routes: sortPageRoutes(
      routeCandidates.map((route) => {
        const parentId = findParentLayoutRouteId(
          route,
          layoutCandidatesBySegments,
        );
        return {
          id: route.id,
          path: route.path,
          module: route.module,
          ...(route.scope ? { scope: route.scope } : {}),
          ...(route.html ? { html: route.html } : {}),
          ...(parentId ? { parentId } : {}),
          ...(route.kind === "layout" ? { kind: route.kind } : {}),
          ...(route.errorModule ? { errorModule: route.errorModule } : {}),
          ...(route.notFoundModule
            ? { notFoundModule: route.notFoundModule }
            : {}),
        };
      }),
    ),
    ...(rootModule ? { rootModule } : {}),
    files: [...discoveredFiles].sort(),
    dependencies: [...dependencies].sort(),
    metadata: {
      pages: pages.sort(comparePageAnchorMetadata),
    },
    diagnostics,
  };
}

async function discoverPageAnchorMetadata(
  cwd: string,
  anchorFile: string,
  pageId: string,
  files: Set<string>,
  dependencies: Set<string>,
  diagnostics: PageRouteDiscoveryDiagnostic[],
): Promise<PageAnchorMetadata> {
  const absoluteDirectory = path.dirname(anchorFile);
  const metadata: PageAnchorMetadata = {
    pageId,
    directory: toProjectPath(cwd, absoluteDirectory),
    entry: toProjectPath(cwd, anchorFile),
    exportName: "default",
  };
  const candidates: Array<{
    absolute: string;
    stat: import("node:fs").Stats;
  }> = [];
  for (const fileName of PAGE_CONFIG_FILES) {
    const absolute = path.join(absoluteDirectory, fileName);
    const stat = await statIfExists(absolute);
    if (stat) candidates.push({ absolute, stat });
  }
  if (candidates.length === 0) return metadata;
  if (candidates.length > 1) {
    const duplicate = candidates[1];
    if (!duplicate) return metadata;
    diagnostics.push({
      level: "error",
      file: toDiagnosticPath(toProjectPath(cwd, duplicate.absolute)),
      message: `Page "${pageId}" has more than one Page config module. Keep exactly one ${PAGE_CONFIG_LABEL} beside its page.* anchor.`,
    });
    return metadata;
  }

  const [{ absolute: absoluteConfigModule, stat: configStat }] = candidates;
  const configModule = toProjectPath(cwd, absoluteConfigModule);
  if (!(await isRealPathInsideCwd(cwd, absoluteConfigModule))) {
    diagnostics.push({
      level: "error",
      file: toDiagnosticPath(configModule),
      message: `Page config must resolve inside the project root. ${configModule} points outside after resolving symlinks.`,
    });
    return metadata;
  }

  files.add(absoluteConfigModule);
  dependencies.add(absoluteConfigModule);
  if (!configStat.isFile()) {
    diagnostics.push({
      level: "error",
      file: toDiagnosticPath(configModule),
      message: `Page config must be a regular ${PAGE_CONFIG_LABEL} module.`,
    });
    return metadata;
  }

  metadata.configModule = configModule;
  return metadata;
}

async function discoverPageAnchorHtmlTemplate(
  cwd: string,
  anchorFile: string,
  files: Set<string>,
  diagnostics: PageRouteDiscoveryDiagnostic[],
): Promise<string | undefined> {
  const absoluteHtmlFile = path.join(path.dirname(anchorFile), "index.html");
  const htmlStat = await statIfExists(absoluteHtmlFile);
  if (!htmlStat) return undefined;

  const htmlFile = toProjectPath(cwd, absoluteHtmlFile);
  if (!(await isRealPathInsideCwd(cwd, absoluteHtmlFile))) {
    diagnostics.push({
      level: "error",
      file: toDiagnosticPath(htmlFile),
      message: `Page HTML template must resolve inside the project root. ${htmlFile} points outside after resolving symlinks.`,
    });
    return undefined;
  }
  if (!htmlStat.isFile()) {
    diagnostics.push({
      level: "error",
      file: toDiagnosticPath(htmlFile),
      message: "Page HTML template must be a regular file named index.html.",
    });
    return undefined;
  }

  files.add(absoluteHtmlFile);
  return htmlFile;
}

function comparePageAnchorMetadata(
  left: PageAnchorMetadata,
  right: PageAnchorMetadata,
): number {
  if (left.pageId < right.pageId) return -1;
  if (left.pageId > right.pageId) return 1;
  if (left.directory < right.directory) return -1;
  if (left.directory > right.directory) return 1;
  return 0;
}

async function validatePageRouteDirectory(
  cwd: string,
  absoluteRouteDir: string,
  required: boolean,
  diagnostics: PageRouteDiscoveryDiagnostic[],
): Promise<boolean> {
  const expected = toProjectPath(cwd, absoluteRouteDir);
  if (!isInsideCwd(cwd, absoluteRouteDir)) {
    if (required) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticPath(expected),
        message: `Page route directory must be inside the project root. ${expected} is not supported.`,
      });
    }
    return false;
  }

  let stat: import("node:fs").Stats;
  try {
    stat = await fs.stat(absoluteRouteDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    if (required) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticPath(expected),
        message: `Page route directory not found: ${expected}.`,
      });
    }
    return false;
  }

  if (!(await isRealPathInsideCwd(cwd, absoluteRouteDir))) {
    diagnostics.push({
      level: "error",
      file: toDiagnosticPath(expected),
      message: `Page route directory must resolve inside the project root. ${expected} points outside after resolving symlinks.`,
    });
    return false;
  }

  if (!stat.isDirectory()) {
    if (required) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticPath(expected),
        message: `Page route directory must be a directory: ${expected}.`,
      });
    }
    return false;
  }

  return true;
}

interface PageRouteCandidate extends PageRouteNode {
  segments: string[];
  kind: "page" | "layout";
}

interface PageLayoutRouteFileConvention {
  segments: string[];
}

interface PageRouteConventionFile {
  kind: "error" | "not-found";
  segments: string[];
}

interface PageRouteConventionModule {
  module: string;
  segments: string[];
}

function parsePageRouteConventionFile(
  routeRel: string,
): PageRouteConventionFile | undefined {
  const normalizedRouteRel = normalizePageRouteConventionPath(routeRel);
  if (!isPageRouteSourceModuleFile(path.posix.basename(normalizedRouteRel))) {
    return undefined;
  }

  const extension = path.posix.extname(normalizedRouteRel);
  const withoutExt = normalizedRouteRel.slice(0, -extension.length);
  const segments = withoutExt.split("/").filter(Boolean);
  if (segments.length === 0) return undefined;

  const name = segments[segments.length - 1] ?? "";
  if (name === "error") {
    return { kind: "error", segments: segments.slice(0, -1) };
  }
  if (name === "not-found") {
    return { kind: "not-found", segments: segments.slice(0, -1) };
  }
  return undefined;
}

function parsePageLayoutRouteFile(
  routeRel: string,
): PageLayoutRouteFileConvention | undefined {
  const normalizedRouteRel = normalizePageRouteConventionPath(routeRel);
  if (!isPageRouteSourceModuleFile(path.posix.basename(normalizedRouteRel))) {
    return undefined;
  }

  const extension = path.posix.extname(normalizedRouteRel);
  const withoutExt = normalizedRouteRel.slice(0, -extension.length);
  const segments = withoutExt.split("/").filter(Boolean);
  if (segments.length === 0) return undefined;

  const name = segments[segments.length - 1] ?? "";
  if (name === "error" || name === "not-found") return undefined;
  if (name === "layout") {
    if (segments.length === 1) return { segments: [] };
    return { segments: segments.slice(0, -1) };
  }
  return undefined;
}

function deriveLayoutRouteIdFromSegments(segments: string[]): string {
  const identityPath = routeIdentityPathFromSegments(segments);
  const baseId = deriveRouteIdFromPath(identityPath);
  return baseId === "index" ? "layout" : `${baseId}_layout`;
}

function routeIdentityPathFromSegments(segments: string[]): string {
  if (segments.length === 0) return "/";
  return `/${segments.map(routeIdentitySegment).join("/")}`;
}

function routeIdentitySegment(segment: string): string {
  if (!isPageRouteGroupSegment(segment)) return segment;
  return `group_${segment.slice(1, -1)}`;
}

function findParentLayoutRouteId(
  route: PageRouteCandidate,
  layoutCandidatesBySegments: Map<string, PageRouteCandidate>,
): string | undefined {
  const maxLength =
    route.kind === "layout" ? route.segments.length - 1 : route.segments.length;
  for (let length = maxLength; length >= 0; length--) {
    const parent = layoutCandidatesBySegments.get(
      routeSegmentKey(route.segments.slice(0, length)),
    );
    if (parent && parent.id !== route.id) return parent.id;
  }
  return undefined;
}

function routeSegmentKey(segments: string[]): string {
  return JSON.stringify(segments);
}

function formatPageAnchorSegmentViolation(
  violation: PageRouteSegmentConventionViolation,
): string {
  return formatPageRouteSegmentConventionViolation(violation)
    .replaceAll("filenames", "directory names")
    .replaceAll("filename", "directory name")
    .replaceAll("Rename the file", "Rename the directory");
}

function createRootLayoutDefaultExportDiagnostic(): string {
  return "Root layout must default-export a React component.";
}

function createPageRouteErrorBoundaryDefaultExportDiagnostic(): string {
  return "SPA error boundary modules must default-export a React component.";
}

function createPageRouteNotFoundBoundaryDefaultExportDiagnostic(): string {
  return "SPA not-found boundary modules must default-export a React component.";
}

async function validatePageRouteConventionModule(
  absolute: string,
  kind: PageRouteConventionFile["kind"],
  diagnostics: PageRouteDiscoveryDiagnostic[],
  sourceRel: string,
): Promise<boolean> {
  return validateRouteModule(absolute, diagnostics, {
    file: sourceRel,
    parseError:
      kind === "error"
        ? "SPA error boundary module could not be parsed"
        : "SPA not-found boundary module could not be parsed",
    missingDefaultExport:
      kind === "error"
        ? createPageRouteErrorBoundaryDefaultExportDiagnostic()
        : createPageRouteNotFoundBoundaryDefaultExportDiagnostic(),
  });
}

function findScopedPageRouteConventions(
  segments: string[],
  errorModulesBySegments: Map<string, PageRouteConventionModule>,
  notFoundModulesBySegments: Map<string, PageRouteConventionModule>,
): { errorModule?: string; notFoundModule?: string } {
  return {
    ...findNearestPageRouteConventionModule(segments, errorModulesBySegments, {
      key: "errorModule",
    }),
    ...findNearestPageRouteConventionModule(
      segments,
      notFoundModulesBySegments,
      { key: "notFoundModule" },
    ),
  };
}

function findNearestPageRouteConventionModule<TKey extends string>(
  segments: string[],
  modulesBySegments: Map<string, PageRouteConventionModule>,
  options: { key: TKey },
): Partial<Record<TKey, string>> {
  for (let length = segments.length; length >= 0; length--) {
    const match = modulesBySegments.get(
      routeSegmentKey(segments.slice(0, length)),
    );
    if (match) {
      return { [options.key]: match.module } as Partial<Record<TKey, string>>;
    }
  }
  return {};
}

function formatPageRouteConventionKind(
  kind: PageRouteConventionFile["kind"],
): string {
  return kind === "error" ? "error boundary" : "not-found boundary";
}

function formatPageRouteConventionScope(segments: string[]): string {
  if (segments.length === 0) return "the root route scope";
  return `route segment scope "${segments.join("/")}"`;
}

async function discoverPageAnchorRootLayout(
  cwd: string,
  absoluteRouteDir: string,
  files: string[],
  diagnostics: PageRouteDiscoveryDiagnostic[],
): Promise<string | undefined> {
  const candidates = files.filter((file) => {
    if (path.dirname(file) !== absoluteRouteDir) return false;
    const extension = path.extname(file);
    return path.basename(file, extension) === "layout";
  });
  if (candidates.length === 0) return undefined;

  const [owner, ...duplicates] = candidates;
  const ownerProjectPath = toProjectPath(cwd, owner);
  for (const duplicate of duplicates) {
    const duplicateProjectPath = toProjectPath(cwd, duplicate);
    diagnostics.push({
      level: "error",
      file: toDiagnosticPath(duplicateProjectPath),
      message: `Duplicate page-anchor root layout. ${ownerProjectPath} already owns the root layout facet. Keep exactly one layout.ts, layout.tsx, layout.js, or layout.jsx in the page route root.`,
    });
  }

  const validRootLayout = await validateRouteModule(owner, diagnostics, {
    file: ownerProjectPath,
    parseError: "Root layout module could not be parsed",
    missingDefaultExport: createRootLayoutDefaultExportDiagnostic(),
  });
  return validRootLayout ? ownerProjectPath : undefined;
}

async function validateRouteModule(
  absolute: string,
  diagnostics: PageRouteDiscoveryDiagnostic[],
  messages: {
    file: string;
    parseError: string;
    missingDefaultExport?: string;
    unsupportedExports?: ReadonlySet<string>;
  },
): Promise<boolean> {
  const source = await fs.readFile(absolute, "utf-8");
  const { ast, error } = parseRouteModuleWithError(source);
  const file = toDiagnosticPath(messages.file);

  if (!ast) {
    diagnostics.push({
      level: "error",
      file,
      message: `${messages.parseError}: ${formatParseErrorMessage(error, { firstLine: true })}`,
    });
    return false;
  }

  if (messages.missingDefaultExport && !hasDefaultExport(ast)) {
    diagnostics.push({
      level: "error",
      file,
      message: messages.missingDefaultExport,
    });
    return false;
  }

  const unsupportedExports = collectModuleExportNames(ast.body).filter((name) =>
    messages.unsupportedExports?.has(name),
  );
  if (unsupportedExports.length > 0) {
    diagnostics.push({
      level: "error",
      file,
      message: `Page module exports ${unsupportedExports.map((name) => `"${name}"`).join(", ")} are SPA router facets and cannot be used with routing.mode "mpa". Remove them or use routing.mode "spa".`,
    });
    return false;
  }

  return true;
}

interface PageRouteTree {
  files: string[];
}

async function collectPageRouteTree(
  cwd: string,
  dir: string,
): Promise<PageRouteTree> {
  const files: string[] = [];

  async function visit(current: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(current, entry.name);
      if (!isInsideCwd(cwd, absolute)) continue;

      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }

      if (entry.isFile() && isPageRouteSourceModuleFile(entry.name)) {
        files.push(absolute);
      }
    }
  }

  await visit(dir);
  return {
    files: files.sort(),
  };
}

function createAmbiguousRouteShapeDiagnostic(
  routeShapeLabel: string,
  routePath: string,
  previous: { file: string; path: string },
): string {
  return [
    `Ambiguous page route shape "${routeShapeLabel}" for path "${routePath}"`,
    `also matches ${previous.file} (${previous.path}).`,
    "Use one dynamic parameter directory name for each URL shape.",
  ].join(" ");
}

function toDiagnosticPath(projectPath: string): string {
  return projectPath.replace(/^\.\//, "");
}

async function statIfExists(
  file: string,
): Promise<import("node:fs").Stats | undefined> {
  try {
    return await fs.stat(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}
