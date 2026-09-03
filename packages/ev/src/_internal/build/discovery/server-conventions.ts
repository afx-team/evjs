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
} from "../conventions/route-conventions.js";
import { isInsideCwd, isRealPathInsideCwd, toPosixPath } from "../utils.js";

/** Fixed global middleware composition anchor for framework conventions. */
export const CANONICAL_SERVER_MIDDLEWARE_FILE =
  "./src/middlewares/middleware.ts";

export interface DiscoverServerConventionsOptions {
  globalFile: string;
}

export interface ServerConventionDiagnostic {
  level: "warning" | "error";
  message: string;
  file?: string;
}

export interface ServerConventionDiscovery {
  globalMiddlewares: ServerMiddlewareNode[];
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

  return {
    globalMiddlewares: globalMiddlewares.middlewares,
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

function toDiagnosticPath(projectPath: string): string {
  return projectPath.replace(/^\.\//, "");
}
