import { isServerFunctionExportName } from "@evjs/shared";
import { parseSync } from "@swc/core";
import type {
  Declaration,
  Expression,
  ModuleItem,
  Param,
  Pattern,
} from "@swc/types";
import {
  getIdentifierExportName,
  getModuleExportName,
} from "./module-exports.js";
import { formatParseErrorMessage } from "./routes/shared.js";
import { detectUseServer } from "./utils.js";

type ServerFunctionAst = ReturnType<typeof parseSync>;

type CallableExpression = Extract<
  Expression,
  { type: "ArrowFunctionExpression" | "FunctionExpression" }
>;

interface CallableLocal {
  arity: number | undefined;
}

export interface ServerFunctionExport {
  exportName: string;
  localName: string;
  arity?: number;
}

export interface ServerFunctionExportDiagnostic {
  level: "error";
  message: string;
}

export interface ServerFunctionExportAnalysis {
  exports: ServerFunctionExport[];
  diagnostics: ServerFunctionExportDiagnostic[];
}

const SERVER_FUNCTION_PARSE_DIAGNOSTIC_PREFIX =
  "Server function module could not be parsed:";

/** Extract exported server function names from a `"use server"` module. */
export function extractServerFunctionExports(source: string): string[] {
  const analysis = analyzeServerFunctionExports(source);
  if (analysis.diagnostics.length > 0) {
    throw new Error(
      analysis.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    );
  }
  return analysis.exports.map((fn) => fn.exportName);
}

export function analyzeServerFunctionExports(
  source: string,
): ServerFunctionExportAnalysis {
  if (!detectUseServer(source)) {
    return { exports: [], diagnostics: [] };
  }

  const { ast, error } = parseServerFunctionModule(source);
  if (!ast) {
    return createParseErrorAnalysis(error);
  }

  return analyzeServerFunctionExportsFromAst(ast.body);
}

export function parseServerFunctionModule(source: string): {
  ast: ServerFunctionAst | null;
  error?: unknown;
} {
  try {
    return {
      ast: parseSync(source, {
        syntax: "typescript",
        tsx: true,
        comments: false,
        script: false,
        target: "esnext",
      }),
    };
  } catch (error) {
    return { ast: null, error };
  }
}

export function formatServerFunctionParseDiagnostic(error: unknown): string {
  return `${SERVER_FUNCTION_PARSE_DIAGNOSTIC_PREFIX} ${formatParseErrorMessage(error)}`;
}

export function isServerFunctionParseDiagnostic(message: string): boolean {
  return message.startsWith(SERVER_FUNCTION_PARSE_DIAGNOSTIC_PREFIX);
}

function createParseErrorAnalysis(
  error: unknown,
): ServerFunctionExportAnalysis {
  return {
    exports: [],
    diagnostics: [
      {
        level: "error",
        message: formatServerFunctionParseDiagnostic(error),
      },
    ],
  };
}

export function analyzeServerFunctionExportsFromAst(
  body: ModuleItem[],
): ServerFunctionExportAnalysis {
  const callableLocals = collectCallableLocals(body);
  const ambientLocals = collectAmbientFunctionLocals(body);
  const generatorLocals = collectGeneratorLocals(body);
  const exports = new Map<string, ServerFunctionExport>();
  const diagnostics: ServerFunctionExportDiagnostic[] = [];

  function addServerFunction(
    exportName: string,
    localName: string,
    arity: number | undefined,
  ) {
    if (!isServerFunctionExportName(exportName)) {
      diagnostics.push({
        level: "error",
        message: `"use server" export name ${JSON.stringify(exportName)} must be a non-empty string without leading or trailing whitespace.`,
      });
      return;
    }

    if (exports.has(exportName)) {
      diagnostics.push({
        level: "error",
        message: `"use server" export "${exportName}" is declared more than once. Server function export names must be unique.`,
      });
      return;
    }
    exports.set(exportName, { exportName, localName, arity });
  }

  function rejectDefaultExport() {
    diagnostics.push({
      level: "error",
      message:
        '"use server" modules cannot default-export server functions. Export a named function instead.',
    });
  }

  function rejectAmbientExport(exportName: string) {
    diagnostics.push({
      level: "error",
      message: `"use server" export "${exportName}" must include a runtime function implementation. Ambient declare exports are type-only.`,
    });
  }

  function rejectGeneratorExport(exportName: string) {
    diagnostics.push({
      level: "error",
      message: `"use server" export "${exportName}" cannot be a generator function. Server functions must return a value or Promise, not an iterator.`,
    });
  }

  for (const item of body) {
    if (item.type === "ExportDeclaration") {
      const declaration = item.declaration;
      if (declaration.type === "FunctionDeclaration") {
        const name = declaration.identifier?.value;
        if (name) {
          if (declaration.declare || !declaration.body) {
            rejectAmbientExport(name);
          } else if (isGeneratorFunction(declaration)) {
            rejectGeneratorExport(name);
          } else {
            addServerFunction(name, name, getFunctionArity(declaration));
          }
        }
        continue;
      }

      if (declaration.type === "VariableDeclaration") {
        for (const variable of declaration.declarations) {
          if (variable.id.type !== "Identifier") continue;
          const name = variable.id.value;
          const init = variable.init;
          if (declaration.declare) {
            rejectAmbientExport(name);
            continue;
          }
          if (
            declaration.kind === "const" &&
            isCallableExpression(init) &&
            isGeneratorFunction(init)
          ) {
            rejectGeneratorExport(name);
          } else if (
            declaration.kind === "const" &&
            isCallableExpression(init)
          ) {
            addServerFunction(name, name, getFunctionArity(init));
          } else {
            diagnostics.push({
              level: "error",
              message: `"use server" export "${name}" must be a function declaration or a const initialized to a function.`,
            });
          }
        }
        continue;
      }

      if (isTypeOnlyExportDeclaration(declaration)) continue;
      const exportName = getExportDeclarationName(declaration);
      diagnostics.push({
        level: "error",
        message: exportName
          ? `"use server" export "${exportName}" must be a function declaration or a const initialized to a function.`
          : '"use server" modules can only export named server functions.',
      });
      continue;
    }

    if (item.type === "ExportNamedDeclaration") {
      if (item.typeOnly) continue;

      if (item.source) {
        diagnostics.push({
          level: "error",
          message:
            '"use server" modules cannot re-export server functions from another module. Export functions from the defining module.',
        });
        continue;
      }

      for (const specifier of item.specifiers) {
        if (specifier.type !== "ExportSpecifier") continue;
        if (specifier.isTypeOnly) continue;
        const localName = getIdentifierExportName(specifier.orig);
        if (!localName) {
          diagnostics.push({
            level: "error",
            message:
              '"use server" modules must export local server functions by identifier.',
          });
          continue;
        }
        const exported = specifier.exported ?? specifier.orig;
        const exportName = getModuleExportName(exported);
        if (!exportName) {
          diagnostics.push({
            level: "error",
            message:
              '"use server" modules must export server functions with identifier or string-literal names.',
          });
          continue;
        }

        if (exportName === "default") {
          rejectDefaultExport();
          continue;
        }

        if (ambientLocals.has(localName)) {
          rejectAmbientExport(exportName);
          continue;
        }

        if (generatorLocals.has(localName)) {
          rejectGeneratorExport(exportName);
          continue;
        }

        const local = callableLocals.get(localName);
        if (!local) {
          diagnostics.push({
            level: "error",
            message: `"use server" export "${exportName}" must reference a local function declaration or const initialized to a function.`,
          });
          continue;
        }

        addServerFunction(exportName, localName, local.arity);
      }
      continue;
    }

    if (item.type === "ExportAllDeclaration") {
      if (isTypeOnlyExportAll(item)) continue;
      diagnostics.push({
        level: "error",
        message:
          '"use server" modules cannot use bare export * re-exports. Export named server functions from the defining module.',
      });
      continue;
    }

    if (
      item.type === "ExportDefaultDeclaration" ||
      item.type === "ExportDefaultExpression"
    ) {
      rejectDefaultExport();
      continue;
    }

    if (item.type === "TsExportAssignment") {
      diagnostics.push({
        level: "error",
        message:
          '"use server" modules cannot use export assignment. Export named server functions instead.',
      });
      continue;
    }

    if (item.type === "TsNamespaceExportDeclaration") {
      diagnostics.push({
        level: "error",
        message:
          '"use server" modules cannot use namespace export declarations. Export named server functions instead.',
      });
    }
  }

  if (diagnostics.length === 0 && exports.size === 0) {
    diagnostics.push({
      level: "error",
      message:
        '"use server" modules must export at least one named server function. Add an exported function or remove the directive.',
    });
  }

  return {
    exports: [...exports.values()],
    diagnostics,
  };
}

function collectCallableLocals(body: ModuleItem[]): Map<string, CallableLocal> {
  const locals = new Map<string, CallableLocal>();

  for (const item of body) {
    if (item.type === "FunctionDeclaration") {
      if (item.declare || !item.body) continue;
      if (isGeneratorFunction(item)) continue;
      const name = item.identifier?.value;
      if (name) locals.set(name, { arity: getFunctionArity(item) });
      continue;
    }

    if (
      item.type !== "VariableDeclaration" ||
      item.kind !== "const" ||
      item.declare
    ) {
      continue;
    }
    for (const variable of item.declarations) {
      const init = variable.init;
      if (
        variable.id.type === "Identifier" &&
        isCallableExpression(init) &&
        !isGeneratorFunction(init)
      ) {
        locals.set(variable.id.value, { arity: getFunctionArity(init) });
      }
    }
  }

  return locals;
}

function collectAmbientFunctionLocals(body: ModuleItem[]): Set<string> {
  const locals = new Set<string>();

  for (const item of body) {
    if (item.type === "FunctionDeclaration") {
      if (!item.declare && item.body) continue;
      const name = item.identifier?.value;
      if (name) locals.add(name);
      continue;
    }

    if (item.type !== "VariableDeclaration" || !item.declare) {
      continue;
    }
    for (const variable of item.declarations) {
      if (variable.id.type === "Identifier") {
        locals.add(variable.id.value);
      }
    }
  }

  return locals;
}

function collectGeneratorLocals(body: ModuleItem[]): Set<string> {
  const locals = new Set<string>();

  for (const item of body) {
    if (item.type === "FunctionDeclaration") {
      if (item.declare || !item.body || !isGeneratorFunction(item)) continue;
      const name = item.identifier?.value;
      if (name) locals.add(name);
      continue;
    }

    if (
      item.type !== "VariableDeclaration" ||
      item.kind !== "const" ||
      item.declare
    ) {
      continue;
    }
    for (const variable of item.declarations) {
      const init = variable.init;
      if (
        variable.id.type === "Identifier" &&
        isCallableExpression(init) &&
        isGeneratorFunction(init)
      ) {
        locals.add(variable.id.value);
      }
    }
  }

  return locals;
}

function isCallableExpression(
  expression: Expression | null | undefined,
): expression is CallableExpression {
  return (
    expression?.type === "ArrowFunctionExpression" ||
    expression?.type === "FunctionExpression"
  );
}

function isGeneratorFunction(value: { generator?: boolean }): boolean {
  return value.generator === true;
}

function isTypeOnlyExportAll(item: ModuleItem): boolean {
  return "typeOnly" in item && item.typeOnly === true;
}

function isTypeOnlyExportDeclaration(declaration: Declaration): boolean {
  if (
    declaration.type === "TsInterfaceDeclaration" ||
    declaration.type === "TsTypeAliasDeclaration"
  ) {
    return true;
  }
  return "declare" in declaration && declaration.declare === true;
}

function getExportDeclarationName(
  declaration: Declaration,
): string | undefined {
  switch (declaration.type) {
    case "ClassDeclaration":
    case "FunctionDeclaration":
      return declaration.identifier.value;
    case "TsEnumDeclaration":
    case "TsInterfaceDeclaration":
    case "TsModuleDeclaration":
    case "TsTypeAliasDeclaration":
      return declaration.id.value;
    case "VariableDeclaration":
      return undefined;
  }
}

type FunctionParam = Param | Pattern;

function getFunctionArity(value: {
  params?: FunctionParam[];
}): number | undefined {
  if (!value.params) return 0;
  for (const param of value.params) {
    if (isFlexibleFunctionParam(getFunctionParamPattern(param))) {
      return undefined;
    }
  }
  return value.params.length;
}

function getFunctionParamPattern(param: FunctionParam): Pattern {
  return param.type === "Parameter" ? param.pat : param;
}

function isFlexibleFunctionParam(pattern: Pattern): boolean {
  if (pattern.type === "AssignmentPattern" || pattern.type === "RestElement") {
    return true;
  }
  if ("optional" in pattern && pattern.optional) {
    return true;
  }
  if (
    pattern.type === "Identifier" ||
    pattern.type === "ArrayPattern" ||
    pattern.type === "ObjectPattern"
  ) {
    return false;
  }
  return true;
}
