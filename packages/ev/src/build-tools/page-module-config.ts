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

export interface PageModuleConfigDiagnostic {
  level: "warning" | "error";
  message: string;
}

export interface PageModuleConfigAnalysis {
  config: PageModuleConfig;
  diagnostics: PageModuleConfigDiagnostic[];
}

export function analyzePageModuleConfig(
  source: string,
): PageModuleConfigAnalysis {
  const ast = parseRouteModule(source);
  if (!ast) return { config: {}, diagnostics: [] };

  const config: PageModuleConfig = {};
  const diagnostics: PageModuleConfigDiagnostic[] = [];

  for (const item of ast.body) {
    const render = getExportedValue(item, "render");
    if (render?.type === "StringLiteral" && isRenderMode(render.value)) {
      config.render = render.value;
    } else if (render?.type === "StringLiteral") {
      diagnostics.push({
        level: "error",
        message: createInvalidRenderDiagnostic(render.value),
      });
    } else if (render !== undefined) {
      diagnostics.push({
        level: "error",
        message:
          'Page render must be a string literal: "csr", "ssr", or "ssg".',
      });
    }

    const rsc = getExportedBooleanLiteral(item, "rsc");
    if (rsc === true) {
      config.componentModel = "rsc";
    }

    const hydrate = getExportedValue(item, "hydrate");
    if (hydrate?.type === "StringLiteral" && isHydrationMode(hydrate.value)) {
      config.hydrate = hydrate.value;
    } else if (hydrate !== undefined) {
      diagnostics.push({
        level: "error",
        message:
          'Page hydrate must be one of "none", "load", "visible", or "idle".',
      });
    }

    const prerender = getExportedValue(item, "prerender");
    if (prerender?.type === "BooleanLiteral" && prerender.value === true) {
      config.prerender = true;
    } else if (prerender?.type === "ObjectExpression") {
      config.prerender = getPagePrerenderConfig(prerender, diagnostics);
    } else if (
      prerender !== undefined &&
      !(prerender.type === "BooleanLiteral" && prerender.value === false)
    ) {
      diagnostics.push({
        level: "error",
        message: "Page prerender must be true or an object literal.",
      });
    }
  }

  return { config, diagnostics };
}

export function extractPageModuleConfig(source: string): PageModuleConfig {
  return analyzePageModuleConfig(source).config;
}

function createInvalidRenderDiagnostic(value: string): string {
  if (value === "ppr") {
    return 'Page render mode "ppr" is not supported. PPR is declared with render = "ssr" and prerender = { partial: true }.';
  }
  return `Unsupported page render mode "${value}". Expected "csr", "ssr", or "ssg".`;
}

function getExportedBooleanLiteral(
  item: ModuleItem,
  name: string,
): boolean | undefined {
  const expression = unwrapTypeScriptExpression(
    getExportedVariableDeclaration(item, name),
  );
  return expression?.type === "BooleanLiteral" ? expression.value : undefined;
}

function getExportedValue(
  item: ModuleItem,
  name: string,
): Expression | undefined {
  return unwrapTypeScriptExpression(getExportedVariableDeclaration(item, name));
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
  diagnostics: PageModuleConfigDiagnostic[],
): PrerenderConfig | undefined {
  const config: Exclude<PrerenderConfig, true> = {};

  const partial = getObjectPropertyValue(expression, "partial");
  if (partial?.type === "BooleanLiteral") {
    config.partial = partial.value;
  } else if (partial !== undefined) {
    diagnostics.push({
      level: "error",
      message: "Page prerender.partial must be a boolean literal.",
    });
  }

  const delivery = getObjectPropertyValue(expression, "delivery");
  if (
    delivery?.type === "StringLiteral" &&
    (delivery.value === "merge" || delivery.value === "stream")
  ) {
    config.delivery = delivery.value;
  } else if (delivery !== undefined) {
    diagnostics.push({
      level: "error",
      message: 'Page prerender.delivery must be "merge" or "stream".',
    });
  }

  const revalidate = getObjectPropertyValue(expression, "revalidate");
  if (revalidate?.type === "BooleanLiteral" && revalidate.value === false) {
    config.revalidate = false;
  } else if (revalidate?.type === "NumericLiteral") {
    config.revalidate = revalidate.value;
  } else if (revalidate !== undefined) {
    diagnostics.push({
      level: "error",
      message: "Page prerender.revalidate must be a number or false.",
    });
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

function getObjectPropertyValue(
  expression: ObjectExpression,
  name: string,
): Expression | undefined {
  for (const prop of expression.properties) {
    if (prop.type !== "KeyValueProperty") continue;
    if (getPropertyName(prop) !== name) continue;
    return unwrapTypeScriptExpression(prop.value);
  }
  return undefined;
}

function isRenderMode(value: string | undefined): value is RenderMode {
  return value === "csr" || value === "ssr" || value === "ssg";
}

function isHydrationMode(value: string | undefined): value is HydrationMode {
  return (
    value === "none" ||
    value === "load" ||
    value === "visible" ||
    value === "idle"
  );
}
