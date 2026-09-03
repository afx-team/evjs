import fs from "node:fs/promises";
import path from "node:path";
import type { ServerMiddlewareNode } from "@evjs/shared/manifest";
import type { Expression, ModuleItem } from "@swc/types";
import { collectModuleExportNames } from "../analysis/module-exports.js";
import {
  formatParseErrorMessage,
  parseRouteModuleWithError,
} from "../analysis/route-module.js";
import {
  isRouteSourceModuleFile,
  normalizeRouteConventionPath,
  type RouteSegmentConventionViolation,
} from "../conventions/route-conventions.js";
import { findServerRouteSegmentConventionViolation } from "../conventions/server-route-conventions.js";
import { isInsideCwd, isRealPathInsideCwd, toPosixPath } from "../utils.js";
import type { DiscoveredServerRouteNode } from "./server-routes.js";

/** Fixed global middleware composition anchor for framework conventions. */
export const CANONICAL_SERVER_MIDDLEWARE_FILE =
  "./src/middlewares/middleware.ts";

export interface DiscoverServerConventionsOptions {
  globalFile: string;
  routingDir?: string;
}

export interface ServerConventionDiagnostic {
  level: "warning" | "error";
  message: string;
  file?: string;
}

export interface ServerConventionDiscovery {
  globalMiddlewares: ServerMiddlewareNode[];
  routeMiddlewares: ServerMiddlewareNode[];
  files: string[];
  diagnostics: ServerConventionDiagnostic[];
}

export async function discoverServerConventions(
  cwd: string,
  options: DiscoverServerConventionsOptions,
): Promise<ServerConventionDiscovery> {
  const diagnostics: ServerConventionDiagnostic[] = [];
  const files: string[] = [];
  const globalMiddlewares = await discoverGlobalMiddlewares(
    cwd,
    options.globalFile,
    diagnostics,
  );
  files.push(...globalMiddlewares.files);

  const routeMiddlewares = options.routingDir
    ? await discoverRouteMiddlewares(cwd, options.routingDir, diagnostics)
    : { middlewares: [], files: [] };
  files.push(...routeMiddlewares.files);

  return {
    globalMiddlewares: globalMiddlewares.middlewares,
    routeMiddlewares: routeMiddlewares.middlewares,
    files: files.sort(),
    diagnostics,
  };
}

export function isServerMiddlewareConventionFileName(
  filename: string,
): boolean {
  const normalized = normalizeRouteConventionPath(filename);
  const extension = path.posix.extname(normalized);
  if (!isRouteSourceModuleFile(path.posix.basename(normalized))) {
    return false;
  }
  return normalized.slice(0, -extension.length) === "middleware";
}

export function applyRouteScopedMiddlewares(
  routes: DiscoveredServerRouteNode[],
  routeMiddlewares: ServerMiddlewareNode[],
): DiscoveredServerRouteNode[] {
  if (routeMiddlewares.length === 0) return routes;

  const orderedMiddlewares = [...routeMiddlewares].sort(compareMiddlewares);
  return routes.map((route) => {
    const routeSegments = route.moduleSegments ?? [];
    const middlewares = orderedMiddlewares.filter((middleware) =>
      isScopePrefix(middleware.scopeSegments ?? [], routeSegments),
    );
    if (middlewares.length === 0) return route;
    return { ...route, middlewares };
  });
}

async function discoverGlobalMiddlewares(
  cwd: string,
  configuredGlobalFile: string,
  diagnostics: ServerConventionDiagnostic[],
): Promise<{ middlewares: ServerMiddlewareNode[]; files: string[] }> {
  const absoluteConfigured = path.resolve(cwd, configuredGlobalFile);
  if (!isInsideCwd(cwd, absoluteConfigured)) {
    diagnostics.push({
      level: "error",
      file: toDiagnosticPath(
        toPosixPath(path.relative(cwd, absoluteConfigured)),
      ),
      message: "Server middleware file must be inside the project root.",
    });
    return { middlewares: [], files: [] };
  }

  const directory = path.dirname(absoluteConfigured);
  try {
    if (!(await isRealPathInsideCwd(cwd, directory))) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticPath(
          toPosixPath(path.relative(cwd, absoluteConfigured)),
        ),
        message: "Server middleware file must resolve inside the project root.",
      });
      return { middlewares: [], files: [] };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { middlewares: [], files: [] };
    }
    throw error;
  }

  const files = await collectMiddlewareFilesInDirectory(cwd, directory);
  if (files.length === 0) return { middlewares: [], files: [] };

  if (files.length > 1) {
    diagnostics.push({
      level: "error",
      file: toDiagnosticPath(toPosixPath(path.relative(cwd, files[0]))),
      message:
        "Duplicate global server middleware composition anchors found. Keep one src/middlewares/middleware.* source module.",
    });
    return { middlewares: [], files };
  }

  const [file] = files;
  if (!file) return { middlewares: [], files: [] };
  const sourceRel = toDiagnosticPath(toPosixPath(path.relative(cwd, file)));
  diagnostics.push(...(await analyzeMiddlewareModule(file, sourceRel)));
  return {
    files,
    middlewares: [
      {
        id: `${sourceRel}:global-middleware`,
        module: sourceRel,
        scope: "global",
        scopeSegments: [],
      },
    ],
  };
}

async function discoverRouteMiddlewares(
  cwd: string,
  routingDir: string,
  diagnostics: ServerConventionDiagnostic[],
): Promise<{ middlewares: ServerMiddlewareNode[]; files: string[] }> {
  const absoluteRoutingDir = path.resolve(cwd, routingDir);
  if (!isInsideCwd(cwd, absoluteRoutingDir)) {
    diagnostics.push({
      level: "error",
      file: toDiagnosticPath(
        toPosixPath(path.relative(cwd, absoluteRoutingDir)),
      ),
      message:
        "Server route middleware directory must be inside the project root.",
    });
    return { middlewares: [], files: [] };
  }

  try {
    if (!(await isRealPathInsideCwd(cwd, absoluteRoutingDir))) {
      return { middlewares: [], files: [] };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { middlewares: [], files: [] };
    }
    throw error;
  }

  const files = await collectMiddlewareFilesInTree(cwd, absoluteRoutingDir);
  const middlewares: ServerMiddlewareNode[] = [];
  const middlewareByScope = new Map<string, string>();

  for (const file of files) {
    const sourceRel = toDiagnosticPath(toPosixPath(path.relative(cwd, file)));
    const routeRel = toPosixPath(path.relative(absoluteRoutingDir, file));
    const convention = parseRouteMiddlewareFile(routeRel);
    if (!convention) continue;

    const segmentViolation = findServerRouteSegmentConventionViolation(
      convention.scopeSegments,
    );
    if (segmentViolation) {
      diagnostics.push({
        level: "error",
        file: sourceRel,
        message:
          formatServerMiddlewareSegmentConventionViolation(segmentViolation),
      });
      continue;
    }

    const scopeKey = convention.scopeSegments.join("/");
    const previous = middlewareByScope.get(scopeKey);
    if (previous) {
      diagnostics.push({
        level: "error",
        file: sourceRel,
        message: `Duplicate route-scoped server middleware for "${formatScopeLabel(
          convention.scopeSegments,
        )}" also declared by ${previous}.`,
      });
      continue;
    }
    middlewareByScope.set(scopeKey, sourceRel);

    diagnostics.push(...(await analyzeMiddlewareModule(file, sourceRel)));
    middlewares.push({
      id: `${sourceRel}:route-middleware`,
      module: sourceRel,
      scope: "route",
      scopeSegments: convention.scopeSegments,
    });
  }

  return {
    files,
    middlewares: middlewares.sort(compareMiddlewares),
  };
}

async function collectMiddlewareFilesInDirectory(
  cwd: string,
  directory: string,
): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw err;
  }

  return entries
    .filter(
      (entry) =>
        entry.isFile() && isServerMiddlewareConventionFileName(entry.name),
    )
    .map((entry) => path.join(directory, entry.name))
    .filter((file) => isInsideCwd(cwd, file))
    .sort();
}

async function collectMiddlewareFilesInTree(
  cwd: string,
  root: string,
): Promise<string[]> {
  const files: string[] = [];

  async function visit(current: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return;
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

      if (entry.isFile() && isServerMiddlewareConventionFileName(entry.name)) {
        files.push(absolute);
      }
    }
  }

  await visit(root);
  return files.sort();
}

interface RouteMiddlewareFileConvention {
  scopeSegments: string[];
}

function parseRouteMiddlewareFile(
  routeRel: string,
): RouteMiddlewareFileConvention | undefined {
  const normalizedRouteRel = normalizeRouteConventionPath(routeRel);
  const basename = path.posix.basename(normalizedRouteRel);
  if (!isServerMiddlewareConventionFileName(basename)) return undefined;

  const extension = path.posix.extname(normalizedRouteRel);
  const withoutExt = normalizedRouteRel.slice(0, -extension.length);
  const segments = withoutExt.split("/").filter(Boolean);
  if (segments.length === 0) return undefined;
  const scopeSegments = segments.slice(0, -1);
  return { scopeSegments };
}

async function analyzeMiddlewareModule(
  absolute: string,
  diagnosticFile: string,
): Promise<ServerConventionDiagnostic[]> {
  const source = await fs.readFile(absolute, "utf-8");
  const { ast, error } = parseRouteModuleWithError(source);
  if (!ast) {
    return [
      {
        level: "error",
        file: diagnosticFile,
        message: `Server middleware module could not be parsed: ${formatParseErrorMessage(
          error,
          { firstLine: true },
        )}`,
      },
    ];
  }

  const diagnostics: ServerConventionDiagnostic[] = [];
  const exportNames = collectModuleExportNames(ast.body);
  if (!exportNames.includes("default")) {
    diagnostics.push({
      level: "error",
      file: diagnosticFile,
      message:
        "Server middleware modules must default-export a Hono-compatible middleware function or a non-empty ordered middleware list.",
    });
  }

  const namedExports = exportNames.filter((name) => name !== "default");
  for (const exportName of namedExports) {
    diagnostics.push({
      level: "error",
      file: diagnosticFile,
      message: `Server middleware module export "${exportName}" is not supported. Move helpers to a private module and default-export only the middleware.`,
    });
  }

  const defaultExportError = validateDefaultMiddlewareExport(ast.body);
  if (defaultExportError) {
    diagnostics.push({
      level: "error",
      file: diagnosticFile,
      message: defaultExportError,
    });
  }

  return diagnostics;
}

function validateDefaultMiddlewareExport(
  body: ModuleItem[],
): string | undefined {
  const localValues = collectLocalVariableValues(body);
  const value = getDefaultExportValue(body);
  if (!value) return undefined;
  return validateDefaultMiddlewareExpression(
    value,
    localValues,
    new Set(),
    true,
  );
}

function collectLocalVariableValues(
  body: ModuleItem[],
): Map<string, Expression | undefined> {
  const values = new Map<string, Expression | undefined>();
  for (const item of body) {
    const declaration =
      item.type === "ExportDeclaration" ? item.declaration : item;
    if (declaration.type === "FunctionDeclaration") {
      values.set(declaration.identifier.value, {
        ...declaration,
        type: "FunctionExpression",
      });
      continue;
    }
    if (declaration.type === "ClassDeclaration") {
      values.set(declaration.identifier.value, {
        ...declaration,
        type: "ClassExpression",
      });
      continue;
    }
    if (declaration.type !== "VariableDeclaration" || declaration.declare) {
      continue;
    }
    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== "Identifier") continue;
      values.set(declarator.id.value, declarator.init ?? undefined);
    }
  }
  return values;
}

function getDefaultExportValue(body: ModuleItem[]): Expression | undefined {
  for (const item of body) {
    if (item.type === "ExportDefaultDeclaration") {
      return item.decl as Expression;
    }
    if (item.type === "ExportDefaultExpression") {
      return item.expression;
    }
    if (
      item.type === "ExportNamedDeclaration" &&
      !item.source &&
      !item.typeOnly
    ) {
      for (const specifier of item.specifiers) {
        if (
          specifier.type === "ExportSpecifier" &&
          !specifier.isTypeOnly &&
          specifier.exported?.value === "default" &&
          specifier.orig.type === "Identifier"
        ) {
          return specifier.orig;
        }
      }
    }
  }
  return undefined;
}

function validateDefaultMiddlewareExpression(
  value: Expression,
  localValues: Map<string, Expression | undefined>,
  seen: Set<string>,
  allowOrderedList: boolean,
): string | undefined {
  const expression = unwrapExpression(value);
  if (expression.type === "Identifier") {
    if (seen.has(expression.value)) return undefined;
    if (!localValues.has(expression.value)) return undefined;
    const localValue = localValues.get(expression.value);
    if (!localValue) {
      return allowOrderedList
        ? "Server middleware default export must resolve to a function or a non-empty ordered middleware list."
        : "Server middleware default export must resolve to a function.";
    }
    return validateDefaultMiddlewareExpression(
      localValue,
      localValues,
      new Set([...seen, expression.value]),
      allowOrderedList,
    );
  }

  if (expression.type === "ArrayExpression") {
    if (!allowOrderedList) {
      return "Server middleware list items must resolve to functions, not nested lists.";
    }
    if (expression.elements.length === 0) {
      return "Server middleware default export must contain at least one middleware function.";
    }
    for (const [index, element] of expression.elements.entries()) {
      if (!element) {
        return `Server middleware default export[${index}] must resolve to a middleware function.`;
      }
      if (element.spread) continue;
      const elementError = validateDefaultMiddlewareExpression(
        element.expression,
        localValues,
        new Set(seen),
        false,
      );
      if (elementError) {
        return `Server middleware default export[${index}] must resolve to a middleware function.`;
      }
    }
    return undefined;
  }

  if (expression.type === "FunctionExpression" && expression.generator) {
    return "Server middleware must be a regular or async function, not a generator.";
  }

  if (
    expression.type === "FunctionExpression" ||
    expression.type === "ArrowFunctionExpression" ||
    expression.type === "CallExpression"
  ) {
    return undefined;
  }

  if (
    expression.type === "StringLiteral" ||
    expression.type === "NumericLiteral" ||
    expression.type === "BooleanLiteral" ||
    expression.type === "NullLiteral" ||
    expression.type === "ObjectExpression" ||
    expression.type === "ClassExpression"
  ) {
    return allowOrderedList
      ? "Server middleware default export must resolve to a function or a non-empty ordered middleware list."
      : "Server middleware default export must resolve to a function.";
  }

  return undefined;
}

function unwrapExpression(expression: Expression): Expression {
  let current = expression;
  while (
    current.type === "ParenthesisExpression" ||
    current.type === "TsAsExpression" ||
    current.type === "TsSatisfiesExpression" ||
    current.type === "TsTypeAssertion" ||
    current.type === "TsNonNullExpression"
  ) {
    current = current.expression;
  }
  return current;
}

function compareMiddlewares(
  left: ServerMiddlewareNode,
  right: ServerMiddlewareNode,
): number {
  const leftDepth = left.scopeSegments?.length ?? 0;
  const rightDepth = right.scopeSegments?.length ?? 0;
  if (leftDepth !== rightDepth) return leftDepth - rightDepth;
  return left.module.localeCompare(right.module);
}

function isScopePrefix(scope: string[], routeSegments: string[]): boolean {
  if (scope.length > routeSegments.length) return false;
  return scope.every((segment, index) => routeSegments[index] === segment);
}

function formatScopeLabel(scopeSegments: string[]): string {
  if (scopeSegments.length === 0) return "/";
  return scopeSegments.join("/");
}

function formatServerMiddlewareSegmentConventionViolation(
  violation: RouteSegmentConventionViolation,
): string {
  if (violation.kind === "route-group") {
    return `Server middleware route group segment "${violation.segment}" must wrap a non-empty group name in parentheses, such as "(internal)".`;
  }
  if (violation.kind === "bracket") {
    const name = violation.segment.replace(/^\[+/, "").replace(/\]+$/, "");
    const suggestion =
      name && !name.startsWith("...")
        ? ` Rename the directory to "$${name}" for a dynamic segment.`
        : " Split it into explicit file-route directories.";
    return `Dynamic server middleware scope segments must use $param directories. Bracket segment "${violation.segment}" is not supported.${suggestion}`;
  }
  if (violation.kind === "unsupported-dynamic") {
    if (violation.segment === "$") {
      return 'Dynamic server middleware scope segments must include a name after "$". Segment "$" is not supported.';
    }
    if (violation.segment.startsWith("$...")) {
      return `Catch-all server middleware scope segments are not supported. Split wildcard handling into explicit file-route directories instead of "${violation.segment}".`;
    }
    if (violation.segment.endsWith("?")) {
      return `Optional server middleware scope segments are not supported. Split the route tree instead of "${violation.segment}".`;
    }
    return `Unsupported dynamic server middleware scope segment "${violation.segment}".`;
  }
  if (violation.kind === "dynamic") {
    return `Dynamic server middleware scope segment "${violation.segment}" must use a JavaScript identifier after "$", such as "$userId".`;
  }
  if (violation.kind === "reserved-dynamic") {
    return `Dynamic server middleware scope segment "${violation.segment}" uses a reserved param name. Use a safe application-specific name such as "$userId".`;
  }
  if (violation.kind === "duplicate-dynamic") {
    return `Dynamic server middleware scope segment "${violation.segment}" repeats a param name. Use unique dynamic param directories within one route path.`;
  }
  return `Static server middleware scope segment "${violation.segment}" must start with a lowercase letter or number and then use only lowercase URL-safe characters: lowercase letters, numbers, ".", "_", "-", or "~".`;
}

function toDiagnosticPath(projectPath: string): string {
  return projectPath.replace(/^\.\//, "");
}
