import path from "node:path";
import type {
  HydrationMode,
  PprCachePolicy,
  PprRegionConfig,
} from "@evjs/shared/manifest";
import type {
  Expression,
  JSXElement,
  JSXElementName,
  ModuleItem,
  ObjectExpression,
} from "@swc/types";
import {
  collectImportedNames,
  getPropertyName,
  parseRouteModule,
  type RouteAst,
} from "./routes/shared.js";

export interface PprRegionAnalysis {
  regions: Record<string, PprRegionConfig>;
  diagnostics: PprRegionDiagnostic[];
}

export interface PprRegionDiagnostic {
  level: "warning" | "error";
  message: string;
  line?: number;
  column?: number;
}

interface LazyComponentReference {
  module: string;
}

export function extractPprRegions(
  source: string,
  sourceRel: string,
): PprRegionAnalysis {
  const ast = parseRouteModule(source);
  if (!ast) return emptyAnalysis();

  const reactImports = collectReactImports(ast);
  const hasSuspenseImport =
    reactImports.suspenseNames.size > 0 || reactImports.namespaceNames.size > 0;
  const hasLazyImport =
    reactImports.lazyNames.size > 0 || reactImports.namespaceNames.size > 0;
  if (!hasSuspenseImport || !hasLazyImport) {
    return emptyAnalysis();
  }

  const lazyComponents = collectLazyComponents(ast, sourceRel, reactImports);
  if (lazyComponents.size === 0) return emptyAnalysis();

  const analysis: PprRegionAnalysis = {
    regions: {},
    diagnostics: [],
  };

  walkModuleItems(ast.body, (element) => {
    collectSuspenseRegion(element, reactImports, lazyComponents, analysis);
  });

  return analysis;
}

export function extractPprRegionModuleConfig(
  source: string,
): Partial<Omit<PprRegionConfig, "component">> {
  const ast = parseRouteModule(source);
  if (!ast) return {};

  const config: Partial<Omit<PprRegionConfig, "component">> = {};
  for (const item of ast.body) {
    const cache = getExportedCachePolicy(item);
    if (cache !== undefined) config.cache = cache;

    const hydrate = getExportedHydrationMode(item);
    if (hydrate !== undefined) config.hydrate = hydrate;
  }

  return config;
}

function collectReactImports(ast: RouteAst): {
  suspenseNames: Set<string>;
  lazyNames: Set<string>;
  namespaceNames: Set<string>;
} {
  return {
    suspenseNames: collectImportedNames(ast, "react", "Suspense"),
    lazyNames: collectImportedNames(ast, "react", "lazy"),
    namespaceNames: collectNamespaceImports(ast, "react"),
  };
}

function collectNamespaceImports(
  ast: RouteAst,
  moduleName: string,
): Set<string> {
  const names = new Set<string>();

  for (const item of ast.body) {
    if (item.type !== "ImportDeclaration") continue;
    if (item.source.value !== moduleName) continue;

    for (const specifier of item.specifiers) {
      if (specifier.type === "ImportNamespaceSpecifier") {
        names.add(specifier.local.value);
      }
    }
  }

  return names;
}

function collectLazyComponents(
  ast: RouteAst,
  sourceRel: string,
  reactImports: ReturnType<typeof collectReactImports>,
): Map<string, LazyComponentReference> {
  const components = new Map<string, LazyComponentReference>();

  for (const item of ast.body) {
    if (item.type !== "VariableDeclaration") continue;

    for (const declaration of item.declarations) {
      if (declaration.id.type !== "Identifier" || !declaration.init) continue;

      const importSpecifier = getLazyImportSpecifier(
        declaration.init,
        reactImports,
      );
      if (!importSpecifier) continue;

      components.set(declaration.id.value, {
        module: normalizeRelativeModule(sourceRel, importSpecifier),
      });
    }
  }

  return components;
}

function collectSuspenseRegion(
  element: JSXElement,
  reactImports: ReturnType<typeof collectReactImports>,
  lazyComponents: Map<string, LazyComponentReference>,
  analysis: PprRegionAnalysis,
) {
  const elementName = getJsxElementName(element.opening.name);
  if (!isSuspenseElementName(elementName, reactImports)) return;

  const componentName = getFirstComponentChildName(element);
  const component = componentName
    ? lazyComponents.get(componentName)
    : undefined;
  if (!componentName || !component) return;

  const id = derivePprRegionId(componentName);
  analysis.regions[id] = {
    component: component.module,
  };
}

function getLazyImportSpecifier(
  expression: Expression,
  reactImports: ReturnType<typeof collectReactImports>,
): string | undefined {
  if (expression.type !== "CallExpression") return undefined;
  if (!isLazyCallee(expression.callee, reactImports)) return undefined;

  const firstArg = expression.arguments[0]?.expression;
  if (!firstArg) return undefined;

  return getImportSpecifierFromLazyFactory(firstArg);
}

function getImportSpecifierFromLazyFactory(
  expression: Expression,
): string | undefined {
  if (
    expression.type !== "ArrowFunctionExpression" &&
    expression.type !== "FunctionExpression"
  ) {
    return undefined;
  }

  if (!expression.body) return undefined;

  if (expression.body.type === "BlockStatement") {
    for (const statement of expression.body.stmts) {
      if (statement.type !== "ReturnStatement" || !statement.argument) continue;
      return getDynamicImportSpecifier(statement.argument);
    }
    return undefined;
  }

  return getDynamicImportSpecifier(expression.body);
}

function getDynamicImportSpecifier(expression: Expression): string | undefined {
  if (expression.type !== "CallExpression") return undefined;
  if (expression.callee.type !== "Import") return undefined;

  const firstArg = expression.arguments[0]?.expression;
  return firstArg?.type === "StringLiteral" && firstArg.value.startsWith(".")
    ? firstArg.value
    : undefined;
}

function isLazyCallee(
  callee: Expression["type"] extends never ? never : unknown,
  reactImports: ReturnType<typeof collectReactImports>,
): boolean {
  const record = callee as Record<string, unknown>;
  if (record.type === "Identifier") {
    return reactImports.lazyNames.has(String(record.value));
  }

  if (record.type !== "MemberExpression") return false;
  const object = record.object as Record<string, unknown> | undefined;
  const property = record.property as Record<string, unknown> | undefined;
  return (
    object?.type === "Identifier" &&
    reactImports.namespaceNames.has(String(object.value)) &&
    property?.type === "Identifier" &&
    property.value === "lazy"
  );
}

function isSuspenseElementName(
  name: string | undefined,
  reactImports: ReturnType<typeof collectReactImports>,
): boolean {
  if (!name) return false;
  if (reactImports.suspenseNames.has(name)) return true;

  const [namespaceName, propertyName] = name.split(".");
  return (
    propertyName === "Suspense" &&
    reactImports.namespaceNames.has(namespaceName ?? "")
  );
}

function walkModuleItems(
  items: ModuleItem[],
  visit: (element: JSXElement) => void,
) {
  for (const item of items) {
    walkUnknown(item, visit);
  }
}

function walkUnknown(value: unknown, visit: (element: JSXElement) => void) {
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  if (record.type === "JSXElement") {
    visit(record as unknown as JSXElement);
  }

  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        walkUnknown(item, visit);
      }
      continue;
    }
    walkUnknown(child, visit);
  }
}

function getExportedVariableDeclaration(
  item: ModuleItem,
  name: string,
): Expression | undefined {
  if (item.type !== "ExportDeclaration") return undefined;
  const declaration = item.declaration;
  if (declaration.type !== "VariableDeclaration") return undefined;

  for (const declarator of declaration.declarations) {
    if (declarator.id.type !== "Identifier") continue;
    if (declarator.id.value === name) return declarator.init ?? undefined;
  }

  return undefined;
}

function unwrapTypeScriptExpression(
  expression: Expression | undefined,
): Expression | undefined {
  let current = expression;
  while (
    current?.type === "TsAsExpression" ||
    current?.type === "TsSatisfiesExpression" ||
    current?.type === "TsTypeAssertion" ||
    current?.type === "TsConstAssertion"
  ) {
    current = current.expression;
  }
  return current;
}

function getExportedCachePolicy(item: ModuleItem): PprCachePolicy | undefined {
  const expression = unwrapTypeScriptExpression(
    getExportedVariableDeclaration(item, "cache"),
  );
  return expression ? getCacheValue(expression) : undefined;
}

function getExportedHydrationMode(item: ModuleItem): HydrationMode | undefined {
  const expression = unwrapTypeScriptExpression(
    getExportedVariableDeclaration(item, "hydrate"),
  );
  if (expression?.type !== "StringLiteral") return undefined;
  return isHydrationMode(expression.value) ? expression.value : undefined;
}

function getCacheValue(expression: Expression): PprCachePolicy | undefined {
  if (expression.type === "StringLiteral") {
    return expression.value === "no-store" ? "no-store" : undefined;
  }
  if (expression.type !== "ObjectExpression") return undefined;

  const revalidate = getNumericObjectProperty(expression, "revalidate");
  return revalidate === undefined ? undefined : { revalidate };
}

function getFirstComponentChildName(element: JSXElement): string | undefined {
  for (const child of element.children) {
    if (child.type !== "JSXElement") continue;
    const name = getJsxElementName(child.opening.name);
    if (name && /^[A-Z]/.test(name)) return name;
  }
  return undefined;
}

function getJsxElementName(name: JSXElementName): string | undefined {
  if (name.type === "Identifier") return name.value;
  if (name.type !== "JSXMemberExpression") return undefined;

  const object =
    name.object.type === "Identifier"
      ? name.object.value
      : getJsxElementName(name.object);
  return object ? `${object}.${name.property.value}` : undefined;
}

function getNumericObjectProperty(
  expression: ObjectExpression,
  name: string,
): number | undefined {
  for (const prop of expression.properties) {
    if (prop.type !== "KeyValueProperty") continue;
    if (getPropertyName(prop) !== name) continue;
    return prop.value.type === "NumericLiteral" ? prop.value.value : undefined;
  }
  return undefined;
}

function isHydrationMode(value: string | undefined): value is HydrationMode {
  return (
    value === "none" ||
    value === "load" ||
    value === "visible" ||
    value === "idle"
  );
}

function derivePprRegionId(componentName: string): string {
  const withoutSuffix = componentName
    .replace(/PprRegion$/, "")
    .replace(/Region$/, "");
  const kebab = withoutSuffix
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
  return kebab || componentName.toLowerCase();
}

function normalizeRelativeModule(sourceRel: string, specifier: string): string {
  return `./${toPosixPath(path.normalize(path.join(path.dirname(sourceRel), specifier)))}`;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function emptyAnalysis(): PprRegionAnalysis {
  return {
    regions: {},
    diagnostics: [],
  };
}
