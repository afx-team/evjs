import {
  getPathPatternValidationError,
  getServerRouteParamSegmentValidationError,
  HTTP_METHOD_LIST_DESCRIPTION,
  isHttpMethod,
  type PathPatternValidationError,
  type ServerRouteParamSegmentValidationError,
} from "@evjs/shared";
import type { ExtractedServerRoute } from "@evjs/shared/manifest";
import type { CallExpression, Expression, ObjectExpression } from "@swc/types";
import { getModuleExportName } from "../module-exports.js";
import {
  collectImportedNames,
  getPropertyName,
  isNamedCall,
  parseRouteModule,
  type RouteAst,
} from "./shared.js";

const SUPPORTED_DEFINITION_KEYS = `${HTTP_METHOD_LIST_DESCRIPTION} or "middlewares"`;

export interface ServerRouteAnalysis {
  serverRoutes: ExtractedServerRoute[];
  diagnostics: ServerRouteDiagnostic[];
}

export interface ServerRouteDiagnostic {
  level: "warning" | "error";
  message: string;
  line?: number;
  column?: number;
}

type LocalRouteValueKind = "function" | "middlewareArray" | "nonFunction";
const SERVER_ROUTE_CREATE_ROUTE_MODULES = ["@evjs/server"] as const;

/**
 * Detect server route handlers exported from this file.
 * Returns the exported variable names, or null if this is not a server route file.
 */
export function detectServerRouteExports(source: string): string[] | null {
  const ast = parseRouteModule(source);
  if (!ast) return null;

  const createRouteNames = collectServerCreateRouteNames(ast);
  if (createRouteNames.size === 0) return null;

  const exportNames = collectServerRouteExportNames(ast, createRouteNames);
  return exportNames.length > 0 ? exportNames : null;
}

/**
 * Extract server route handler metadata from exported createRoute() calls.
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
  return analyzeServerRoutesFromAst(ast).serverRoutes;
}

export function analyzeServerRoutesFromAst(ast: RouteAst): ServerRouteAnalysis {
  const createRouteNames = collectServerCreateRouteNames(ast);
  if (createRouteNames.size === 0) {
    return { serverRoutes: [], diagnostics: [] };
  }

  const routeDeclarations = new Map<string, ServerRouteDeclaration>();
  const localValues = collectLocalRouteValueKinds(ast);
  const serverRoutes: ExtractedServerRoute[] = [];
  const diagnostics: ServerRouteDiagnostic[] = [];

  for (const item of ast.body) {
    if (item.type === "ExportDeclaration") {
      const decl = item.declaration;
      if (decl.type === "VariableDeclaration" && !decl.declare) {
        for (const d of decl.declarations) {
          if (d.init && d.id.type === "Identifier") {
            addExportedRouteDeclaration(
              d.id.value,
              d.init,
              createRouteNames,
              localValues,
              serverRoutes,
              diagnostics,
            );
          }
        }
      }
      continue;
    }

    if (item.type === "VariableDeclaration") {
      if (item.declare) continue;
      for (const d of item.declarations) {
        if (d.init && d.id.type === "Identifier") {
          const declaration = analyzeServerRouteDeclaration(
            d.init,
            createRouteNames,
            localValues,
          );
          if (declaration) {
            routeDeclarations.set(d.id.value, declaration);
          }
        }
      }
      continue;
    }

    if (item.type === "ExportNamedDeclaration") {
      if (item.typeOnly) continue;
      for (const spec of item.specifiers) {
        if (spec.type !== "ExportSpecifier") continue;
        if (spec.isTypeOnly) continue;
        if (spec.orig.type !== "Identifier") continue;

        const declaration = routeDeclarations.get(spec.orig.value);
        if (!declaration) continue;

        const exported = spec.exported ?? spec.orig;
        const exportName = getModuleExportName(exported);
        if (!exportName) continue;
        addAnalyzedRouteDeclaration(
          exportName,
          declaration,
          serverRoutes,
          diagnostics,
        );
      }
    }
  }

  return { serverRoutes, diagnostics };
}

interface ServerRouteDeclaration {
  route?: ExtractedServerRoute;
  diagnostic?: ServerRouteDiagnostic;
}

function collectServerCreateRouteNames(ast: RouteAst): Set<string> {
  const names = new Set<string>();
  for (const moduleName of SERVER_ROUTE_CREATE_ROUTE_MODULES) {
    for (const name of collectImportedNames(ast, moduleName, "createRoute")) {
      names.add(name);
    }
  }
  return names;
}

function collectServerRouteExportNames(
  ast: RouteAst,
  createRouteNames: Set<string>,
): string[] {
  const routeDeclarations = new Set<string>();
  const exportNames: string[] = [];

  for (const item of ast.body) {
    if (item.type === "ExportDeclaration") {
      const decl = item.declaration;
      if (decl.type === "VariableDeclaration" && !decl.declare) {
        for (const d of decl.declarations) {
          if (
            d.init &&
            d.id.type === "Identifier" &&
            tryExtractServerRoute(d.init, createRouteNames)
          ) {
            exportNames.push(d.id.value);
          }
        }
      }
      continue;
    }

    if (item.type === "VariableDeclaration") {
      if (item.declare) continue;
      for (const d of item.declarations) {
        if (
          d.init &&
          d.id.type === "Identifier" &&
          tryExtractServerRoute(d.init, createRouteNames)
        ) {
          routeDeclarations.add(d.id.value);
        }
      }
      continue;
    }

    if (item.type === "ExportNamedDeclaration") {
      if (item.typeOnly) continue;
      for (const spec of item.specifiers) {
        if (spec.type !== "ExportSpecifier") continue;
        if (spec.isTypeOnly) continue;
        if (spec.orig.type !== "Identifier") continue;
        if (!routeDeclarations.has(spec.orig.value)) continue;

        const exported = spec.exported ?? spec.orig;
        const exportName = getModuleExportName(exported);
        if (exportName) exportNames.push(exportName);
      }
    }
  }

  return exportNames;
}

function addExportedRouteDeclaration(
  exportName: string,
  expr: Expression,
  createRouteNames: Set<string>,
  localValues: Map<string, LocalRouteValueKind>,
  routes: ExtractedServerRoute[],
  diagnostics: ServerRouteDiagnostic[],
): void {
  const declaration = analyzeServerRouteDeclaration(
    expr,
    createRouteNames,
    localValues,
  );
  if (!declaration) return;
  addAnalyzedRouteDeclaration(exportName, declaration, routes, diagnostics);
}

function addAnalyzedRouteDeclaration(
  exportName: string,
  declaration: ServerRouteDeclaration,
  routes: ExtractedServerRoute[],
  diagnostics: ServerRouteDiagnostic[],
): void {
  if (declaration.route) {
    routes.push(declaration.route);
    return;
  }
  if (declaration.diagnostic) {
    diagnostics.push({
      ...declaration.diagnostic,
      message: `Server route "${exportName}" ${declaration.diagnostic.message}`,
    });
  }
}

function analyzeServerRouteDeclaration(
  expr: Expression,
  createRouteNames: Set<string>,
  localValues: Map<string, LocalRouteValueKind>,
): ServerRouteDeclaration | undefined {
  if (!isNamedCall(expr, createRouteNames)) return undefined;

  const call = expr as CallExpression;
  if (call.arguments.length < 2) {
    return {
      diagnostic: {
        level: "error",
        message: "must call createRoute(path, definition).",
      },
    };
  }

  const pathArg = call.arguments[0].expression;
  if (pathArg.type !== "StringLiteral") {
    return {
      diagnostic: {
        level: "error",
        message: "must use a string-literal createRoute() path.",
      },
    };
  }
  const pathDiagnostic = validateServerRoutePath(pathArg.value);
  if (pathDiagnostic) return { diagnostic: pathDiagnostic };

  const definitionArg = call.arguments[1].expression;
  if (definitionArg.type !== "ObjectExpression") {
    return {
      diagnostic: {
        level: "error",
        message: "must use an object-literal createRoute() definition.",
      },
    };
  }

  const definitionDiagnostic = validateServerRouteDefinition(
    definitionArg,
    localValues,
  );
  if (definitionDiagnostic) return { diagnostic: definitionDiagnostic };

  const route = tryExtractServerRoute(expr, createRouteNames);
  if (!route) {
    return {
      diagnostic: {
        level: "error",
        message: "could not be statically analyzed.",
      },
    };
  }

  const diagnostic = validateServerRoute(route);
  return diagnostic ? { diagnostic } : { route };
}

function validateServerRoute(
  route: ExtractedServerRoute,
): ServerRouteDiagnostic | undefined {
  const pathDiagnostic = validateServerRoutePath(route.path);
  if (pathDiagnostic) return pathDiagnostic;

  if (route.methods.length === 0) {
    return {
      level: "error",
      message: "must declare at least one HTTP method handler.",
    };
  }
  return undefined;
}

function validateServerRoutePath(
  path: string,
): ServerRouteDiagnostic | undefined {
  const error = getPathPatternValidationError(path);
  if (error) {
    return {
      level: "error",
      message: formatServerRoutePathValidationError(error),
    };
  }

  const paramError = getServerRouteParamSegmentValidationError(path);
  if (paramError) {
    return {
      level: "error",
      message: `path ${formatServerRouteParamValidationError(paramError)}`,
    };
  }

  return undefined;
}

function formatServerRoutePathValidationError(
  error: PathPatternValidationError,
): string {
  switch (error) {
    case "empty":
      return "must use a non-empty createRoute() path.";
    case "missing-leading-slash":
      return 'must use a createRoute() path that starts with "/".';
    case "whitespace":
      return "must use a createRoute() path without whitespace.";
    case "query-or-hash":
      return "must use a createRoute() path without query strings or hashes.";
  }
}

function formatServerRouteParamValidationError(
  error: ServerRouteParamSegmentValidationError,
): string {
  switch (error.error) {
    case "empty":
      return `contains dynamic segment "${error.segment}" without a param name.`;
    case "reserved":
      return `uses reserved dynamic param name "${error.name}" in segment "${error.segment}". Use a safe application-specific name.`;
    case "duplicate":
      return `uses duplicate dynamic param name "${error.name}" in segment "${error.segment}". Use unique param names within one route path.`;
  }
}

function validateServerRouteDefinition(
  definition: ObjectExpression,
  localValues: Map<string, LocalRouteValueKind>,
): ServerRouteDiagnostic | undefined {
  const seenKeys = new Set<string>();
  for (const prop of definition.properties) {
    if (prop.type !== "KeyValueProperty" && prop.type !== "MethodProperty") {
      return {
        level: "error",
        message: "must not use spread properties in createRoute() definition.",
      };
    }

    const key = getPropertyName(prop);
    if (!key) {
      return {
        level: "error",
        message: "must use static property names in createRoute() definition.",
      };
    }
    if (seenKeys.has(key)) {
      return {
        level: "error",
        message: `definition key "${key}" is declared more than once.`,
      };
    }
    seenKeys.add(key);

    if (key === "middleware") {
      return {
        level: "error",
        message:
          'uses "middleware"; use "middlewares" for per-route middleware.',
      };
    }
    if (key === "middlewares") {
      if (prop.type !== "KeyValueProperty") {
        return {
          level: "error",
          message: "middlewares must be an array of functions.",
        };
      }
      const diagnostic = validateServerRouteMiddlewaresValue(
        prop.value,
        localValues,
      );
      if (diagnostic) return diagnostic;
      continue;
    }
    if (!isHttpMethod(key)) {
      return {
        level: "error",
        message: `definition key "${key}" is not supported. Use ${SUPPORTED_DEFINITION_KEYS}.`,
      };
    }
    if (
      prop.type === "KeyValueProperty" &&
      isKnownNonFunctionExpression(prop.value, localValues)
    ) {
      return {
        level: "error",
        message: `${key} handler must be a function.`,
      };
    }
  }

  return undefined;
}

function validateServerRouteMiddlewaresValue(
  value: Expression,
  localValues: Map<string, LocalRouteValueKind>,
): ServerRouteDiagnostic | undefined {
  const expression = unwrapExpression(value);
  if (expression.type === "ArrayExpression") {
    for (const element of expression.elements) {
      if (!element) {
        return {
          level: "error",
          message: "middlewares must be an array of functions.",
        };
      }
      if (element.spread) continue;
      if (isKnownNonFunctionExpression(element.expression, localValues)) {
        return {
          level: "error",
          message: "middlewares must be an array of functions.",
        };
      }
    }
    return undefined;
  }

  if (expression.type === "Identifier") {
    const localKind = localValues.get(expression.value);
    if (localKind === "middlewareArray") return undefined;
    if (localKind) {
      return {
        level: "error",
        message: "middlewares must be an array of functions.",
      };
    }
  }

  if (isObviouslyNonArrayExpression(expression)) {
    return {
      level: "error",
      message: "middlewares must be an array of functions.",
    };
  }

  return undefined;
}

function collectLocalRouteValueKinds(
  ast: RouteAst,
): Map<string, LocalRouteValueKind> {
  const locals = new Map<string, LocalRouteValueKind>();

  for (const item of ast.body) {
    if (item.type === "FunctionDeclaration") {
      const name = item.identifier?.value;
      if (name && !item.declare && item.body) {
        locals.set(name, "function");
      }
    }
  }

  for (const item of ast.body) {
    if (item.type !== "VariableDeclaration" || item.declare) continue;
    for (const declaration of item.declarations) {
      if (declaration.id.type !== "Identifier") continue;
      if (!declaration.init) {
        locals.set(declaration.id.value, "nonFunction");
        continue;
      }
      const kind = getLocalRouteValueKind(declaration.init, locals);
      if (kind) locals.set(declaration.id.value, kind);
    }
  }

  return locals;
}

function getLocalRouteValueKind(
  expression: Expression,
  locals: Map<string, LocalRouteValueKind>,
): LocalRouteValueKind | undefined {
  const unwrapped = unwrapExpression(expression);
  if (
    unwrapped.type === "ArrowFunctionExpression" ||
    unwrapped.type === "FunctionExpression"
  ) {
    return "function";
  }

  if (unwrapped.type === "ArrayExpression") {
    for (const element of unwrapped.elements) {
      if (!element) return "nonFunction";
      if (element.spread) continue;
      if (isKnownNonFunctionExpression(element.expression, locals)) {
        return "nonFunction";
      }
    }
    return "middlewareArray";
  }

  if (isObviouslyNonFunctionExpression(unwrapped)) {
    return "nonFunction";
  }

  return undefined;
}

function isKnownNonFunctionExpression(
  expression: Expression,
  localValues: Map<string, LocalRouteValueKind>,
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (isObviouslyNonFunctionExpression(unwrapped)) return true;
  if (unwrapped.type !== "Identifier") return false;

  const localKind = localValues.get(unwrapped.value);
  return localKind === "middlewareArray" || localKind === "nonFunction";
}

function unwrapExpression(expression: Expression): Expression {
  let current = expression;
  while (
    current.type === "ParenthesisExpression" ||
    current.type === "TsAsExpression" ||
    current.type === "TsConstAssertion" ||
    current.type === "TsInstantiation" ||
    current.type === "TsNonNullExpression" ||
    current.type === "TsSatisfiesExpression" ||
    current.type === "TsTypeAssertion"
  ) {
    current = current.expression;
  }

  return current;
}

function isObviouslyNonFunctionExpression(expression: Expression): boolean {
  switch (unwrapExpression(expression).type) {
    case "ArrayExpression":
    case "BigIntLiteral":
    case "BooleanLiteral":
    case "JSXElement":
    case "JSXFragment":
    case "JSXText":
    case "NullLiteral":
    case "NumericLiteral":
    case "ObjectExpression":
    case "RegExpLiteral":
    case "StringLiteral":
    case "TemplateLiteral":
      return true;
    default:
      return false;
  }
}

function isObviouslyNonArrayExpression(expression: Expression): boolean {
  switch (unwrapExpression(expression).type) {
    case "ArrowFunctionExpression":
    case "BigIntLiteral":
    case "BooleanLiteral":
    case "FunctionExpression":
    case "JSXElement":
    case "JSXFragment":
    case "JSXText":
    case "NullLiteral":
    case "NumericLiteral":
    case "ObjectExpression":
    case "RegExpLiteral":
    case "StringLiteral":
    case "TemplateLiteral":
      return true;
    default:
      return false;
  }
}

function tryExtractServerRoute(
  expr: Expression,
  createRouteNames: Set<string>,
): ExtractedServerRoute | undefined {
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
    if (method && isHttpMethod(method) && !methods.includes(method)) {
      methods.push(method);
    }
  }
  return methods;
}
