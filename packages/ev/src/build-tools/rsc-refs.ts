import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ClientReferenceNode,
  ServerReferenceNode,
} from "@evjs/shared/manifest";
import { parseSync } from "@swc/core";
import type { TransformResult } from "./transforms/index.js";
import { extractExportNames } from "./transforms/utils.js";
import { hashServerFunction } from "./utils.js";

export interface RscReferenceAnalysis {
  clientReferences: ClientReferenceNode[];
  serverReferences: ServerReferenceNode[];
}

export function extractRscReferences(
  source: string,
  moduleId: string,
): RscReferenceAnalysis {
  if (!mayHaveRscDirective(source)) {
    return emptyAnalysis();
  }

  const ast = parseSync(source, {
    syntax: "typescript",
    tsx: true,
    target: "esnext",
  });
  const hasUseClient = hasDirective(ast.body, "use client");
  const hasUseServer = hasDirective(ast.body, "use server");
  if (!hasUseClient && !hasUseServer) {
    return emptyAnalysis();
  }

  const exportNames = extractExportNames(ast.body);
  return {
    clientReferences: hasUseClient
      ? exportNames.map((exportName) => ({
          id: `${moduleId}#${exportName}`,
          module: moduleId,
          exportName,
        }))
      : [],
    serverReferences: hasUseServer
      ? exportNames.map((exportName) => ({
          id: hashServerFunction(moduleId, exportName),
          module: moduleId,
          exportName,
        }))
      : [],
  };
}

export interface TransformRscClientFileOptions {
  resourcePath: string;
  rootContext: string;
}

export async function transformRscClientFile(
  source: string,
  options: TransformRscClientFileOptions,
): Promise<TransformResult> {
  if (!detectUseClient(source)) return { code: source };

  const ast = parseSync(source, {
    syntax: "typescript",
    tsx: true,
    target: "esnext",
  });
  const exportNames = extractExportNames(ast.body);
  if (exportNames.length === 0) return { code: source };

  const moduleId = pathToFileURL(
    path.isAbsolute(options.resourcePath)
      ? options.resourcePath
      : path.resolve(options.rootContext, options.resourcePath),
  ).href;
  const lines = [
    `import { registerClientReference } from "react-server-dom-webpack/server.node";`,
    ``,
    `function createClientReference(exportName) {`,
    `  return registerClientReference(function clientReferenceProxy() {`,
    `    throw new Error("[evjs] Cannot call a client component export from the server. Client references can only be rendered or passed to the client.");`,
    `  }, ${JSON.stringify(moduleId)}, exportName);`,
    `}`,
  ];

  exportNames.forEach((exportName, index) => {
    const localName = `__evjs_client_reference_${index}`;
    lines.push(
      ``,
      `const ${localName} = createClientReference(${JSON.stringify(exportName)});`,
    );
    if (exportName === "default") {
      lines.push(`export default ${localName};`);
    } else if (isIdentifierName(exportName)) {
      lines.push(`export const ${exportName} = ${localName};`);
    }
  });

  return {
    code: `${lines.join("\n")}\n`,
  };
}

export function detectUseClient(source: string): boolean {
  if (!/^\s*["']use client["']/m.test(source.slice(0, 200))) {
    return false;
  }

  try {
    const ast = parseSync(source, {
      syntax: "typescript",
      tsx: true,
      target: "esnext",
    });
    return hasDirective(ast.body, "use client");
  } catch {
    return false;
  }
}

function mayHaveRscDirective(source: string): boolean {
  return /^\s*["']use (client|server)["']/m.test(source.slice(0, 200));
}

function hasDirective(
  body: ReturnType<typeof parseSync>["body"],
  directive: "use client" | "use server",
): boolean {
  for (const item of body) {
    if (
      item.type === "ExpressionStatement" &&
      item.expression.type === "StringLiteral"
    ) {
      if (item.expression.value === directive) return true;
      continue;
    }
    return false;
  }
  return false;
}

function emptyAnalysis(): RscReferenceAnalysis {
  return {
    clientReferences: [],
    serverReferences: [],
  };
}

function isIdentifierName(value: string): boolean {
  return /^(?:[$_]|\p{ID_Start})(?:[$_]|\u200c|\u200d|\p{ID_Continue})*$/u.test(
    value,
  );
}
