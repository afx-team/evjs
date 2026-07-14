import { createHash } from "node:crypto";
import path from "node:path";
import type { PprCachePolicy, PprRegionConfig } from "@evjs/shared/manifest";
import type {
  CallExpression,
  Expression,
  JSXElement,
  JSXElementName,
  ModuleItem,
  ObjectExpression,
} from "@swc/types";
import {
  collectExportedVariableValueAnalysis,
  collectModuleExportNames,
} from "./module-exports.js";
import {
  collectImportedNames,
  formatParseErrorMessage,
  getPropertyName,
  parseRouteModule,
  parseRouteModuleWithError,
  type RouteAst,
} from "./routes/shared.js";
import { toPosixPath } from "./utils.js";

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

export interface PprRegionModuleConfigAnalysis {
  config: Partial<Omit<PprRegionConfig, "component">>;
  diagnostics: PprRegionDiagnostic[];
}

const PPR_REGION_METADATA_EXPORTS = ["cache"] as const;
const PPR_REGION_METADATA_PARSE_DIAGNOSTIC_PREFIX =
  "PPR region metadata could not be parsed:";
const UNSUPPORTED_PPR_SUSPENSE_DIAGNOSTIC =
  'PPR Suspense boundary was not split into an internal region renderer. Partial prerendering is experimental; evjs currently recognizes only a direct React.lazy(() => import("./...")) component child for compatibility, and other Suspense boundaries render as part of the shell until runtime postponed/resume support lands.';

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
  if (!hasSuspenseImport) {
    return emptyAnalysis();
  }

  const analysis: PprRegionAnalysis = {
    regions: {},
    diagnostics: [],
  };
  let warnedUnsupportedSuspense = false;
  const warnUnsupportedSuspense = () => {
    if (warnedUnsupportedSuspense) return;
    warnedUnsupportedSuspense = true;
    analysis.diagnostics.push({
      level: "warning",
      message: UNSUPPORTED_PPR_SUSPENSE_DIAGNOSTIC,
    });
  };

  const hasLazyImport =
    reactImports.lazyNames.size > 0 || reactImports.namespaceNames.size > 0;
  const lazyComponents = collectLazyComponents(ast, sourceRel, reactImports);
  let regionIndex = 0;

  walkModuleItems(ast.body, (element) => {
    const elementName = getJsxElementName(element.opening.name);
    if (!isSuspenseElementName(elementName, reactImports)) return;
    if (!hasLazyImport || lazyComponents.size === 0) {
      warnUnsupportedSuspense();
      return;
    }
    const collected = collectSuspenseRegion(
      element,
      sourceRel,
      reactImports,
      lazyComponents,
      analysis,
      regionIndex,
    );
    if (collected) {
      regionIndex += 1;
    } else {
      warnUnsupportedSuspense();
    }
  });

  return analysis;
}

export function extractPprRegionModuleConfig(
  source: string,
): PprRegionModuleConfigAnalysis {
  const { ast, error } = parseRouteModuleWithError(source);
  if (!ast) {
    return {
      config: {},
      diagnostics: [
        {
          level: "error",
          message: `${PPR_REGION_METADATA_PARSE_DIAGNOSTIC_PREFIX} ${formatParseErrorMessage(error, { firstLine: true })}`,
        },
      ],
    };
  }

  const config: Partial<Omit<PprRegionConfig, "component">> = {};
  const diagnostics: PprRegionDiagnostic[] = [];

  const exportAnalysis = collectExportedVariableValueAnalysis(ast.body);
  const exportedValues = new Map(exportAnalysis.values);
  const runtimeExportNames = new Set(collectModuleExportNames(ast.body));

  if (runtimeExportNames.has("hydrate")) {
    diagnostics.push({
      level: "error",
      message:
        "PPR region hydrate is not supported. Use an explicit client island for region interactivity.",
    });
  }

  for (const name of PPR_REGION_METADATA_EXPORTS) {
    if (!exportAnalysis.duplicateNames.has(name)) continue;
    exportedValues.delete(name);
    diagnostics.push({
      level: "error",
      message: `PPR region metadata export "${name}" is declared more than once. Keep one static export for each region metadata field.`,
    });
  }
  for (const name of PPR_REGION_METADATA_EXPORTS) {
    if (
      exportedValues.has(name) ||
      exportAnalysis.duplicateNames.has(name) ||
      !runtimeExportNames.has(name)
    ) {
      continue;
    }
    diagnostics.push({
      level: "error",
      message: `PPR region metadata export "${name}" must be declared as a local variable with a static initializer. Re-exported, function, and class exports are not supported for PPR region metadata.`,
    });
  }

  const cache = getExportedValue(exportedValues, "cache");
  if (exportedValues.has("cache")) {
    const cacheAnalysis = analyzeCacheValue(cache);
    if (cacheAnalysis.value !== undefined) {
      config.cache = cacheAnalysis.value;
    } else {
      diagnostics.push({
        level: "error",
        message: cacheAnalysis.message,
      });
    }
  }

  return { config, diagnostics };
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
  sourceRel: string,
  reactImports: ReturnType<typeof collectReactImports>,
  lazyComponents: Map<string, LazyComponentReference>,
  analysis: PprRegionAnalysis,
  regionIndex: number,
): boolean {
  const elementName = getJsxElementName(element.opening.name);
  if (!isSuspenseElementName(elementName, reactImports)) return false;

  const componentName = getFirstComponentChildName(element);
  const component = componentName
    ? lazyComponents.get(componentName)
    : undefined;
  if (!componentName || !component) return false;

  const id = createInternalPprRegionId(
    sourceRel,
    component.module,
    regionIndex,
  );
  if (analysis.regions[id]) {
    analysis.diagnostics.push({
      level: "error",
      message: `Duplicate internal PPR region id "${id}" in the same module.`,
    });
    return false;
  }
  analysis.regions[id] = {
    component: component.module,
  };
  return true;
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
  callee: CallExpression["callee"],
  reactImports: ReturnType<typeof collectReactImports>,
): boolean {
  if (callee.type === "Identifier") {
    return reactImports.lazyNames.has(callee.value);
  }

  if (callee.type !== "MemberExpression") return false;
  return (
    callee.object.type === "Identifier" &&
    reactImports.namespaceNames.has(callee.object.value) &&
    callee.property.type === "Identifier" &&
    callee.property.value === "lazy"
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
  if (!isRecord(value)) return;

  if (isJsxElement(value)) {
    visit(value);
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        walkUnknown(item, visit);
      }
      continue;
    }
    walkUnknown(child, visit);
  }
}

function isJsxElement(value: unknown): value is JSXElement {
  return (
    isRecord(value) &&
    value.type === "JSXElement" &&
    isRecord(value.opening) &&
    Array.isArray(value.children)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function getExportedValue(
  exportedValues: Map<string, Expression | undefined>,
  name: string,
): Expression | undefined {
  return unwrapTypeScriptExpression(exportedValues.get(name));
}

function analyzeCacheValue(expression: Expression | undefined): {
  value?: PprCachePolicy;
  message: string;
} {
  const genericMessage =
    'PPR region cache must be "no-store" or an object literal with a positive integer revalidate.';
  if (!expression) return { message: genericMessage };
  if (expression.type === "StringLiteral") {
    return expression.value === "no-store"
      ? { value: "no-store", message: "" }
      : { message: genericMessage };
  }
  if (expression.type !== "ObjectExpression") {
    return { message: genericMessage };
  }

  const propertyValidation = validateCacheObjectProperties(expression);
  if (propertyValidation.duplicateRevalidate) {
    return {
      message:
        'PPR region cache property "revalidate" is declared more than once.',
    };
  }
  if (propertyValidation.hasUnsupportedProperty) {
    return {
      message:
        "PPR region cache object can only contain a revalidate property.",
    };
  }

  const revalidate = getNumericObjectProperty(expression, "revalidate");
  return revalidate === undefined || !isPositiveInteger(revalidate)
    ? { message: genericMessage }
    : { value: { revalidate }, message: "" };
}

function validateCacheObjectProperties(expression: ObjectExpression): {
  duplicateRevalidate: boolean;
  hasUnsupportedProperty: boolean;
} {
  let hasRevalidate = false;
  let duplicateRevalidate = false;
  let hasUnsupportedProperty = false;

  for (const prop of expression.properties) {
    if (prop.type !== "KeyValueProperty") {
      hasUnsupportedProperty = true;
      continue;
    }
    const name = getPropertyName(prop);
    if (name === "revalidate") {
      duplicateRevalidate = hasRevalidate || duplicateRevalidate;
      hasRevalidate = true;
      continue;
    }
    hasUnsupportedProperty = true;
  }

  return { duplicateRevalidate, hasUnsupportedProperty };
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
    const value = unwrapTypeScriptExpression(prop.value);
    return value?.type === "NumericLiteral" ? value.value : undefined;
  }
  return undefined;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function createInternalPprRegionId(
  sourceRel: string,
  module: string,
  regionIndex: number,
): string {
  const hash = createHash("sha256")
    .update(`${sourceRel}\0${module}\0${regionIndex}`)
    .digest("hex")
    .slice(0, 12);
  return `region_${hash}`;
}

function normalizeRelativeModule(sourceRel: string, specifier: string): string {
  return `./${toPosixPath(path.normalize(path.join(path.dirname(sourceRel), specifier)))}`;
}

function emptyAnalysis(): PprRegionAnalysis {
  return {
    regions: {},
    diagnostics: [],
  };
}
