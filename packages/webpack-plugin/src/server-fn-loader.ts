import { createHash } from "node:crypto";
import { parse } from "@swc/core";

interface LoaderContext {
  getOptions(): { isServer?: boolean };
  resourcePath: string;
  rootContext: string;
}

import path from "node:path";

/**
 * Derive a stable function ID from the file path and export name.
 */
function makeFnId(rootContext: string, resourcePath: string, exportName: string): string {
  const relativePath = path.relative(rootContext, resourcePath);
  return createHash("sha256")
    .update(`${relativePath}:${exportName}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Check whether the source starts with the "use server" directive.
 */
function hasUseServerDirective(source: string): boolean {
  const trimmed = source.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  return /^["']use server["'];?\s/.test(trimmed);
}

export default async function serverFnLoader(this: LoaderContext, source: string): Promise<string> {
  if (!hasUseServerDirective(source)) {
    return source;
  }

  const { isServer = false } = this.getOptions();

  // Parse the source into an AST
  const program = await parse(source, {
    syntax: "typescript",
    tsx: true,
    comments: false,
    script: false,
  });

  const exportNames: string[] = [];

  // Iterate through module items to find exports
  for (const item of program.body) {
    if (item.type === "ExportDeclaration") {
      const decl = item.declaration;
      if (decl.type === "FunctionDeclaration") {
        if (decl.identifier.value) exportNames.push(decl.identifier.value);
      } else if (decl.type === "VariableDeclaration") {
        for (const v of decl.declarations) {
          if (v.id.type === "Identifier") {
            exportNames.push(v.id.value);
          }
        }
      }
    } else if (item.type === "ExportNamedDeclaration") {
      for (const specifier of item.specifiers) {
        if (specifier.type === "ExportSpecifier") {
          if (specifier.exported?.type === "Identifier") {
            exportNames.push(specifier.exported.value);
          } else if (specifier.orig.type === "Identifier") {
            exportNames.push(specifier.orig.value);
          }
        }
      }
    }
  }

  if (exportNames.length === 0) {
    return source;
  }

  const manifestCollector = (this as any)._compiler?._ev_manifest_collector;

  if (isServer) {
    // Server build: keep original + register
    const registrations = exportNames
      .map((name) => {
        const fnId = makeFnId(this.rootContext, this.resourcePath, name);
        if (manifestCollector) {
          const relativePath = path.relative(this.rootContext, this.resourcePath);
          const moduleId = createHash("sha256")
            .update(relativePath)
            .digest("hex")
            .slice(0, 16);
          manifestCollector.addServerFn(fnId, {
            moduleId,
            export: name,
          });
        }
        return `registerServerFn("${fnId}", ${name});`;
      })
      .join("\n");

    return `import { registerServerFn } from "@evjs/runtime/server";\n${source}\n${registrations}\n`;
  }

  // Client build: replace with RPC stubs
  const stubCode = exportNames
    .map((name) => {
      const fnId = makeFnId(this.rootContext, this.resourcePath, name);
      return `export function ${name}(...args) {\n  return __ev_rpc("${fnId}", args);\n}`;
    })
    .join("\n\n");

  return `import { __ev_rpc } from "@evjs/runtime/client";\n\n${stubCode}\n`;
}
