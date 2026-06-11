import type { ExtractedRoute } from "@evjs/shared/manifest";
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

const REACT_ROUTE_MODULES = ["@evjs/client", "@evjs/client/routes"];

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
  const componentModules = collectImportedComponentModules(ast);
  const routes: ExtractedRoute[] = [];

  for (const item of ast.body) {
    collectReactRoutesFromItem(
      item,
      routeNames,
      pageNames,
      componentModules,
      routes,
    );
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
  const componentModules = collectImportedComponentModules(ast);
  const diagnostics: ReactRouteDiagnostic[] = [];

  for (const item of ast.body) {
    diagnoseReactRoutesFromItem(
      item,
      source,
      routeNames,
      pageNames,
      componentModules,
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

function collectImportedComponentModules(ast: RouteAst) {
  const modules = new Map<string, string>();

  for (const item of ast.body) {
    if (item.type !== "ImportDeclaration") continue;
    const source = item.source.value;

    for (const spec of item.specifiers) {
      if (spec.type === "ImportDefaultSpecifier") {
        modules.set(spec.local.value, source);
      }
    }
  }

  return modules;
}

function collectReactRoutesFromItem(
  item: ModuleItem,
  routeNames: Set<string>,
  pageNames: Set<string>,
  componentModules: Map<string, string>,
  routes: ExtractedRoute[],
): void {
  if (item.type === "ExpressionStatement") {
    collectReactRoutesFromExpression(
      item.expression,
      routeNames,
      pageNames,
      componentModules,
      routes,
    );
    return;
  }

  if (item.type === "ExportDefaultExpression") {
    collectReactRoutesFromExpression(
      item.expression,
      routeNames,
      pageNames,
      componentModules,
      routes,
    );
    return;
  }

  if (item.type === "ExportDeclaration") {
    collectReactRoutesFromDeclaration(
      item.declaration,
      routeNames,
      pageNames,
      componentModules,
      routes,
    );
    return;
  }

  if (item.type === "VariableDeclaration") {
    collectReactRoutesFromDeclaration(
      item,
      routeNames,
      pageNames,
      componentModules,
      routes,
    );
  }
}

function diagnoseReactRoutesFromItem(
  item: ModuleItem,
  source: string,
  routeNames: Set<string>,
  pageNames: Set<string>,
  componentModules: Map<string, string>,
  diagnostics: ReactRouteDiagnostic[],
): void {
  if (item.type === "ExpressionStatement") {
    diagnoseReactRoutesFromExpression(
      item.expression,
      source,
      routeNames,
      pageNames,
      componentModules,
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
      componentModules,
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
      componentModules,
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
      componentModules,
      diagnostics,
    );
  }
}

function collectReactRoutesFromDeclaration(
  declaration: Declaration,
  routeNames: Set<string>,
  pageNames: Set<string>,
  componentModules: Map<string, string>,
  routes: ExtractedRoute[],
): void {
  if (declaration.type !== "VariableDeclaration") return;

  for (const declarator of declaration.declarations) {
    if (!declarator.init) continue;
    collectReactRoutesFromExpression(
      declarator.init,
      routeNames,
      pageNames,
      componentModules,
      routes,
    );
  }
}

function diagnoseReactRoutesFromDeclaration(
  declaration: Declaration,
  source: string,
  routeNames: Set<string>,
  pageNames: Set<string>,
  componentModules: Map<string, string>,
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
      componentModules,
      diagnostics,
    );
  }
}

function collectReactRoutesFromExpression(
  expression: Expression,
  routeNames: Set<string>,
  pageNames: Set<string>,
  componentModules: Map<string, string>,
  routes: ExtractedRoute[],
): void {
  const route = tryExtractReactRoute(
    expression,
    routeNames,
    pageNames,
    componentModules,
  );
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
        componentModules,
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
        componentModules,
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
        componentModules,
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
  componentModules: Map<string, string>,
  diagnostics: ReactRouteDiagnostic[],
): void {
  diagnoseReactRouteExpression(
    expression,
    source,
    routeNames,
    pageNames,
    componentModules,
    diagnostics,
  );

  if (expression.type === "CallExpression") {
    for (const arg of expression.arguments) {
      diagnoseReactRoutesFromExpression(
        arg.expression,
        source,
        routeNames,
        pageNames,
        componentModules,
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
        componentModules,
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
        componentModules,
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
  componentModules: Map<string, string>,
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

  const targetArg = getReactRouteTargetExpression(call);
  const optionsArg = getReactRouteOptionsExpression(call);
  const pageExpression = getRoutePageExpression(optionsArg);

  if (
    (targetArg || pageExpression) &&
    !extractRouteModule({
      targetExpression: targetArg,
      pageExpression,
      pageNames,
      componentModules,
    })
  ) {
    diagnostics.push(
      createDiagnostic(
        source,
        getExpressionSpan(pageExpression ?? targetArg) ?? call.span,
        "@evjs/client route() component targets must be default imports or page(componentPath) references.",
      ),
    );
  }
}

function tryExtractReactRoute(
  expression: Expression,
  routeNames: Set<string>,
  pageNames: Set<string>,
  componentModules: Map<string, string>,
): ExtractedRoute | undefined {
  if (!isNamedCall(expression, routeNames)) return undefined;

  const call = expression as CallExpression;
  const pathArg = call.arguments[0]?.expression;
  if (pathArg?.type !== "StringLiteral") return undefined;

  const targetArg = getReactRouteTargetExpression(call);
  const optionsArg = getReactRouteOptionsExpression(call);
  if (optionsArg?.type !== "ObjectExpression") {
    return {
      path: pathArg.value,
      module: extractRouteModule({
        targetExpression: targetArg,
        pageNames,
        componentModules,
      }),
    };
  }

  const route: ExtractedRoute = { path: pathArg.value };
  const pageExpression = getRoutePageExpression(optionsArg);

  for (const prop of optionsArg.properties) {
    if (prop.type !== "KeyValueProperty") continue;
    const key = getPropertyName(prop);

    if (key === "id" && prop.value.type === "StringLiteral") {
      route.id = prop.value.value;
    }
  }

  route.module = extractRouteModule({
    targetExpression: targetArg,
    pageExpression,
    pageNames,
    componentModules,
  });

  return route;
}

function getRoutePageExpression(
  optionsArg: Expression | undefined,
): Expression | undefined {
  if (optionsArg?.type !== "ObjectExpression") return undefined;

  for (const prop of optionsArg.properties) {
    if (prop.type !== "KeyValueProperty") continue;
    if (getPropertyName(prop) === "page") return prop.value;
  }
  return undefined;
}

function getReactRouteOptionsExpression(
  call: CallExpression,
): Expression | undefined {
  const secondArg = call.arguments[1]?.expression;
  if (secondArg?.type === "ObjectExpression") return secondArg;
  return call.arguments[2]?.expression;
}

function getReactRouteTargetExpression(
  call: CallExpression,
): Expression | undefined {
  const secondArg = call.arguments[1]?.expression;
  return secondArg?.type === "ObjectExpression" ? undefined : secondArg;
}

function extractRouteModule(options: {
  targetExpression?: Expression;
  pageExpression?: Expression;
  pageNames: Set<string>;
  componentModules: Map<string, string>;
}): string | undefined {
  return (
    extractPageModule(options.pageExpression, options.pageNames) ??
    extractPageModule(options.targetExpression, options.pageNames) ??
    extractImportedComponentModule(
      options.targetExpression,
      options.componentModules,
    )
  );
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

function extractImportedComponentModule(
  expression: Expression | undefined,
  componentModules: Map<string, string>,
): string | undefined {
  if (!expression) return undefined;

  if (expression.type === "Identifier") {
    return componentModules.get(expression.value);
  }

  if (
    expression.type === "MemberExpression" &&
    expression.object.type === "Identifier"
  ) {
    return componentModules.get(expression.object.value);
  }

  return undefined;
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
