import { parseSync } from "@swc/core";
import type { ModuleItem } from "@swc/types";

export interface RuntimeModuleReference {
  kind: "load" | "resolve";
  specifier: string;
}

/**
 * Extract runtime module specifiers without requiring the source to parse.
 *
 * The regex fallback is intentionally conservative: it may retain an extra
 * dependency after a syntax error, but it must not lose the file whose repair
 * should retry framework analysis.
 */
export function extractRuntimeModuleSpecifiers(
  source: string,
  options: { includeRequire?: boolean } = {},
): string[] {
  return extractRuntimeModuleReferences(source, options).map(
    ({ specifier }) => specifier,
  );
}

export function extractRuntimeModuleReferences(
  source: string,
  options: { includeRequire?: boolean } = {},
): RuntimeModuleReference[] {
  const references = new Map<string, RuntimeModuleReference>();
  for (const reference of extractParsedModuleReferences(source, options)) {
    const previous = references.get(reference.specifier);
    if (!previous || reference.kind === "load") {
      references.set(reference.specifier, reference);
    }
  }
  return [...references.values()];
}

function extractParsedModuleReferences(
  source: string,
  options: { includeRequire?: boolean },
): RuntimeModuleReference[] {
  try {
    const ast = parseSync(source, {
      syntax: "typescript",
      tsx: true,
      target: "esnext",
    });
    return [
      ...ast.body.flatMap((item) => getStaticModuleReference(item, options)),
      ...extractParsedRuntimeCallReferences(ast, options),
    ];
  } catch {
    return [
      ...extractStaticModuleReferencesWithRegex(source),
      ...extractRuntimeCallReferencesWithRegex(source, options),
    ];
  }
}

function getStaticModuleReference(
  item: ModuleItem,
  options: { includeRequire?: boolean },
): RuntimeModuleReference[] {
  if (item.type === "ImportDeclaration") {
    if (
      item.typeOnly ||
      (item.specifiers.length > 0 &&
        item.specifiers.every(
          (specifier) =>
            specifier.type === "ImportSpecifier" && specifier.isTypeOnly,
        ))
    ) {
      return [];
    }
    return [{ kind: "load", specifier: item.source.value }];
  }
  if (item.type === "ExportNamedDeclaration" && item.source) {
    if (
      item.typeOnly ||
      (item.specifiers.length > 0 &&
        item.specifiers.every(
          (specifier) =>
            specifier.type === "ExportSpecifier" && specifier.isTypeOnly,
        ))
    ) {
      return [];
    }
    return [{ kind: "load", specifier: item.source.value }];
  }
  if (item.type === "ExportAllDeclaration") {
    return "typeOnly" in item && item.typeOnly
      ? []
      : [{ kind: "load", specifier: item.source.value }];
  }
  if (
    options.includeRequire &&
    item.type === "TsImportEqualsDeclaration" &&
    !item.isTypeOnly &&
    item.moduleRef.type === "TsExternalModuleReference"
  ) {
    return [{ kind: "load", specifier: item.moduleRef.expression.value }];
  }
  return [];
}

function extractParsedRuntimeCallReferences(
  ast: unknown,
  options: { includeRequire?: boolean },
): RuntimeModuleReference[] {
  const references: RuntimeModuleReference[] = [];

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isAstRecord(value)) return;
    if (value.type === "TsImportType") return;

    const reference = getRuntimeCallReference(value, options);
    if (reference) references.push(reference);
    for (const child of Object.values(value)) visit(child);
  }

  visit(ast);
  return references;
}

function getRuntimeCallReference(
  expression: Record<string, unknown>,
  options: { includeRequire?: boolean },
): RuntimeModuleReference | undefined {
  if (
    expression.type !== "CallExpression" ||
    !Array.isArray(expression.arguments)
  ) {
    return undefined;
  }

  const firstArgument = expression.arguments[0];
  if (
    !isAstRecord(firstArgument) ||
    firstArgument.spread ||
    !isAstRecord(firstArgument.expression) ||
    firstArgument.expression.type !== "StringLiteral" ||
    typeof firstArgument.expression.value !== "string"
  ) {
    return undefined;
  }

  if (isAstRecord(expression.callee) && expression.callee.type === "Import") {
    return { kind: "load", specifier: firstArgument.expression.value };
  }
  if (
    options.includeRequire &&
    isAstRecord(expression.callee) &&
    expression.callee.type === "Identifier" &&
    expression.callee.value === "require"
  ) {
    return { kind: "load", specifier: firstArgument.expression.value };
  }
  if (options.includeRequire && isRequireResolveCallee(expression.callee)) {
    return { kind: "resolve", specifier: firstArgument.expression.value };
  }
  return undefined;
}

function isRequireResolveCallee(value: unknown): boolean {
  if (!isAstRecord(value) || value.type !== "MemberExpression") return false;
  return (
    isAstRecord(value.object) &&
    value.object.type === "Identifier" &&
    value.object.value === "require" &&
    isAstRecord(value.property) &&
    value.property.type === "Identifier" &&
    value.property.value === "resolve"
  );
}

function isAstRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function extractStaticModuleReferencesWithRegex(
  source: string,
): RuntimeModuleReference[] {
  const references: RuntimeModuleReference[] = [];
  const importPattern =
    /\bimport\s+(?!type\b)(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|\bexport\s+(?!type\b)[^'"]*?\s+from\s+["']([^"']+)["']/g;

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier) references.push({ kind: "load", specifier });
  }

  return references;
}

function extractRuntimeCallReferencesWithRegex(
  source: string,
  options: { includeRequire?: boolean },
): RuntimeModuleReference[] {
  const references: RuntimeModuleReference[] = [];
  const callPattern = options.includeRequire
    ? /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g
    : /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(callPattern)) {
    const specifier = match[1];
    if (specifier) references.push({ kind: "load", specifier });
  }

  if (options.includeRequire) {
    const resolvePattern =
      /\brequire\s*\.\s*resolve\s*\(\s*["']([^"']+)["']\s*\)/g;
    for (const match of source.matchAll(resolvePattern)) {
      const specifier = match[1];
      if (specifier) references.push({ kind: "resolve", specifier });
    }
  }

  return references;
}
