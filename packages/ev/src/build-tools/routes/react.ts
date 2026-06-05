import type {
  ExtractedRoute,
  HydrationMode,
  RenderMode,
  ServerRuntime,
} from "@evjs/shared/manifest";
import type {
  CallExpression,
  Declaration,
  Expression,
  ModuleItem,
  Span,
  StringLiteral,
} from "@swc/types";
import {
  collectImportedNames,
  getPropertyName,
  isNamedCall,
  parseRouteModule,
  type RouteAst,
} from "./shared.js";

const REACT_ROUTE_MODULES = ["@evjs/client"];

export interface ReactRouteDiagnostic {
  level: "warning" | "error";
  message: string;
  line?: number;
  column?: number;
}

export function extractReactRoutes(source: string): ExtractedRoute[] {
  const ast = parseRouteModule(source);
  if (!ast) return [];
  return extractReactRoutesFromAst(ast);
}

export function extractReactRoutesFromAst(ast: RouteAst): ExtractedRoute[] {
  const routeNames = collectReactRouteImports(ast, "route");
  if (routeNames.size === 0) return [];

  const pageNames = collectReactRouteImports(ast, "page");
  const routes: ExtractedRoute[] = [];

  for (const item of ast.body) {
    collectReactRoutesFromItem(item, routeNames, pageNames, routes);
  }

  return routes;
}

export function extractReactRouteDiagnosticsFromAst(
  ast: RouteAst,
  source: string,
): ReactRouteDiagnostic[] {
  const routeNames = collectReactRouteImports(ast, "route");
  if (routeNames.size === 0) return [];

  const pageNames = collectReactRouteImports(ast, "page");
  const diagnostics: ReactRouteDiagnostic[] = [];

  for (const item of ast.body) {
    diagnoseReactRoutesFromItem(
      item,
      source,
      routeNames,
      pageNames,
      diagnostics,
    );
  }

  return diagnostics;
}

function collectReactRouteImports(ast: RouteAst, importedName: string) {
  const names = new Set<string>();
  for (const moduleName of REACT_ROUTE_MODULES) {
    for (const localName of collectImportedNames(
      ast,
      moduleName,
      importedName,
    )) {
      names.add(localName);
    }
  }
  return names;
}

function collectReactRoutesFromItem(
  item: ModuleItem,
  routeNames: Set<string>,
  pageNames: Set<string>,
  routes: ExtractedRoute[],
): void {
  if (item.type === "ExpressionStatement") {
    collectReactRoutesFromExpression(
      item.expression,
      routeNames,
      pageNames,
      routes,
    );
    return;
  }

  if (item.type === "ExportDefaultExpression") {
    collectReactRoutesFromExpression(
      item.expression,
      routeNames,
      pageNames,
      routes,
    );
    return;
  }

  if (item.type === "ExportDeclaration") {
    collectReactRoutesFromDeclaration(
      item.declaration,
      routeNames,
      pageNames,
      routes,
    );
    return;
  }

  if (item.type === "VariableDeclaration") {
    collectReactRoutesFromDeclaration(item, routeNames, pageNames, routes);
  }
}

function diagnoseReactRoutesFromItem(
  item: ModuleItem,
  source: string,
  routeNames: Set<string>,
  pageNames: Set<string>,
  diagnostics: ReactRouteDiagnostic[],
): void {
  if (item.type === "ExpressionStatement") {
    diagnoseReactRoutesFromExpression(
      item.expression,
      source,
      routeNames,
      pageNames,
      diagnostics,
    );
    return;
  }

  if (item.type === "ExportDefaultExpression") {
    diagnoseReactRoutesFromExpression(
      item.expression,
      source,
      routeNames,
      pageNames,
      diagnostics,
    );
    return;
  }

  if (item.type === "ExportDeclaration") {
    diagnoseReactRoutesFromDeclaration(
      item.declaration,
      source,
      routeNames,
      pageNames,
      diagnostics,
    );
    return;
  }

  if (item.type === "VariableDeclaration") {
    diagnoseReactRoutesFromDeclaration(
      item,
      source,
      routeNames,
      pageNames,
      diagnostics,
    );
  }
}

function collectReactRoutesFromDeclaration(
  declaration: Declaration,
  routeNames: Set<string>,
  pageNames: Set<string>,
  routes: ExtractedRoute[],
): void {
  if (declaration.type !== "VariableDeclaration") return;

  for (const declarator of declaration.declarations) {
    if (!declarator.init) continue;
    collectReactRoutesFromExpression(
      declarator.init,
      routeNames,
      pageNames,
      routes,
    );
  }
}

function diagnoseReactRoutesFromDeclaration(
  declaration: Declaration,
  source: string,
  routeNames: Set<string>,
  pageNames: Set<string>,
  diagnostics: ReactRouteDiagnostic[],
): void {
  if (declaration.type !== "VariableDeclaration") return;

  for (const declarator of declaration.declarations) {
    if (!declarator.init) continue;
    diagnoseReactRoutesFromExpression(
      declarator.init,
      source,
      routeNames,
      pageNames,
      diagnostics,
    );
  }
}

function collectReactRoutesFromExpression(
  expression: Expression,
  routeNames: Set<string>,
  pageNames: Set<string>,
  routes: ExtractedRoute[],
): void {
  const route = tryExtractReactRoute(expression, routeNames, pageNames);
  if (route) {
    routes.push(route);
    return;
  }

  if (expression.type === "CallExpression") {
    for (const arg of expression.arguments) {
      collectReactRoutesFromExpression(
        arg.expression,
        routeNames,
        pageNames,
        routes,
      );
    }
    return;
  }

  if (expression.type === "ArrayExpression") {
    for (const element of expression.elements) {
      if (!element) continue;
      collectReactRoutesFromExpression(
        element.expression,
        routeNames,
        pageNames,
        routes,
      );
    }
    return;
  }

  if (expression.type === "ObjectExpression") {
    for (const prop of expression.properties) {
      if (prop.type !== "KeyValueProperty") continue;
      collectReactRoutesFromExpression(
        prop.value,
        routeNames,
        pageNames,
        routes,
      );
    }
  }
}

function diagnoseReactRoutesFromExpression(
  expression: Expression,
  source: string,
  routeNames: Set<string>,
  pageNames: Set<string>,
  diagnostics: ReactRouteDiagnostic[],
): void {
  diagnoseReactRouteExpression(
    expression,
    source,
    routeNames,
    pageNames,
    diagnostics,
  );

  if (expression.type === "CallExpression") {
    for (const arg of expression.arguments) {
      diagnoseReactRoutesFromExpression(
        arg.expression,
        source,
        routeNames,
        pageNames,
        diagnostics,
      );
    }
    return;
  }

  if (expression.type === "ArrayExpression") {
    for (const element of expression.elements) {
      if (!element) continue;
      diagnoseReactRoutesFromExpression(
        element.expression,
        source,
        routeNames,
        pageNames,
        diagnostics,
      );
    }
    return;
  }

  if (expression.type === "ObjectExpression") {
    for (const prop of expression.properties) {
      if (prop.type !== "KeyValueProperty") continue;
      diagnoseReactRoutesFromExpression(
        prop.value,
        source,
        routeNames,
        pageNames,
        diagnostics,
      );
    }
  }
}

function diagnoseReactRouteExpression(
  expression: Expression,
  source: string,
  routeNames: Set<string>,
  pageNames: Set<string>,
  diagnostics: ReactRouteDiagnostic[],
): void {
  if (!isNamedCall(expression, routeNames)) return;

  const call = expression as CallExpression;
  const pathArg = call.arguments[0]?.expression;
  if (pathArg?.type !== "StringLiteral") {
    diagnostics.push(
      createDiagnostic(
        source,
        getExpressionSpan(pathArg) ?? call.span,
        "@evjs/client route() path must be a string literal.",
      ),
    );
  }

  const optionsArg = call.arguments[1]?.expression;
  if (optionsArg?.type !== "ObjectExpression") return;

  let render: RenderMode | undefined;
  let pageExpression: Expression | undefined;
  for (const prop of optionsArg.properties) {
    if (prop.type !== "KeyValueProperty") continue;
    const key = getPropertyName(prop);
    if (key === "render" && prop.value.type === "StringLiteral") {
      render = prop.value.value as RenderMode;
    }
    if (key === "page") {
      pageExpression = prop.value;
    }
  }

  if (!render || render === "csr") return;
  if (!extractPageModule(pageExpression, pageNames)) {
    diagnostics.push(
      createDiagnostic(
        source,
        getExpressionSpan(pageExpression) ?? optionsArg.span,
        `@evjs/client route() with render: "${render}" must declare page(componentPath) with a string literal component module path.`,
      ),
    );
  }
}

function tryExtractReactRoute(
  expression: Expression,
  routeNames: Set<string>,
  pageNames: Set<string>,
): ExtractedRoute | undefined {
  if (!isNamedCall(expression, routeNames)) return undefined;

  const call = expression as CallExpression;
  const pathArg = call.arguments[0]?.expression;
  if (pathArg?.type !== "StringLiteral") return undefined;

  const optionsArg = call.arguments[1]?.expression;
  if (optionsArg?.type !== "ObjectExpression") {
    return { path: pathArg.value };
  }

  const route: ExtractedRoute = { path: pathArg.value };

  for (const prop of optionsArg.properties) {
    if (prop.type !== "KeyValueProperty") continue;
    const key = getPropertyName(prop);

    if (key === "id" && prop.value.type === "StringLiteral") {
      route.id = prop.value.value;
    }
    if (key === "page") {
      route.module = extractPageModule(prop.value, pageNames);
    }
    if (key === "render" && prop.value.type === "StringLiteral") {
      route.render = prop.value.value as RenderMode;
    }
    if (key === "hydrate" && prop.value.type === "StringLiteral") {
      route.hydrate = prop.value.value as HydrationMode;
    }
    if (key === "runtime" && prop.value.type === "StringLiteral") {
      route.runtime = prop.value.value as ServerRuntime;
    }
  }

  return route;
}

function extractPageModule(
  expression: Expression | undefined,
  pageNames: Set<string>,
): string | undefined {
  if (!expression) return undefined;
  if (!isNamedCall(expression, pageNames)) return undefined;

  const call = expression as CallExpression;
  const componentArg = call.arguments[0]?.expression;
  if (componentArg?.type !== "StringLiteral") return undefined;
  return (componentArg as StringLiteral).value;
}

function createDiagnostic(
  source: string,
  span: Span | undefined,
  message: string,
): ReactRouteDiagnostic {
  return {
    level: "error",
    message,
    ...lineColumnForSpan(source, span),
  };
}

function getExpressionSpan(
  expression: Expression | undefined,
): Span | undefined {
  return (expression as { span?: Span } | undefined)?.span;
}

function lineColumnForSpan(
  source: string,
  span: Span | undefined,
): { line?: number; column?: number } {
  if (!span?.start) return {};

  const offset = Math.max(0, span.start - 1);
  const prefix = Buffer.from(source, "utf-8")
    .subarray(0, offset)
    .toString("utf-8");
  const lines = prefix.split(/\r\n|\r|\n/);
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}
