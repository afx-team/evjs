import { parseSync } from "@swc/core";
import type {
  CallExpression,
  Expression,
  KeyValueProperty,
  MethodProperty,
} from "@swc/types";

export type RouteAst = ReturnType<typeof parseSync>;

export function parseRouteModule(source: string): RouteAst | null {
  try {
    return parseSync(source, {
      syntax: "typescript",
      tsx: true,
      target: "esnext",
    });
  } catch {
    return null;
  }
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
  const callee = (expr as CallExpression).callee;
  return callee.type === "Identifier" && names.has(callee.value);
}
