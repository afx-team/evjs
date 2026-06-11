import type {
  ComponentModel,
  HydrationMode,
  PrerenderConfig,
  RenderMode,
} from "@evjs/shared/manifest";
import type { Expression, ModuleItem, ObjectExpression } from "@swc/types";
import { getPropertyName, parseRouteModule } from "./routes/shared.js";

export interface PageModuleConfig {
  render?: RenderMode;
  componentModel?: ComponentModel;
  hydrate?: HydrationMode;
  prerender?: PrerenderConfig;
}

export function extractPageModuleConfig(source: string): PageModuleConfig {
  const ast = parseRouteModule(source);
  if (!ast) return {};

  const config: PageModuleConfig = {};

  for (const item of ast.body) {
    const render = getExportedStringLiteral(item, "render");
    if (isRenderMode(render)) config.render = render;

    const componentModel = getExportedStringLiteral(item, "componentModel");
    if (isComponentModel(componentModel)) {
      config.componentModel = componentModel;
    }

    const hydrate = getExportedStringLiteral(item, "hydrate");
    if (isHydrationMode(hydrate)) config.hydrate = hydrate;

    const prerender = unwrapTypeScriptExpression(
      getExportedVariableDeclaration(item, "prerender"),
    );
    if (prerender?.type === "BooleanLiteral" && prerender.value === true) {
      config.prerender = true;
    } else if (prerender?.type === "ObjectExpression") {
      config.prerender = getPagePrerenderConfig(prerender);
    }
  }

  return config;
}

function getExportedStringLiteral(
  item: ModuleItem,
  name: string,
): string | undefined {
  const expression = unwrapTypeScriptExpression(
    getExportedVariableDeclaration(item, name),
  );
  return expression?.type === "StringLiteral" ? expression.value : undefined;
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

function getPagePrerenderConfig(
  expression: ObjectExpression,
): PrerenderConfig | undefined {
  const partial = getBooleanObjectProperty(expression, "partial");
  const delivery = getStringObjectProperty(expression, "delivery");
  const revalidate = getRevalidateObjectProperty(expression);

  const config: Exclude<PrerenderConfig, true> = {};
  if (partial !== undefined) config.partial = partial;
  if (delivery === "merge" || delivery === "stream") {
    config.delivery = delivery;
  }
  if (revalidate !== undefined) {
    config.revalidate = revalidate;
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

function getStringObjectProperty(
  expression: ObjectExpression,
  name: string,
): string | undefined {
  for (const prop of expression.properties) {
    if (prop.type !== "KeyValueProperty") continue;
    if (getPropertyName(prop) !== name) continue;
    return prop.value.type === "StringLiteral" ? prop.value.value : undefined;
  }
  return undefined;
}

function getBooleanObjectProperty(
  expression: ObjectExpression,
  name: string,
): boolean | undefined {
  for (const prop of expression.properties) {
    if (prop.type !== "KeyValueProperty") continue;
    if (getPropertyName(prop) !== name) continue;
    return prop.value.type === "BooleanLiteral" ? prop.value.value : undefined;
  }
  return undefined;
}

function getRevalidateObjectProperty(
  expression: ObjectExpression,
): number | false | undefined {
  for (const prop of expression.properties) {
    if (prop.type !== "KeyValueProperty") continue;
    if (getPropertyName(prop) !== "revalidate") continue;
    if (prop.value.type === "BooleanLiteral" && prop.value.value === false) {
      return false;
    }
    return prop.value.type === "NumericLiteral" ? prop.value.value : undefined;
  }
  return undefined;
}

function isRenderMode(value: string | undefined): value is RenderMode {
  return value === "csr" || value === "ssr" || value === "ssg";
}

function isComponentModel(value: string | undefined): value is ComponentModel {
  return value === "client" || value === "rsc";
}

function isHydrationMode(value: string | undefined): value is HydrationMode {
  return (
    value === "none" ||
    value === "load" ||
    value === "visible" ||
    value === "idle"
  );
}
