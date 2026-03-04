import { createHash } from "node:crypto";

interface LoaderContext {
  getOptions(): { isServer?: boolean };
  resourcePath: string;
}

/**
 * Derive a stable function ID from the file path and export name.
 */
function makeFnId(resourcePath: string, exportName: string): string {
  return createHash("sha256")
    .update(`${resourcePath}:${exportName}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Parse exported function/const names from the source using simple regex.
 */
function parseExportNames(source: string): string[] {
  const names: string[] = [];
  const regex = /export\s+(?:async\s+)?(?:function|const|let|var)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(source)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Check whether the source starts with the `"use server"` directive.
 */
function hasUseServerDirective(source: string): boolean {
  const trimmed = source.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  return /^["']use server["'];?\s/.test(trimmed);
}

export default function serverFnLoader(this: LoaderContext, source: string): string {
  if (!hasUseServerDirective(source)) {
    return source;
  }

  const { isServer = false } = this.getOptions();
  const exportNames = parseExportNames(source);

  if (exportNames.length === 0) {
    return source;
  }

  // If a global manifest collector is provided (via EvaiWebpackPlugin), register the functions
  const manifestCollector = (this as any)._compiler?._evai_manifest_collector;

  if (isServer) {
    const registrations = exportNames
      .map((name) => {
        const fnId = makeFnId(this.resourcePath, name);
        if (manifestCollector) {
          manifestCollector.addServerFn(fnId, {
            file: this.resourcePath,
            name: name,
          });
        }
        return `registerServerFn("${fnId}", ${name});`;
      })
      .join("\n");

    return `import { registerServerFn } from "@evai/runtime/server";\n${source}\n${registrations}\n`;
  }

  const stubs = exportNames
    .map((name) => {
      const fnId = makeFnId(this.resourcePath, name);
      return `export function ${name}(...args) {\n  return __evai_rpc("${fnId}", args);\n}`;
    })
    .join("\n\n");

  return `import { __evai_rpc } from "@evai/runtime/client";\n\n${stubs}\n`;
}
