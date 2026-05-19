import type { ExtractedRoute } from "@evjs/manifest";
import type {
  BlockStatement,
  CallExpression,
  Expression,
  MemberExpression,
  ModuleItem,
  Statement,
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
  return new Set([
    ...collectImportedNames(ast, "@evjs/client", "createRoute"),
    ...collectImportedNames(ast, "@evjs/client/route", "createRoute"),
  ]);
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
  const lazyImports = extractRouteLazyImports(expr);
  const routeExpr = unwrapRouteExpression(expr);

  if (!isNamedCall(routeExpr, createRouteNames)) return undefined;

  const call = routeExpr as CallExpression;
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
    if (lazyImports.length > 0) route.lazyImports = lazyImports;
    return route;
  }

  return undefined;
}

function unwrapRouteExpression(expr: Expression): Expression {
  if (
    expr.type === "CallExpression" &&
    expr.callee.type === "MemberExpression" &&
    getMemberPropertyName(expr.callee) === "lazy"
  ) {
    return unwrapRouteExpression(expr.callee.object as Expression);
  }

  return expr;
}

function extractRouteLazyImports(expr: Expression): string[] {
  if (
    expr.type !== "CallExpression" ||
    expr.callee.type !== "MemberExpression" ||
    getMemberPropertyName(expr.callee) !== "lazy"
  ) {
    return [];
  }

  const parentImports = extractRouteLazyImports(
    expr.callee.object as Expression,
  );
  const lazyArg = expr.arguments[0]?.expression;
  return [
    ...parentImports,
    ...(lazyArg ? extractDynamicImportSources(lazyArg) : []),
  ];
}

function getMemberPropertyName(expr: MemberExpression): string | undefined {
  return expr.property.type === "Identifier" ? expr.property.value : undefined;
}

function extractDynamicImportSources(expr: Expression): string[] {
  switch (expr.type) {
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return extractDynamicImportSourcesFromFunctionBody(expr.body);
    case "CallExpression": {
      const directImport = extractDirectImportSource(expr);
      return directImport
        ? [directImport]
        : extractDynamicImportSourcesFromCall(expr);
    }
    case "MemberExpression":
      return extractDynamicImportSources(expr.object as Expression);
    case "ParenthesisExpression":
      return extractDynamicImportSources(expr.expression);
    default:
      return [];
  }
}

function extractDynamicImportSourcesFromFunctionBody(
  body: BlockStatement | Expression | undefined,
): string[] {
  if (!body) return [];

  if (body.type !== "BlockStatement") {
    return extractDynamicImportSources(body);
  }

  for (const stmt of body.stmts as Statement[]) {
    if (stmt.type === "ReturnStatement" && stmt.argument) {
      return extractDynamicImportSources(stmt.argument);
    }
  }

  return [];
}

function extractDynamicImportSourcesFromCall(expr: CallExpression): string[] {
  const sources: string[] = [];

  if (expr.callee.type === "MemberExpression") {
    sources.push(
      ...extractDynamicImportSources(expr.callee.object as Expression),
    );
  }

  for (const arg of expr.arguments) {
    sources.push(...extractDynamicImportSources(arg.expression));
  }

  return sources;
}

function extractDirectImportSource(expr: CallExpression): string | undefined {
  if (expr.callee.type !== "Import") return undefined;
  const firstArg = expr.arguments[0]?.expression;
  return firstArg?.type === "StringLiteral"
    ? (firstArg as StringLiteral).value
    : undefined;
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
