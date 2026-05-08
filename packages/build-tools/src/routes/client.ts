import type { ExtractedRoute } from "@evjs/manifest";
import type {
  CallExpression,
  Expression,
  ModuleItem,
  StringLiteral,
} from "@swc/types";
import {
  collectImportedNames,
  getPropertyName,
  isNamedCall,
  parseRouteModule,
  type RouteAst,
} from "./shared.js";

/**
 * Extract client route metadata from source code by scanning for createRoute() calls.
 *
 * Only collects routes that have a `path` property. Pathless layouts using `id`
 * are skipped because they do not represent navigable URLs.
 */
export function extractClientRoutes(source: string): ExtractedRoute[] {
  const ast = parseRouteModule(source);
  if (!ast) return [];
  return extractClientRoutesFromAst(ast);
}

export function extractClientRoutesFromAst(ast: RouteAst): ExtractedRoute[] {
  const createRouteNames = collectClientCreateRouteNames(ast);
  if (createRouteNames.size === 0) return [];

  const routes: ExtractedRoute[] = [];

  for (const item of ast.body) {
    collectFromItem(item, createRouteNames, routes);
  }

  return routes;
}

function collectClientCreateRouteNames(ast: RouteAst): Set<string> {
  return collectImportedNames(ast, "@evjs/client", "createRoute");
}

/** Walk a top-level module item looking for createRoute calls. */
function collectFromItem(
  item: ModuleItem,
  createRouteNames: Set<string>,
  routes: ExtractedRoute[],
): void {
  // export const fooRoute = createRoute({ ... })
  if (item.type === "ExportDeclaration") {
    const decl = item.declaration;
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        if (d.init) {
          const varName = d.id.type === "Identifier" ? d.id.value : undefined;
          const route = tryExtractClientRoute(d.init, createRouteNames);
          if (route) {
            routes.push({ ...route, ...(varName ? { varName } : {}) });
          }
        }
      }
    }
    return;
  }

  // const fooRoute = createRoute({ ... })
  if (item.type === "VariableDeclaration") {
    for (const d of item.declarations) {
      if (d.init) {
        const varName = d.id.type === "Identifier" ? d.id.value : undefined;
        const route = tryExtractClientRoute(d.init, createRouteNames);
        if (route) {
          routes.push({ ...route, ...(varName ? { varName } : {}) });
        }
      }
    }
  }
}

/** If the expression is a client createRoute() call, extract route metadata. */
function tryExtractClientRoute(
  expr: Expression,
  createRouteNames: Set<string>,
): Omit<ExtractedRoute, "varName"> | undefined {
  if (!isNamedCall(expr, createRouteNames)) return undefined;

  const call = expr as CallExpression;
  if (call.arguments.length === 0) return undefined;

  const arg = call.arguments[0].expression;
  if (arg.type !== "ObjectExpression") return undefined;

  let path: string | undefined;
  let parentName: string | undefined;

  for (const prop of arg.properties) {
    if (prop.type !== "KeyValueProperty") continue;
    const key = getPropertyName(prop);

    if (key === "path" && prop.value.type === "StringLiteral") {
      path = (prop.value as StringLiteral).value;
    }

    if (key === "getParentRoute") {
      parentName = extractParentName(prop.value);
    }
  }

  if (path !== undefined) {
    const route: ExtractedRoute = { path };
    if (parentName) route.parentName = parentName;
    return route;
  }

  return undefined;
}

/**
 * Extract the parent route variable name from a `getParentRoute` value.
 *
 * Handles arrow functions like:
 *   - `() => rootRoute`      (expression body)
 *   - `() => { return rootRoute; }` (block body)
 */
function extractParentName(expr: Expression): string | undefined {
  if (expr.type !== "ArrowFunctionExpression") return undefined;

  if (expr.body.type === "Identifier") {
    return expr.body.value;
  }

  if (expr.body.type === "BlockStatement" && expr.body.stmts.length === 1) {
    const stmt = expr.body.stmts[0];
    if (
      stmt.type === "ReturnStatement" &&
      stmt.argument?.type === "Identifier"
    ) {
      return stmt.argument.value;
    }
  }

  return undefined;
}
