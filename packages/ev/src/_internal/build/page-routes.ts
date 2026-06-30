import fs from "node:fs/promises";
import path from "node:path";
import type { PageRouteNode } from "@evjs/shared/manifest";
import {
  findPageRouteSegmentConventionViolation,
  formatPageRouteSegmentConventionViolation,
  isIgnoredPageRouteSegment,
  isPageRouteGroupSegment,
  isPageRouteSourceModuleFile,
  normalizePageRouteConventionPath,
  PAGE_ROUTE_ROOT_LAYOUT_FILE,
  PAGE_ROUTE_SOURCE_EXTENSION_LABEL,
  PAGE_ROUTE_UNSUPPORTED_ROOT_LAYOUT_FILES,
  parsePageRouteFile,
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
  toPosixPath,
  toProjectPath,
} from "./utils.js";

export interface DiscoverPageRoutesOptions {
  dir: string;
  mode?: "spa" | "mpa";
  rootLayout?: boolean | string;
  spaConventions?: boolean;
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
  diagnostics: PageRouteDiscoveryDiagnostic[];
}

export async function discoverPageRoutes(
  cwd: string,
  options: DiscoverPageRoutesOptions,
): Promise<PageRouteDiscovery> {
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
      diagnostics,
    };
  }

  const { files } = await collectPageRouteTree(cwd, absoluteDir);
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
  let hasRouteCandidate = false;
  const spaConventions =
    options.mode !== "mpa" && options.spaConventions !== false;

  for (const file of files) {
    const sourceRel = toProjectPath(cwd, file);
    const routeRel = toPosixPath(path.relative(absoluteDir, file));
    const conventionFile = spaConventions
      ? parsePageRouteConventionFile(routeRel)
      : undefined;
    if (conventionFile) {
      const segmentViolation = findPageRouteSegmentConventionViolation(
        conventionFile.segments,
      );
      if (segmentViolation) {
        diagnostics.push({
          level: "error",
          file: toDiagnosticPath(sourceRel),
          message: formatPageRouteSegmentConventionViolation(segmentViolation),
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
      const previous = map.get(routeSegmentKey(conventionFile.segments));
      if (previous) {
        diagnostics.push({
          level: "error",
          file: toDiagnosticPath(sourceRel),
          message: `Duplicate SPA ${formatPageRouteConventionKind(conventionFile.kind)} convention for ${formatPageRouteConventionScope(conventionFile.segments)}. ${previous.module} already owns this scope. Keep one ${conventionFile.kind === "error" ? "error" : "not-found"}.* module per route directory.`,
        });
        continue;
      }
      map.set(routeSegmentKey(conventionFile.segments), {
        module: sourceRel,
        segments: conventionFile.segments,
      });
      continue;
    }

    const layoutFile = parsePageLayoutRouteFile(routeRel);
    if (layoutFile?.invalidLayoutSource) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticPath(sourceRel),
        message: createInvalidPageLayoutSourceDiagnostic(),
      });
      continue;
    }
    if (layoutFile) {
      hasRouteCandidate = true;

      const segmentViolation = findPageRouteSegmentConventionViolation(
        layoutFile.segments,
      );
      if (segmentViolation) {
        diagnostics.push({
          level: "error",
          file: toDiagnosticPath(sourceRel),
          message: formatPageRouteSegmentConventionViolation(segmentViolation),
        });
        continue;
      }

      const validRouteModule = await validateRouteModule(file, diagnostics, {
        file: sourceRel,
        parseError: "Layout route module could not be parsed",
      });
      if (!validRouteModule) continue;

      const routePath = routePathFromSegments(layoutFile.segments);
      const routeId = deriveLayoutRouteIdFromSegments(layoutFile.segments);
      const previousIdOwner = routeById.get(routeId);
      if (previousIdOwner) {
        diagnostics.push({
          level: "error",
          file: toDiagnosticPath(sourceRel),
          message: `Duplicate page route id "${routeId}" for layout path "${routePath}" also generated by ${previousIdOwner.file} (${previousIdOwner.path}). Rename one route file so generated route ids are unique.`,
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
      continue;
    }

    const routeFile = parsePageRouteFile(routeRel, {
      spaConventions,
    });
    if (!routeFile) continue;
    hasRouteCandidate = true;

    const segmentViolation = findPageRouteSegmentConventionViolation(
      routeFile.segments,
    );
    if (segmentViolation) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticPath(sourceRel),
        message: formatPageRouteSegmentConventionViolation(segmentViolation),
      });
      continue;
    }

    const routePath = routePathFromSegments(routeFile.segments);
    const validRouteModule = await validateRouteModule(file, diagnostics, {
      file: sourceRel,
      parseError: "Page route module could not be parsed",
      missingDefaultExport: createPageRouteDefaultExportDiagnostic(),
    });
    if (!validRouteModule) continue;

    const previous = routeByPath.get(routePath);
    if (previous) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticPath(sourceRel),
        message: createDuplicateRoutePathDiagnostic(routePath, previous),
      });
      continue;
    }

    routeByPath.set(routePath, sourceRel);
    const routeShape = routeShapeFromSegments(routeFile.segments);
    const previousShapeOwner = routeByShape.get(routeShape.key);
    if (previousShapeOwner) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticPath(sourceRel),
        message: createAmbiguousRouteShapeDiagnostic(
          routeShape.label,
          routePath,
          previousShapeOwner,
        ),
      });
      continue;
    }
    routeByShape.set(routeShape.key, { file: sourceRel, path: routePath });

    const routeId = deriveRouteIdFromPath(routePath);
    const previousIdOwner = routeById.get(routeId);
    if (previousIdOwner) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticPath(sourceRel),
        message: `Duplicate page route id "${routeId}" for path "${routePath}" also generated by ${previousIdOwner.file} (${previousIdOwner.path}). Rename one route file so generated route ids are unique.`,
      });
      continue;
    }

    const html =
      options.mode === "mpa"
        ? await findColocatedPageHtmlTemplate(cwd, file)
        : undefined;

    routeById.set(routeId, { file: sourceRel, path: routePath });
    routeCandidates.push({
      id: routeId,
      path: routePath,
      module: sourceRel,
      ...(html ? { html } : {}),
      segments: routeFile.segments,
      kind: "page",
    });
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

  let rootModule: string | undefined;
  if (hasRouteCandidate && options.rootLayout !== false) {
    rootModule =
      typeof options.rootLayout === "string"
        ? await discoverExplicitRootLayout(cwd, options.rootLayout, diagnostics)
        : await discoverRootLayout(cwd, absoluteDir, diagnostics);
  }

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
    rootModule,
    files,
    diagnostics,
  };
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
  invalidLayoutSource?: boolean;
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
  if (segments.some(isIgnoredPageRouteSegment)) return undefined;

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
  if (segments.some(isIgnoredPageRouteSegment)) return undefined;

  const name = segments[segments.length - 1] ?? "";
  if (name === "error" || name === "not-found") return undefined;
  const parent = segments[segments.length - 2] ?? "";
  if (name === "layout") {
    if (segments.length === 1) {
      return { segments: [], invalidLayoutSource: true };
    }
    return { segments: segments.slice(0, -1) };
  }
  if (name === "index" && parent === "layout") {
    return { segments: [], invalidLayoutSource: true };
  }
  if (segments.includes("layout")) {
    return { segments: [], invalidLayoutSource: true };
  }
  return undefined;
}

function createInvalidPageLayoutSourceDiagnostic(): string {
  return [
    "SPA route layouts must be nested below a route segment and named layout.{ts,tsx,js,jsx}.",
    "Use the external root layout convention layout/index.tsx beside the route directory for the app root layout.",
    "Move helper modules under an underscore-prefixed file or folder.",
  ].join(" ");
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

function createDuplicateRoutePathDiagnostic(
  routePath: string,
  previous: string,
): string {
  return [
    `Duplicate page route path "${routePath}" also declared by ${previous}.`,
    "Keep one page module per URL path; choose either a flat route file or a directory index route file.",
  ].join(" ");
}

function createPageRouteDefaultExportDiagnostic(): string {
  return "Page route modules must default-export a React component. Move non-route helpers under an underscore-prefixed file or folder.";
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

async function discoverExplicitRootLayout(
  cwd: string,
  layout: string,
  diagnostics: PageRouteDiscoveryDiagnostic[],
): Promise<string | undefined> {
  const absolute = path.resolve(cwd, layout);
  const expected = toProjectPath(cwd, absolute);
  if (!isInsideCwd(cwd, absolute)) {
    diagnostics.push({
      level: "error",
      file: layout,
      message: `Root layout must be inside the project root. ${layout} is not supported.`,
    });
    return undefined;
  }

  let stat: import("node:fs").Stats;
  try {
    stat = await fs.stat(absolute);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    diagnostics.push({
      level: "error",
      file: toDiagnosticPath(expected),
      message: `Root layout module not found: ${expected}.`,
    });
    return undefined;
  }
  if (!stat.isFile()) {
    diagnostics.push({
      level: "error",
      file: toDiagnosticPath(expected),
      message: `Root layout module must be a file: ${expected}.`,
    });
    return undefined;
  }
  if (!isPageRouteSourceModuleFile(path.basename(absolute))) {
    diagnostics.push({
      level: "error",
      file: toDiagnosticPath(expected),
      message: `Root layout module must be a source module using ${PAGE_ROUTE_SOURCE_EXTENSION_LABEL}; declaration, test, spec, story, client-only, and server-only files are not supported. ${expected} is not supported.`,
    });
    return undefined;
  }

  const validRootLayout = await validateRouteModule(absolute, diagnostics, {
    file: expected,
    parseError: "Root layout module could not be parsed",
    missingDefaultExport: createRootLayoutDefaultExportDiagnostic(),
  });
  return validRootLayout ? expected : undefined;
}

async function discoverRootLayout(
  cwd: string,
  absoluteRouteDir: string,
  diagnostics: PageRouteDiscoveryDiagnostic[],
): Promise<string | undefined> {
  const appDir = path.dirname(absoluteRouteDir);
  if (!isInsideCwd(cwd, appDir)) return undefined;

  let hasUnsupportedRootLayout = false;
  for (const layoutFile of PAGE_ROUTE_UNSUPPORTED_ROOT_LAYOUT_FILES) {
    const absolute = path.join(appDir, layoutFile);
    const stat = await statIfExists(absolute);
    if (!stat) continue;
    const projectPath = toProjectPath(cwd, absolute);
    hasUnsupportedRootLayout = true;
    diagnostics.push({
      level: "error",
      file: toDiagnosticPath(projectPath),
      message: createUnsupportedRootLayoutDiagnostic(
        projectPath,
        toProjectPath(cwd, path.join(appDir, PAGE_ROUTE_ROOT_LAYOUT_FILE)),
      ),
    });
  }

  if (hasUnsupportedRootLayout) return undefined;

  const absolute = path.join(appDir, PAGE_ROUTE_ROOT_LAYOUT_FILE);
  const stat = await statIfExists(absolute);
  if (!stat) return undefined;

  const projectPath = toProjectPath(cwd, absolute);
  if (!stat.isFile()) {
    diagnostics.push({
      level: "error",
      file: toDiagnosticPath(projectPath),
      message: `Root layout module must be a file: ${projectPath}.`,
    });
    return undefined;
  }
  const validRootLayout = await validateRouteModule(absolute, diagnostics, {
    file: projectPath,
    parseError: "Root layout module could not be parsed",
    missingDefaultExport: createRootLayoutDefaultExportDiagnostic(),
  });
  if (!validRootLayout) return undefined;
  return projectPath;
}

function createUnsupportedRootLayoutDiagnostic(
  actual: string,
  expected: string,
): string {
  return `Unsupported SPA root layout convention: ${actual}. Auto-discovery only supports ${expected}; rename the file or configure routing.conventions.layout explicitly.`;
}

async function findColocatedPageHtmlTemplate(
  cwd: string,
  routeFile: string,
): Promise<string | undefined> {
  const extension = path.extname(routeFile);
  const htmlFile = `${routeFile.slice(0, -extension.length)}.html`;
  const stat = await statIfExists(htmlFile);
  if (!stat) return undefined;
  return toProjectPath(cwd, htmlFile);
}

async function validateRouteModule(
  absolute: string,
  diagnostics: PageRouteDiscoveryDiagnostic[],
  messages: {
    file: string;
    parseError: string;
    missingDefaultExport?: string;
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
    "Use one dynamic param name for each URL shape or explicit pages config.",
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
