import fs from "node:fs/promises";
import path from "node:path";
import { HTTP_METHODS, serverRoutePathShapeFromPath } from "@evjs/shared";
import type {
  ServerMiddlewareNode,
  ServerRouteNode,
} from "@evjs/shared/manifest";
import { collectModuleExportNames } from "./module-exports.js";
import {
  findPageRouteSegmentConventionViolation,
  isIgnoredPageRouteSegment,
  isPageRouteGroupSegment,
  isPageRouteSourceModuleFile,
  normalizePageRouteConventionPath,
  type PageRouteSegmentConventionViolation,
} from "./page-route-conventions.js";
import {
  formatParseErrorMessage,
  hasDefaultExport,
  parseRouteModuleWithError,
} from "./routes/shared.js";
import { isServerMiddlewareConventionFileName } from "./server-conventions.js";
import { isInsideCwd, toPosixPath } from "./utils.js";

export interface DiscoverServerRoutesOptions {
  dir: string;
  required?: boolean;
}

export interface ServerRouteDiscoveryDiagnostic {
  level: "warning" | "error";
  message: string;
  file?: string;
}

export interface DiscoveredServerRouteNode extends ServerRouteNode {
  moduleSegments?: string[];
  middlewares?: ServerMiddlewareNode[];
}

export interface ServerRouteDiscovery {
  routes: DiscoveredServerRouteNode[];
  files: string[];
  diagnostics: ServerRouteDiscoveryDiagnostic[];
}

const LOWERCASE_HTTP_METHODS = new Set(
  HTTP_METHODS.map((method) => method.toLowerCase()),
);

export async function discoverServerRoutes(
  cwd: string,
  options: DiscoverServerRoutesOptions,
): Promise<ServerRouteDiscovery> {
  const absoluteDir = path.resolve(cwd, options.dir);
  const diagnostics: ServerRouteDiscoveryDiagnostic[] = [];
  const validDirectory = await validateServerRouteDirectory(
    cwd,
    absoluteDir,
    options.required === true,
    diagnostics,
  );
  if (!validDirectory) {
    return { routes: [], files: [], diagnostics };
  }

  const { files } = await collectServerRouteTree(cwd, absoluteDir);
  const routeCandidates: Array<DiscoveredServerRouteNode & { shape: string }> =
    [];
  const routeByPath = new Map<string, string>();
  const routeByShape = new Map<string, { file: string; path: string }>();

  for (const file of files) {
    const sourceRel = toPosixPath(path.relative(cwd, file));
    const routeRel = toPosixPath(path.relative(absoluteDir, file));
    const routeFile = parseServerRouteFile(routeRel);
    if (!routeFile) continue;

    const diagnosticFile = toDiagnosticPath(sourceRel);
    const fileDiagnostics = await analyzeServerRouteFile(
      file,
      routeFile.segments,
      routeFile.moduleSegments,
      diagnosticFile,
    );
    diagnostics.push(...fileDiagnostics.diagnostics);
    if (!fileDiagnostics.route) continue;

    const previous = routeByPath.get(fileDiagnostics.route.path);
    if (previous) {
      diagnostics.push({
        level: "error",
        file: diagnosticFile,
        message: createDuplicateServerRoutePathDiagnostic(
          fileDiagnostics.route.path,
          previous,
        ),
      });
      continue;
    }
    routeByPath.set(fileDiagnostics.route.path, sourceRel);

    const shape = serverRoutePathShapeFromPath(fileDiagnostics.route.path);
    const previousShapeOwner = routeByShape.get(shape);
    if (previousShapeOwner) {
      diagnostics.push({
        level: "error",
        file: diagnosticFile,
        message: createAmbiguousServerRouteShapeDiagnostic(
          shape,
          fileDiagnostics.route.path,
          previousShapeOwner,
        ),
      });
      continue;
    }
    routeByShape.set(shape, {
      file: sourceRel,
      path: fileDiagnostics.route.path,
    });
    routeCandidates.push({ ...fileDiagnostics.route, shape });
  }

  return {
    routes: sortServerRoutes(routeCandidates).map(
      ({ shape: _shape, ...route }) => route,
    ),
    files,
    diagnostics,
  };
}

interface ServerRouteFileConvention {
  segments: string[];
  moduleSegments: string[];
}

interface ServerRouteFileAnalysis {
  route?: DiscoveredServerRouteNode;
  diagnostics: ServerRouteDiscoveryDiagnostic[];
}

function parseServerRouteFile(
  routeRel: string,
): ServerRouteFileConvention | undefined {
  const normalizedRouteRel = normalizePageRouteConventionPath(routeRel);
  const basename = path.posix.basename(normalizedRouteRel);
  if (!isPageRouteSourceModuleFile(basename)) return undefined;
  if (isServerMiddlewareConventionFileName(basename)) return undefined;

  const extension = path.posix.extname(normalizedRouteRel);
  const withoutExt = normalizedRouteRel.slice(0, -extension.length);
  const segments = withoutExt.split("/").filter(Boolean);
  if (segments.length === 0) return undefined;
  if (segments.some(isIgnoredPageRouteSegment)) return undefined;

  const name = segments[segments.length - 1] ?? "";
  const routeSegments = name === "index" ? segments.slice(0, -1) : segments;
  return { segments: routeSegments, moduleSegments: segments.slice(0, -1) };
}

async function analyzeServerRouteFile(
  absolute: string,
  segments: string[],
  moduleSegments: string[],
  diagnosticFile: string,
): Promise<ServerRouteFileAnalysis> {
  const diagnostics: ServerRouteDiscoveryDiagnostic[] = [];
  const methodSuffix = getMethodSuffix(path.basename(absolute));
  if (methodSuffix) {
    diagnostics.push({
      level: "error",
      file: diagnosticFile,
      message: `Server route method suffix files are not supported. Rename "${path.basename(
        absolute,
      )}" so the URL path comes from the file path and HTTP methods come from uppercase exports such as "${methodSuffix.toUpperCase()}".`,
    });
    return { diagnostics };
  }

  const segmentViolation = findPageRouteSegmentConventionViolation(segments);
  if (segmentViolation) {
    diagnostics.push({
      level: "error",
      file: diagnosticFile,
      message: formatServerRouteSegmentConventionViolation(segmentViolation),
    });
    return { diagnostics };
  }

  const source = await fs.readFile(absolute, "utf-8");
  const { ast, error } = parseRouteModuleWithError(source);
  if (!ast) {
    diagnostics.push({
      level: "error",
      file: diagnosticFile,
      message: `Server route module could not be parsed: ${formatParseErrorMessage(
        error,
        { firstLine: true },
      )}`,
    });
    return { diagnostics };
  }

  const exportNames = collectModuleExportNames(ast.body);
  const exportedNames = new Set(exportNames);
  const methods = HTTP_METHODS.filter((method) => exportedNames.has(method));
  const lowercaseMethods = exportNames.filter(isLowercaseHttpMethod);
  const routeModuleMiddlewareExports = exportNames.filter(
    (name) => name === "middleware" || name === "middlewares",
  );
  const hasRouteExport =
    methods.length > 0 ||
    lowercaseMethods.length > 0 ||
    routeModuleMiddlewareExports.length > 0;
  if (!hasRouteExport) return { diagnostics };

  if (isRouteSentinelFilename(path.basename(absolute))) {
    diagnostics.push({
      level: "error",
      file: diagnosticFile,
      message: `Server route sentinel files are not supported. Rename "${path.basename(
        absolute,
      )}" so the URL path comes from the file path; use "index${path.extname(
        absolute,
      )}" for a directory root.`,
    });
  }

  if (methods.length === 0 && routeModuleMiddlewareExports.length === 0) {
    diagnostics.push({
      level: "error",
      file: diagnosticFile,
      message:
        "Server route modules must export at least one uppercase HTTP method such as GET or POST.",
    });
  }

  for (const exportName of routeModuleMiddlewareExports) {
    diagnostics.push({
      level: "error",
      file: diagnosticFile,
      message: `Server file routes must not export "${exportName}". Move middleware logic to a middleware.ts file in the route tree.`,
    });
  }

  for (const method of lowercaseMethods) {
    diagnostics.push({
      level: "error",
      file: diagnosticFile,
      message: `Server route module exports lowercase method "${method}". Use uppercase "${method.toUpperCase()}".`,
    });
  }

  if (hasDefaultExport(ast)) {
    diagnostics.push({
      level: "error",
      file: diagnosticFile,
      message:
        "Server route modules must not use default exports. Export uppercase HTTP methods instead.",
    });
  }

  const supportedExports = new Set<string>(HTTP_METHODS);
  for (const exportName of exportNames) {
    if (
      supportedExports.has(exportName) ||
      exportName === "default" ||
      isLowercaseHttpMethod(exportName) ||
      exportName === "middleware" ||
      exportName === "middlewares"
    ) {
      continue;
    }
    diagnostics.push({
      level: "error",
      file: diagnosticFile,
      message: `Server route module export "${exportName}" is not supported. Move helpers to a non-route file or export only uppercase HTTP methods.`,
    });
  }

  if (diagnostics.length > 0) return { diagnostics };

  const routePath = serverRoutePathFromSegments(segments);
  return {
    diagnostics,
    route: {
      id: `${diagnosticFile}:${routePath}:${methods.join(",")}`,
      module: diagnosticFile,
      path: routePath,
      methods,
      moduleSegments,
    },
  };
}

function getMethodSuffix(filename: string): string | undefined {
  const extension = path.extname(filename);
  const stem = filename.slice(0, -extension.length);
  const suffix = stem.split(".").pop();
  return suffix && LOWERCASE_HTTP_METHODS.has(suffix) ? suffix : undefined;
}

function isRouteSentinelFilename(filename: string): boolean {
  const extension = path.extname(filename);
  return filename.slice(0, -extension.length) === "route";
}

function isLowercaseHttpMethod(exportName: string): boolean {
  return LOWERCASE_HTTP_METHODS.has(exportName);
}

function serverRoutePathFromSegments(segments: string[]): string {
  const pathSegments = segments
    .filter((segment) => !isPageRouteGroupSegment(segment))
    .map((segment) =>
      segment.startsWith("$") ? `:${segment.slice(1)}` : segment,
    );
  if (pathSegments.length === 0) return "/";
  return `/${pathSegments.join("/")}`;
}

async function validateServerRouteDirectory(
  cwd: string,
  absoluteRouteDir: string,
  required: boolean,
  diagnostics: ServerRouteDiscoveryDiagnostic[],
): Promise<boolean> {
  const expected = toPosixPath(path.relative(cwd, absoluteRouteDir));
  if (!isInsideCwd(cwd, absoluteRouteDir)) {
    if (required) {
      diagnostics.push({
        level: "error",
        file: expected,
        message: `Server route directory must be inside the project root. ${expected} is not supported.`,
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
        file: expected,
        message: `Server route directory not found: ${expected}.`,
      });
    }
    return false;
  }

  if (!stat.isDirectory()) {
    if (required) {
      diagnostics.push({
        level: "error",
        file: expected,
        message: `Server route directory must be a directory: ${expected}.`,
      });
    }
    return false;
  }

  return true;
}

interface ServerRouteTree {
  files: string[];
}

async function collectServerRouteTree(
  cwd: string,
  dir: string,
): Promise<ServerRouteTree> {
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
  return { files: files.sort() };
}

function formatServerRouteSegmentConventionViolation(
  violation: PageRouteSegmentConventionViolation,
): string {
  if (violation.kind === "route-group") {
    return `Server route group segment "${violation.segment}" must wrap a non-empty group name in parentheses, such as "(internal)".`;
  }
  if (violation.kind === "bracket") {
    const name = violation.segment.replace(/^\[+/, "").replace(/\]+$/, "");
    const suggestion =
      name && !name.startsWith("...")
        ? ` Rename the file to "$${name}" for a dynamic segment.`
        : " Split it into explicit file routes.";
    return `Dynamic server route segments must use $param filenames. Bracket segment "${violation.segment}" is not supported.${suggestion}`;
  }
  if (violation.kind === "unsupported-dynamic") {
    if (violation.segment === "$") {
      return 'Dynamic server route segments must include a name after "$". Segment "$" is not supported.';
    }
    if (violation.segment.startsWith("$...")) {
      return `Catch-all server route segments are not supported. Split wildcard handling into explicit file routes instead of "${violation.segment}".`;
    }
    if (violation.segment.endsWith("?")) {
      return `Optional server route segments are not supported. Split the route into explicit files instead of "${violation.segment}".`;
    }
    return `Unsupported dynamic server route segment "${violation.segment}".`;
  }
  if (violation.kind === "dynamic") {
    return `Dynamic server route segment "${violation.segment}" must use a JavaScript identifier after "$", such as "$userId".`;
  }
  if (violation.kind === "reserved-dynamic") {
    return `Dynamic server route segment "${violation.segment}" uses a reserved param name. Use a safe application-specific name such as "$userId".`;
  }
  if (violation.kind === "duplicate-dynamic") {
    return `Dynamic server route segment "${violation.segment}" repeats a param name. Use unique dynamic param filenames within one route path.`;
  }
  return `Static server route segment "${violation.segment}" must use lowercase URL-safe characters: lowercase letters, numbers, ".", "_", "-", or "~".`;
}

function createDuplicateServerRoutePathDiagnostic(
  routePath: string,
  previous: string,
): string {
  return [
    `Duplicate server route path "${routePath}" also declared by ${previous}.`,
    "Keep one server route module per URL path; choose either a flat route file or a directory index route file.",
  ].join(" ");
}

function createAmbiguousServerRouteShapeDiagnostic(
  routeShape: string,
  routePath: string,
  previous: { file: string; path: string },
): string {
  return [
    `Ambiguous server route shape "${routeShape}" for path "${routePath}"`,
    `also matches ${previous.file} (${previous.path}).`,
    "Use one dynamic param name for each URL shape.",
  ].join(" ");
}

function sortServerRoutes<T extends ServerRouteNode>(routes: T[]): T[] {
  return [...routes].sort((left, right) => {
    const leftStatic = countStaticSegments(left.path);
    const rightStatic = countStaticSegments(right.path);
    if (leftStatic !== rightStatic) return rightStatic - leftStatic;
    return left.path.localeCompare(right.path);
  });
}

function countStaticSegments(routePath: string): number {
  return routePath
    .split("/")
    .filter((segment) => segment && !segment.startsWith(":")).length;
}

function toDiagnosticPath(projectPath: string): string {
  return projectPath.replace(/^\.\//, "");
}
