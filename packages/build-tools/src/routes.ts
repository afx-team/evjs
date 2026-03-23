import { parseSync } from "@swc/core";
import type {
  CallExpression,
  Expression,
  KeyValueProperty,
  ModuleItem,
  StringLiteral,
} from "@swc/types";

/** Route metadata extracted from a createRoute() call. */
export interface ExtractedRoute {
  /** Route path (e.g. "/", "/posts/$postId"). */
  path: string;
}

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
          tryExtractFromExpr(d.init, routes);
        }
      }
    }
    return;
  }

  // const fooRoute = createRoute({ ... })
  if (item.type === "VariableDeclaration") {
    for (const d of item.declarations) {
      if (d.init) {
        tryExtractFromExpr(d.init, routes);
      }
    }
  }
}

/** If the expression is a createRoute() call, extract route metadata. */
function tryExtractFromExpr(expr: Expression, routes: ExtractedRoute[]): void {
  if (!isCreateRouteCall(expr)) return;

  const call = expr as CallExpression;
  if (call.arguments.length === 0) return;

  const arg = call.arguments[0].expression;
  if (arg.type !== "ObjectExpression") return;

  for (const prop of arg.properties) {
    if (prop.type !== "KeyValueProperty") continue;
    const key = getPropertyName(prop);
    if (key === "path" && prop.value.type === "StringLiteral") {
      routes.push({ path: (prop.value as StringLiteral).value });
      return;
    }
  }
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
