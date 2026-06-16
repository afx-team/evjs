import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ClientReferenceNode,
  ServerReferenceNode,
} from "@evjs/shared/manifest";
import { parseSync } from "@swc/core";
import type { ModuleItem } from "@swc/types";
import {
  collectModuleExportNames,
  formatModuleExportName,
} from "./module-exports.js";
import { formatParseErrorMessage } from "./routes/shared.js";
import {
  analyzeServerFunctionExportsFromAst,
  formatServerFunctionParseDiagnostic,
  isServerFunctionParseDiagnostic,
} from "./server-fns.js";
import type { TransformResult } from "./transforms/index.js";
import {
  CONFLICTING_FRAMEWORK_DIRECTIVES_MESSAGE,
  detectConflictingFrameworkDirectives,
  detectFrameworkDirective,
  detectUseServer,
  hashServerFunction,
} from "./utils.js";

type RscReferenceAst = ReturnType<typeof parseSync>;

export interface RscReferenceAnalysis {
  clientReferences: ClientReferenceNode[];
  serverReferences: ServerReferenceNode[];
  diagnostics: RscReferenceDiagnostic[];
}

export interface RscReferenceDiagnostic {
  level: "error";
  message: string;
}

const RSC_REFERENCE_PARSE_DIAGNOSTIC_PREFIX =
  "RSC reference module could not be parsed:";

export function extractRscReferences(
  source: string,
  moduleId: string,
): RscReferenceAnalysis {
  if (!mayHaveRscDirective(source)) {
    return emptyAnalysis();
  }

  const { ast, error } = parseRscReferenceModule(source);
  if (!ast) {
    return createParseErrorAnalysis(source, error);
  }

  const hasUseClient = hasDirective(ast.body, "use client");
  const hasUseServer = hasDirective(ast.body, "use server");
  if (!hasUseClient && !hasUseServer) {
    return emptyAnalysis();
  }
  if (hasUseClient && hasUseServer) {
    return {
      clientReferences: [],
      serverReferences: [],
      diagnostics: [
        {
          level: "error",
          message: CONFLICTING_FRAMEWORK_DIRECTIVES_MESSAGE,
        },
      ],
    };
  }

  const exportNames = collectModuleExportNames(ast.body);
  const clientDiagnostics = hasUseClient
    ? collectRscClientExportDiagnostics(ast.body, exportNames)
    : [];
  const serverFunctionAnalysis = hasUseServer
    ? analyzeServerFunctionExportsFromAst(ast.body)
    : undefined;
  return {
    clientReferences: hasUseClient
      ? exportNames.map((exportName) => ({
          id: `${moduleId}#${exportName}`,
          module: moduleId,
          exportName,
        }))
      : [],
    serverReferences: hasUseServer
      ? (serverFunctionAnalysis?.exports ?? []).map(({ exportName }) => ({
          id: hashServerFunction(moduleId, exportName),
          module: moduleId,
          exportName,
        }))
      : [],
    diagnostics: [
      ...clientDiagnostics,
      ...(serverFunctionAnalysis?.diagnostics ?? []),
    ],
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
  if (detectConflictingFrameworkDirectives(source)) {
    throw new Error(
      [
        '[evjs] Invalid "use client" module.',
        CONFLICTING_FRAMEWORK_DIRECTIVES_MESSAGE,
      ].join("\n"),
    );
  }

  const { ast, error } = parseRscReferenceModule(source);
  if (!ast) {
    throw new Error(
      [
        '[evjs] Invalid "use client" module.',
        formatRscReferenceParseDiagnostic(error),
      ].join("\n"),
    );
  }

  const exportNames = collectModuleExportNames(ast.body);
  const diagnostics = collectRscClientExportDiagnostics(ast.body, exportNames);
  if (diagnostics.length > 0) {
    throw new Error(
      [
        '[evjs] Invalid "use client" module.',
        ...diagnostics.map((diagnostic) => diagnostic.message),
      ].join("\n"),
    );
  }

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
    } else {
      lines.push(
        `export { ${localName} as ${formatModuleExportName(exportName)} };`,
      );
    }
  });

  return {
    code: `${lines.join("\n")}\n`,
  };
}

export function detectUseClient(source: string): boolean {
  return detectFrameworkDirective(source, "use client");
}

export function hasBlockingReferenceParseDiagnostic(
  analysis: RscReferenceAnalysis,
): boolean {
  return analysis.diagnostics.some(
    (diagnostic) =>
      isRscReferenceParseDiagnostic(diagnostic.message) ||
      isServerFunctionParseDiagnostic(diagnostic.message),
  );
}

function isRscReferenceParseDiagnostic(message: string): boolean {
  return message.startsWith(RSC_REFERENCE_PARSE_DIAGNOSTIC_PREFIX);
}

function mayHaveRscDirective(source: string): boolean {
  return detectUseClient(source) || detectUseServer(source);
}

function parseRscReferenceModule(source: string): {
  ast: RscReferenceAst | null;
  error?: unknown;
} {
  try {
    return {
      ast: parseSync(source, {
        syntax: "typescript",
        tsx: true,
        target: "esnext",
      }),
    };
  } catch (error) {
    return { ast: null, error };
  }
}

function createParseErrorAnalysis(
  source: string,
  error: unknown,
): RscReferenceAnalysis {
  const hasUseClient = detectUseClient(source);
  const hasUseServer = detectUseServer(source);
  if (hasUseClient && hasUseServer) {
    return {
      clientReferences: [],
      serverReferences: [],
      diagnostics: [
        {
          level: "error",
          message: CONFLICTING_FRAMEWORK_DIRECTIVES_MESSAGE,
        },
      ],
    };
  }
  const message = hasUseServer
    ? formatServerFunctionParseDiagnostic(error)
    : formatRscReferenceParseDiagnostic(error);
  return {
    clientReferences: [],
    serverReferences: [],
    diagnostics: [
      {
        level: "error",
        message,
      },
    ],
  };
}

function formatRscReferenceParseDiagnostic(error: unknown): string {
  return `${RSC_REFERENCE_PARSE_DIAGNOSTIC_PREFIX} ${formatParseErrorMessage(error)}`;
}

function collectRscClientExportDiagnostics(
  body: ModuleItem[],
  exportNames: string[],
): RscReferenceDiagnostic[] {
  const diagnostics: RscReferenceDiagnostic[] = [];

  for (const item of body) {
    if (item.type !== "ExportAllDeclaration" || isTypeOnlyExportAll(item)) {
      continue;
    }
    diagnostics.push({
      level: "error",
      message: `"use client" modules cannot use bare export * from ${JSON.stringify(
        item.source.value,
      )} because client reference names must be statically known. Use explicit named exports or a namespace re-export such as export * as Widgets from "./widgets".`,
    });
  }

  if (diagnostics.length === 0 && exportNames.length === 0) {
    diagnostics.push({
      level: "error",
      message:
        '"use client" modules must export at least one runtime client reference. Add a default export, named export, or explicit re-export; otherwise remove the directive.',
    });
  }

  return diagnostics;
}

function isTypeOnlyExportAll(item: ModuleItem): boolean {
  return (item as { typeOnly?: boolean }).typeOnly === true;
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
    diagnostics: [],
  };
}
