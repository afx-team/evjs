import { createHash } from "node:crypto";
import { parse } from "@swc/core";
import type { Compiler } from "webpack";

interface LoaderContext {
  getOptions(): { isServer?: boolean };
  resourcePath: string;
  rootContext: string;
  _compiler?: Compiler & {
    _ev_manifest_collector?: {
      addServerFn(id: string, meta: { moduleId: string; export: string }): void;
    };
  };
}

import path from "node:path";

/**
 * Derive a stable function ID from the file path and export name.
 */
function makeFnId(
  rootContext: string,
  resourcePath: string,
  exportName: string,
): string {
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

export default async function serverFnLoader(
  this: LoaderContext,
  source: string,
): Promise<string> {
  if (!hasUseServerDirective(source)) {
    return source;
  }

  // Adaptively check if we are building the server (Child Compiler) or client
  const explicitOptions = this.getOptions() || {};
  let isServer = explicitOptions.isServer;
  if (typeof isServer === "undefined") {
    const compilerName = this._compiler?.name;
    const target = this._compiler?.options?.target;
    isServer = compilerName === "evServer" || target === "node";
  }

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

  const manifestCollector = this._compiler?._ev_manifest_collector;

  if (isServer) {
    // Server build: keep original + register
    const registrations = exportNames
      .map((name) => {
        const fnId = makeFnId(this.rootContext, this.resourcePath, name);
        if (manifestCollector) {
          const relativePath = path.relative(
            this.rootContext,
            this.resourcePath,
          );
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
      return `export function ${name}(...args) {\n  return __ev_call("${fnId}", args);\n}\n${name}.evId = "${fnId}";`;
    })
    .join("\n\n");

  return `import { __ev_call } from "@evjs/runtime/client/transport";\n\n${stubCode}\n`;
}
