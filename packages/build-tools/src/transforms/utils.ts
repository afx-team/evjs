import type { ModuleItem } from "@swc/types";

/** Extract exported function/variable names from a parsed SWC module. */
export function extractExportNames(body: ModuleItem[]): string[] {
  const names: string[] = [];

  for (const item of body) {
    if (item.type === "ExportDeclaration") {
      const decl = item.declaration;
      if (decl.type === "FunctionDeclaration") {
        if (decl.identifier.value) names.push(decl.identifier.value);
      } else if (decl.type === "VariableDeclaration") {
        for (const v of decl.declarations) {
          if (v.id.type === "Identifier") {
            names.push(v.id.value);
          }
        }
      }
    } else if (item.type === "ExportNamedDeclaration") {
      for (const specifier of item.specifiers) {
        if (specifier.type === "ExportSpecifier") {
          const exported = specifier.exported ?? specifier.orig;
          if (exported.type === "Identifier") {
            names.push(exported.value);
          }
        }
      }
    }
  }

  return names;
}
