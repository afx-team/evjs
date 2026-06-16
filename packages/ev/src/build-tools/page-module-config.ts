import type {
  ComponentModel,
  HydrationMode,
  PrerenderConfig,
  RenderMode,
} from "@evjs/shared/manifest";
import type { Expression, ObjectExpression } from "@swc/types";
import {
  collectExportedVariableValueAnalysis,
  collectModuleExportNames,
} from "./module-exports.js";
import {
  formatParseErrorMessage,
  getPropertyName,
  parseRouteModuleWithError,
} from "./routes/shared.js";

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

const PAGE_MODULE_METADATA_EXPORTS = [
  "render",
  "rsc",
  "hydrate",
  "prerender",
] as const;

const PAGE_MODULE_METADATA_PARSE_DIAGNOSTIC_PREFIX =
  "Page module metadata could not be parsed:";

export function analyzePageModuleConfig(
  source: string,
): PageModuleConfigAnalysis {
  const { ast, error } = parseRouteModuleWithError(source);
  if (!ast) {
    return {
      config: {},
      diagnostics: [
        {
          level: "error",
          message: `${PAGE_MODULE_METADATA_PARSE_DIAGNOSTIC_PREFIX} ${formatParseErrorMessage(error, { firstLine: true })}`,
        },
      ],
    };
  }

  const config: PageModuleConfig = {};
  const diagnostics: PageModuleConfigDiagnostic[] = [];
  const exportAnalysis = collectExportedVariableValueAnalysis(ast.body);
  const exportedValues = new Map(exportAnalysis.values);
  const runtimeExportNames = new Set(collectModuleExportNames(ast.body));

  for (const name of PAGE_MODULE_METADATA_EXPORTS) {
    if (!exportAnalysis.duplicateNames.has(name)) continue;
    exportedValues.delete(name);
    diagnostics.push({
      level: "error",
      message: `Page metadata export "${name}" is declared more than once. Keep one static export for each metadata field.`,
    });
  }
  for (const name of PAGE_MODULE_METADATA_EXPORTS) {
    if (
      exportedValues.has(name) ||
      exportAnalysis.duplicateNames.has(name) ||
      !runtimeExportNames.has(name)
    ) {
      continue;
    }
    diagnostics.push({
      level: "error",
      message: `Page metadata export "${name}" must be declared as a local variable with a static initializer. Re-exported, function, and class exports are not supported for page metadata.`,
    });
  }

  const render = getExportedValue(exportedValues, "render");
  if (render?.type === "StringLiteral" && isRenderMode(render.value)) {
    config.render = render.value;
  } else if (render?.type === "StringLiteral") {
    diagnostics.push({
      level: "error",
      message: createInvalidRenderDiagnostic(render.value),
    });
  } else if (exportedValues.has("render")) {
    diagnostics.push({
      level: "error",
      message: 'Page render must be a string literal: "csr", "ssr", or "ssg".',
    });
  }

  const rsc = getExportedValue(exportedValues, "rsc");
  if (rsc?.type === "BooleanLiteral" && rsc.value === true) {
    config.componentModel = "rsc";
  } else if (rsc?.type === "BooleanLiteral" && rsc.value === false) {
    diagnostics.push({
      level: "warning",
      message:
        'Page rsc = false has no effect. Remove it, or use rsc = true with render = "ssr" to enable RSC.',
    });
  } else if (exportedValues.has("rsc")) {
    diagnostics.push({
      level: "error",
      message: "Page rsc must be a boolean literal.",
    });
  }

  const hydrate = getExportedValue(exportedValues, "hydrate");
  if (hydrate?.type === "StringLiteral" && isHydrationMode(hydrate.value)) {
    config.hydrate = hydrate.value;
  } else if (exportedValues.has("hydrate")) {
    diagnostics.push({
      level: "error",
      message:
        'Page hydrate must be one of "none", "load", "visible", or "idle".',
    });
  }

  const prerender = getExportedValue(exportedValues, "prerender");
  if (prerender?.type === "BooleanLiteral" && prerender.value === true) {
    config.prerender = true;
  } else if (prerender?.type === "ObjectExpression") {
    config.prerender = getPagePrerenderConfig(prerender, diagnostics);
  } else if (exportedValues.has("prerender")) {
    diagnostics.push({
      level: "error",
      message: "Page prerender must be true or an object literal.",
    });
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

function getExportedValue(
  exportedValues: Map<string, Expression | undefined>,
  name: string,
): Expression | undefined {
  return unwrapTypeScriptExpression(exportedValues.get(name));
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
  const propertyValidation = validatePrerenderObjectProperties(
    expression,
    diagnostics,
  );

  const partial = propertyValidation.duplicateProperties.has("partial")
    ? undefined
    : getObjectPropertyValue(expression, "partial");
  if (partial?.type === "BooleanLiteral") {
    config.partial = partial.value;
  } else if (partial !== undefined) {
    diagnostics.push({
      level: "error",
      message: "Page prerender.partial must be a boolean literal.",
    });
  }

  const delivery = propertyValidation.duplicateProperties.has("delivery")
    ? undefined
    : getObjectPropertyValue(expression, "delivery");
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

  const revalidate = propertyValidation.duplicateProperties.has("revalidate")
    ? undefined
    : getObjectPropertyValue(expression, "revalidate");
  if (revalidate?.type === "BooleanLiteral" && revalidate.value === false) {
    config.revalidate = false;
  } else if (
    revalidate?.type === "NumericLiteral" &&
    isPositiveInteger(revalidate.value)
  ) {
    config.revalidate = revalidate.value;
  } else if (revalidate !== undefined) {
    diagnostics.push({
      level: "error",
      message:
        "Page prerender.revalidate must be a positive integer number of seconds or false.",
    });
  }

  if (
    !propertyValidation.hasKnownProperty &&
    propertyValidation.hasOnlyKnownProperties
  ) {
    diagnostics.push({
      level: "error",
      message:
        "Page prerender object must declare partial, delivery, or revalidate.",
    });
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

function validatePrerenderObjectProperties(
  expression: ObjectExpression,
  diagnostics: PageModuleConfigDiagnostic[],
): {
  hasKnownProperty: boolean;
  hasOnlyKnownProperties: boolean;
  duplicateProperties: Set<string>;
} {
  const known = new Set(["partial", "delivery", "revalidate"]);
  const seen = new Set<string>();
  const duplicateProperties = new Set<string>();
  let hasKnownProperty = false;
  let hasOnlyKnownProperties = true;
  let reportedNamedUnsupportedProperty = false;

  for (const prop of expression.properties) {
    if (prop.type !== "KeyValueProperty") {
      hasOnlyKnownProperties = false;
      continue;
    }

    const name = getPropertyName(prop);
    if (name && known.has(name)) {
      hasKnownProperty = true;
      if (seen.has(name) && !duplicateProperties.has(name)) {
        duplicateProperties.add(name);
        diagnostics.push({
          level: "error",
          message: `Page prerender property "${name}" is declared more than once.`,
        });
      }
      seen.add(name);
      continue;
    }

    hasOnlyKnownProperties = false;
    if (name) {
      reportedNamedUnsupportedProperty = true;
      diagnostics.push({
        level: "error",
        message: `Page prerender property "${name}" is not supported. Expected partial, delivery, or revalidate.`,
      });
    }
  }

  if (!hasOnlyKnownProperties && !reportedNamedUnsupportedProperty) {
    diagnostics.push({
      level: "error",
      message:
        "Page prerender object can only contain partial, delivery, or revalidate literal properties.",
    });
  }

  return { hasKnownProperty, hasOnlyKnownProperties, duplicateProperties };
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

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
