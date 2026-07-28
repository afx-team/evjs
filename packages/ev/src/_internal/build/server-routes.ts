import fs from "node:fs/promises";
import path from "node:path";
import { HTTP_METHODS, serverRoutePathShapeFromPath } from "@evjs/shared";
import type {
  ServerMiddlewareNode,
  ServerRouteNode,
} from "@evjs/shared/manifest";
import { collectModuleExportNames } from "./module-exports.js";
import {
  isPageRouteSourceModuleFile,
  type PageRouteSegmentConventionViolation,
} from "./page-route-conventions.js";
import {
  formatParseErrorMessage,
  hasDefaultExport,
  parseRouteModuleWithError,
} from "./routes/shared.js";
import {
  findServerRouteSegmentConventionViolation,
  parseServerRouteAnchorFile,
  SERVER_ROUTE_ENTRY_LABEL,
  serverRoutePathFromSegments,
} from "./server-route-conventions.js";
import { isInsideCwd, isRealPathInsideCwd, toPosixPath } from "./utils.js";

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

interface ServerRouteAnchorCandidate {
  file: string;
  sourceRel: string;
  diagnosticFile: string;
  directory: string;
  segments: string[];
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
  const anchors = files.flatMap<ServerRouteAnchorCandidate>((file) => {
    const sourceRel = toPosixPath(path.relative(cwd, file));
    const routeRel = toPosixPath(path.relative(absoluteDir, file));
    const convention = parseServerRouteAnchorFile(routeRel);
    return convention
      ? [
          {
            file,
            sourceRel,
            diagnosticFile: toDiagnosticPath(sourceRel),
            directory: path.posix.dirname(sourceRel),
            segments: convention.segments,
          },
        ]
      : [];
  });
  const duplicateAnchorOwners = findDuplicateServerRouteAnchorOwners(anchors);
  const routeCandidates: Array<DiscoveredServerRouteNode & { shape: string }> =
    [];
  const routeByPath = new Map<string, string>();
  const routeByShape = new Map<string, { file: string; path: string }>();

  for (const anchor of anchors) {
    const duplicateOwner = duplicateAnchorOwners.get(anchor.file);
    if (duplicateOwner) {
      diagnostics.push({
        level: "error",
        file: anchor.diagnosticFile,
        message: createDuplicateServerRouteAnchorDiagnostic(
          anchor.directory,
          duplicateOwner,
        ),
      });
      continue;
    }

    const segmentViolation = findServerRouteSegmentConventionViolation(
      anchor.segments,
    );
    if (segmentViolation) {
      diagnostics.push({
        level: "error",
        file: anchor.diagnosticFile,
        message: formatServerRouteSegmentConventionViolation(segmentViolation),
      });
      continue;
    }

    const routePath = serverRoutePathFromSegments(anchor.segments);
    const previous = routeByPath.get(routePath);
    let structuralDiagnostic: ServerRouteDiscoveryDiagnostic | undefined;
    let shape: string | undefined;
    if (previous) {
      structuralDiagnostic = {
        level: "error",
        file: anchor.diagnosticFile,
        message: createDuplicateServerRoutePathDiagnostic(routePath, previous),
      };
    } else {
      routeByPath.set(routePath, anchor.sourceRel);
      shape = serverRoutePathShapeFromPath(routePath);
      const previousShapeOwner = routeByShape.get(shape);
      if (previousShapeOwner) {
        structuralDiagnostic = {
          level: "error",
          file: anchor.diagnosticFile,
          message: createAmbiguousServerRouteShapeDiagnostic(
            shape,
            routePath,
            previousShapeOwner,
          ),
        };
      } else {
        routeByShape.set(shape, {
          file: anchor.sourceRel,
          path: routePath,
        });
      }
    }

    const fileDiagnostics = await analyzeServerRouteFile(
      anchor.file,
      anchor.segments,
      anchor.diagnosticFile,
      routePath,
    );
    diagnostics.push(...fileDiagnostics.diagnostics);
    if (structuralDiagnostic) {
      diagnostics.push(structuralDiagnostic);
      continue;
    }
    if (!fileDiagnostics.route || !shape) continue;
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

function findDuplicateServerRouteAnchorOwners(
  anchors: ServerRouteAnchorCandidate[],
): Map<string, string> {
  const ownerByDirectory = new Map<string, string>();
  const duplicateOwnerByFile = new Map<string, string>();
  for (const anchor of anchors) {
    const owner = ownerByDirectory.get(anchor.directory);
    if (owner) {
      duplicateOwnerByFile.set(anchor.file, owner);
      continue;
    }
    ownerByDirectory.set(anchor.directory, anchor.sourceRel);
  }
  return duplicateOwnerByFile;
}

interface ServerRouteFileAnalysis {
  route?: DiscoveredServerRouteNode;
  diagnostics: ServerRouteDiscoveryDiagnostic[];
}

async function analyzeServerRouteFile(
  absolute: string,
  segments: string[],
  diagnosticFile: string,
  routePath: string,
): Promise<ServerRouteFileAnalysis> {
  const diagnostics: ServerRouteDiscoveryDiagnostic[] = [];
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
  if (methods.length === 0) {
    diagnostics.push({
      level: "error",
      file: diagnosticFile,
      message: `${SERVER_ROUTE_ENTRY_LABEL} anchor modules must export at least one uppercase HTTP method such as GET or POST.`,
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
      message: `Server route module export "${exportName}" is not supported. Move helpers to an ordinary colocated module or export only uppercase HTTP methods from the api.* anchor.`,
    });
  }

  if (diagnostics.length > 0) return { diagnostics };

  return {
    diagnostics,
    route: {
      id: `${diagnosticFile}:${routePath}:${methods.join(",")}`,
      module: diagnosticFile,
      path: routePath,
      methods,
      moduleSegments: segments,
    },
  };
}

function isLowercaseHttpMethod(exportName: string): boolean {
  return LOWERCASE_HTTP_METHODS.has(exportName);
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

  if (!(await isRealPathInsideCwd(cwd, absoluteRouteDir))) {
    diagnostics.push({
      level: "error",
      file: expected,
      message: `Server route directory must resolve inside the project root. ${expected} points outside after resolving symlinks.`,
    });
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
        ? ` Rename the directory to "$${name}" and place an api.* anchor inside it.`
        : " Split it into explicit file routes.";
    return `Dynamic server route segments must use $param directories. Bracket segment "${violation.segment}" is not supported.${suggestion}`;
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
    return `Dynamic server route segment "${violation.segment}" repeats a param name. Use unique dynamic param directories within one route path.`;
  }
  return `Static server route segment "${violation.segment}" must start with a lowercase letter or number and then use only lowercase URL-safe characters: lowercase letters, numbers, ".", "_", "-", or "~".`;
}

function createDuplicateServerRoutePathDiagnostic(
  routePath: string,
  previous: string,
): string {
  return [
    `Duplicate api.* anchor for server route path "${routePath}" also declared by ${previous}.`,
    "Keep one api.* anchor per normalized URL path; pathless route groups must not collapse multiple directories onto the same path.",
  ].join(" ");
}

function createDuplicateServerRouteAnchorDiagnostic(
  directory: string,
  previous: string,
): string {
  return [
    `Duplicate api.* anchor in server route directory "${directory}".`,
    `${previous} already declares the anchor for this directory.`,
    `Keep exactly one api.* source-extension variant (${SERVER_ROUTE_ENTRY_LABEL}) per server route directory.`,
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
