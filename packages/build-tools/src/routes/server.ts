import type { ExtractedServerRoute } from "@evjs/manifest";
import type { CallExpression, Expression, ObjectExpression } from "@swc/types";
import {
  collectImportedNames,
  getPropertyName,
  isNamedCall,
  parseRouteModule,
  type RouteAst,
} from "./shared.js";

const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
]);

/**
 * Detect server route handlers exported from this file.
 * Returns the exported variable names, or null if this is not a server route file.
 */
export function detectServerRouteExports(source: string): string[] | null {
  const routes = extractServerRoutes(source);
  if (routes.length === 0) return null;
  return routes.map((route) => route.export);
}

/**
 * Extract server route handler metadata from exported @evjs/server createRoute() calls.
 *
 * Handles both direct exports and named export aliases:
 *   - export const users = createRoute("/api/users", { GET() {} })
 *   - const internal = createRoute("/api/users", { GET() {} }); export { internal as users }
 */
export function extractServerRoutes(source: string): ExtractedServerRoute[] {
  const ast = parseRouteModule(source);
  if (!ast) return [];
  return extractServerRoutesFromAst(ast);
}

export function extractServerRoutesFromAst(
  ast: RouteAst,
): ExtractedServerRoute[] {
  const createRouteNames = collectServerCreateRouteNames(ast);
  if (createRouteNames.size === 0) return [];

  const routeDeclarations = new Map<
    string,
    Omit<ExtractedServerRoute, "export">
  >();
  const routes: ExtractedServerRoute[] = [];

  for (const item of ast.body) {
    if (item.type === "ExportDeclaration") {
      const decl = item.declaration;
      if (decl.type === "VariableDeclaration") {
        for (const d of decl.declarations) {
          if (d.init && d.id.type === "Identifier") {
            const route = tryExtractServerRoute(d.init, createRouteNames);
            if (route) {
              routes.push({ ...route, export: d.id.value });
            }
          }
        }
      }
      continue;
    }

    if (item.type === "VariableDeclaration") {
      for (const d of item.declarations) {
        if (d.init && d.id.type === "Identifier") {
          const route = tryExtractServerRoute(d.init, createRouteNames);
          if (route) {
            routeDeclarations.set(d.id.value, route);
          }
        }
      }
      continue;
    }

    if (item.type === "ExportNamedDeclaration") {
      for (const spec of item.specifiers) {
        if (spec.type !== "ExportSpecifier") continue;
        if (spec.orig.type !== "Identifier") continue;

        const route = routeDeclarations.get(spec.orig.value);
        if (!route) continue;

        const exported = spec.exported ?? spec.orig;
        if (exported.type === "Identifier") {
          routes.push({ ...route, export: exported.value });
        }
      }
    }
  }

  return routes;
}

function collectServerCreateRouteNames(ast: RouteAst): Set<string> {
  return collectImportedNames(ast, "@evjs/server", "createRoute");
}

function tryExtractServerRoute(
  expr: Expression,
  createRouteNames: Set<string>,
): Omit<ExtractedServerRoute, "export"> | undefined {
  if (!isNamedCall(expr, createRouteNames)) return undefined;

  const call = expr as CallExpression;
  if (call.arguments.length < 2) return undefined;

  const pathArg = call.arguments[0].expression;
  if (pathArg.type !== "StringLiteral") return undefined;

  const definitionArg = call.arguments[1].expression;
  if (definitionArg.type !== "ObjectExpression") return undefined;

  return {
    path: pathArg.value,
    methods: extractServerRouteMethods(definitionArg),
  };
}

function extractServerRouteMethods(definition: ObjectExpression): string[] {
  const methods: string[] = [];
  for (const prop of definition.properties) {
    if (prop.type !== "KeyValueProperty" && prop.type !== "MethodProperty") {
      continue;
    }
    const method = getPropertyName(prop);
    if (method && HTTP_METHODS.has(method) && !methods.includes(method)) {
      methods.push(method);
    }
  }
  return methods;
}
