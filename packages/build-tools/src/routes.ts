import type { ExtractedRoute } from "@evjs/manifest";
import { parseSync } from "@swc/core";
import type {
  CallExpression,
  Expression,
  KeyValueProperty,
  ModuleItem,
  StringLiteral,
} from "@swc/types";

export type { ExtractedRoute } from "@evjs/manifest";
export { resolveRoutes } from "@evjs/manifest";

/**
 * Extract route metadata from source code by scanning for createRoute() calls.
 *
 * Only collects routes that have a `path` property — pathless layouts (using `id`)
 * are skipped since they don't represent navigable URLs.
 *
 * @example
 * ```ts
 * extractRoutes('export const r = createRoute({ path: "/foo" })')
 * // => [{ path: "/foo" }]
 * ```
 */
export function extractRoutes(source: string): ExtractedRoute[] {
  let ast: ReturnType<typeof parseSync>;
  try {
    ast = parseSync(source, {
      syntax: "typescript",
      tsx: true,
      target: "esnext",
    });
  } catch {
    return [];
  }

  const routes: ExtractedRoute[] = [];

  for (const item of ast.body) {
    collectFromItem(item, routes);
  }

  return routes;
}

/** Walk a top-level module item looking for createRoute calls. */
function collectFromItem(item: ModuleItem, routes: ExtractedRoute[]): void {
  // export const fooRoute = createRoute({ ... })
  if (item.type === "ExportDeclaration") {
    const decl = item.declaration;
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        if (d.init) {
          const varName = d.id.type === "Identifier" ? d.id.value : undefined;
          tryExtractFromExpr(d.init, routes, varName);
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
        tryExtractFromExpr(d.init, routes, varName);
      }
    }
  }
}

/** If the expression is a createRoute() call, extract route metadata. */
function tryExtractFromExpr(
  expr: Expression,
  routes: ExtractedRoute[],
  varName?: string,
): void {
  if (!isCreateRouteCall(expr)) return;

  const call = expr as CallExpression;
  if (call.arguments.length === 0) return;

  const arg = call.arguments[0].expression;
  if (arg.type !== "ObjectExpression") return;

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
    if (varName) route.varName = varName;
    routes.push(route);
  }
}

/**
 * Extract the parent route variable name from a `getParentRoute` value.
 *
 * Handles arrow functions like:
 *   - `() => rootRoute`      (expression body)
 *   - `() => { return rootRoute; }` (block body — not common but safe)
 */
function extractParentName(expr: Expression): string | undefined {
  if (expr.type !== "ArrowFunctionExpression") return undefined;

  // () => rootRoute  (expression body)
  if (expr.body.type === "Identifier") {
    return expr.body.value;
  }

  // () => { return rootRoute; }
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

function isCreateRouteCall(expr: Expression): boolean {
  if (expr.type !== "CallExpression") return false;
  const callee = (expr as CallExpression).callee;
  return callee.type === "Identifier" && callee.value === "createRoute";
}

function getPropertyName(kv: KeyValueProperty): string | null {
  if (kv.key.type === "Identifier") return kv.key.value;
  if (kv.key.type === "StringLiteral") return kv.key.value;
  return null;
}
