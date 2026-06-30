import type {
  ExportSpecifier,
  Expression,
  ModuleExportName,
  ModuleItem,
} from "@swc/types";

export function collectModuleExportNames(body: ModuleItem[]): string[] {
  const ambientLocalNames = collectAmbientLocalNames(body);
  const names = new Set<string>();

  for (const item of body) {
    if (item.type === "ExportDeclaration") {
      const declaration = item.declaration;
      if (isAmbientRuntimeDeclaration(declaration)) continue;

      if (declaration.type === "FunctionDeclaration") {
        if (declaration.identifier.value) {
          names.add(declaration.identifier.value);
        }
      } else if (declaration.type === "ClassDeclaration") {
        if (declaration.identifier.value) {
          names.add(declaration.identifier.value);
        }
      } else if (declaration.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations) {
          if (declarator.id.type === "Identifier") {
            names.add(declarator.id.value);
          }
        }
      }
      continue;
    }

    if (item.type === "ExportNamedDeclaration" && !item.typeOnly) {
      for (const specifier of item.specifiers) {
        if (
          !item.source &&
          isAmbientLocalExportSpecifier(specifier, ambientLocalNames)
        ) {
          continue;
        }
        const exportName = getExportSpecifierName(specifier);
        if (exportName) names.add(exportName);
      }
      continue;
    }

    if (
      item.type === "ExportDefaultDeclaration" ||
      item.type === "ExportDefaultExpression"
    ) {
      names.add("default");
    }
  }

  return [...names];
}

function getExportSpecifierName(
  specifier: ExportSpecifier,
): string | undefined {
  if (specifier.type === "ExportSpecifier") {
    if (specifier.isTypeOnly) return undefined;
    return getModuleExportName(specifier.exported ?? specifier.orig);
  }
  if (specifier.type === "ExportNamespaceSpecifier") {
    return getModuleExportName(specifier.name);
  }
  return undefined;
}

export function collectExportedVariableValues(
  body: ModuleItem[],
): Map<string, Expression | undefined> {
  return collectExportedVariableValueAnalysis(body).values;
}

export interface ExportedVariableValueAnalysis {
  values: Map<string, Expression | undefined>;
  duplicateNames: Set<string>;
}

export function collectExportedVariableValueAnalysis(
  body: ModuleItem[],
): ExportedVariableValueAnalysis {
  const localValues = new Map<string, Expression | undefined>();
  const exportedValues = new Map<string, Expression | undefined>();
  const duplicateNames = new Set<string>();
  const recordExport = (name: string, value: Expression | undefined): void => {
    if (exportedValues.has(name)) duplicateNames.add(name);
    exportedValues.set(name, value);
  };

  for (const item of body) {
    const declaration =
      item.type === "ExportDeclaration" ? item.declaration : item;
    if (declaration.type !== "VariableDeclaration" || declaration.declare) {
      continue;
    }

    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== "Identifier") continue;
      const localName = declarator.id.value;
      localValues.set(localName, declarator.init ?? undefined);
      if (item.type === "ExportDeclaration") {
        recordExport(localName, declarator.init ?? undefined);
      }
    }
  }

  for (const item of body) {
    if (
      item.type !== "ExportNamedDeclaration" ||
      item.typeOnly ||
      item.source
    ) {
      continue;
    }

    for (const specifier of item.specifiers) {
      if (specifier.type !== "ExportSpecifier") continue;
      if (specifier.isTypeOnly) continue;
      const localName = getIdentifierExportName(specifier.orig);
      const exportName = getModuleExportName(
        specifier.exported ?? specifier.orig,
      );
      if (!localName || !exportName || !localValues.has(localName)) continue;
      recordExport(exportName, localValues.get(localName));
    }
  }

  return { values: exportedValues, duplicateNames };
}

function collectAmbientLocalNames(body: ModuleItem[]): Set<string> {
  const names = new Set<string>();

  for (const item of body) {
    const declaration =
      item.type === "ExportDeclaration" ? item.declaration : item;

    if (!isAmbientRuntimeDeclaration(declaration)) continue;

    if (
      declaration.type === "FunctionDeclaration" ||
      declaration.type === "ClassDeclaration"
    ) {
      names.add(declaration.identifier.value);
      continue;
    }

    if (declaration.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type === "Identifier") {
          names.add(declarator.id.value);
        }
      }
    }
  }
  return names;
}

function isAmbientRuntimeDeclaration(declaration: {
  type: string;
  declare?: boolean;
}): boolean {
  return (
    declaration.declare === true &&
    (declaration.type === "FunctionDeclaration" ||
      declaration.type === "ClassDeclaration" ||
      declaration.type === "VariableDeclaration")
  );
}

function isAmbientLocalExportSpecifier(
  specifier: ExportSpecifier,
  ambientLocalNames: Set<string>,
): boolean {
  if (specifier.type !== "ExportSpecifier") return false;
  const localName = getIdentifierExportName(specifier.orig);
  return localName ? ambientLocalNames.has(localName) : false;
}

export function getIdentifierExportName(
  name: ModuleExportName,
): string | undefined {
  return name.type === "Identifier" ? name.value : undefined;
}

export function getModuleExportName(
  name: ModuleExportName,
): string | undefined {
  if (name.type === "Identifier" || name.type === "StringLiteral") {
    return name.value;
  }
  return undefined;
}

export function formatModuleExportName(exportName: string): string {
  return isIdentifierName(exportName) ? exportName : JSON.stringify(exportName);
}

function isIdentifierName(value: string): boolean {
  return /^(?:[$_]|\p{ID_Start})(?:[$_]|\u200c|\u200d|\p{ID_Continue})*$/u.test(
    value,
  );
}
