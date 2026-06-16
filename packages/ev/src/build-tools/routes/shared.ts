import { parseSync } from "@swc/core";
import type { Expression, KeyValueProperty, MethodProperty } from "@swc/types";

export type RouteAst = ReturnType<typeof parseSync>;

export function parseRouteModule(source: string): RouteAst | null {
  return parseRouteModuleWithError(source).ast;
}

export function parseRouteModuleWithError(source: string): {
  ast: RouteAst | null;
  error?: unknown;
} {
  try {
    return {
      ast: parseRouteModuleOrThrow(source),
    };
  } catch (error) {
    return { ast: null, error };
  }
}

export function getParseErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown parse error.";
}

export function formatParseErrorMessage(
  error: unknown,
  options: { firstLine?: boolean } = {},
): string {
  const message = getParseErrorMessage(error);
  if (!options.firstLine) return message;

  return message.split("\n").find(Boolean)?.trim() ?? "Unknown parse error.";
}

export function hasDefaultExport(ast: RouteAst): boolean {
  return ast.body.some(
    (item) =>
      item.type === "ExportDefaultDeclaration" ||
      item.type === "ExportDefaultExpression",
  );
}

export function parseRouteModuleOrThrow(source: string): RouteAst {
  return parseSync(source, {
    syntax: "typescript",
    tsx: true,
    target: "esnext",
  });
}

export function getPropertyName(
  property: KeyValueProperty | MethodProperty,
): string | null {
  if (property.key.type === "Identifier") return property.key.value;
  if (property.key.type === "StringLiteral") return property.key.value;
  return null;
}

export function collectImportedNames(
  ast: RouteAst,
  moduleName: string,
  importedName: string,
): Set<string> {
  const names = new Set<string>();

  for (const item of ast.body) {
    if (item.type !== "ImportDeclaration") continue;
    if (item.source.value !== moduleName) continue;

    for (const spec of item.specifiers) {
      if (spec.type !== "ImportSpecifier") continue;

      const imported = spec.imported ?? spec.local;
      if (imported.type === "Identifier" && imported.value === importedName) {
        names.add(spec.local.value);
      }
    }
  }

  return names;
}

export function isNamedCall(expr: Expression, names: Set<string>): boolean {
  if (expr.type !== "CallExpression") return false;
  return expr.callee.type === "Identifier" && names.has(expr.callee.value);
}
