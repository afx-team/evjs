import { type Module, parseSync } from "@swc/core";
import type { ModuleItem } from "@swc/types";
import type { ServerFunctionExport } from "../../server-fns.js";
import {
  SERVER_FUNCTION_TRANSFORM_RUNTIME,
  type TransformOptions,
} from "../../types.js";
import { makeFnId } from "../../utils.js";

const runtime = SERVER_FUNCTION_TRANSFORM_RUNTIME;

/** Notify the manifest collector about each server function. */
function reportToManifest(
  serverFunctions: ServerFunctionExport[],
  options: TransformOptions,
): void {
  if (!options.onServerFn) return;
  for (const { exportName } of serverFunctions) {
    const fnId = makeFnId(
      options.rootContext,
      options.resourcePath,
      exportName,
    );
    options.onServerFn(fnId);
  }
}

/** Server build: injects import and appends registrations as AST nodes. */
export function buildServerOutput(
  program: Module,
  serverFunctions: ServerFunctionExport[],
  options: TransformOptions,
): Module {
  reportToManifest(serverFunctions, options);

  const registrations = serverFunctions.map(({ exportName, localName }) => {
    const fnId = JSON.stringify(
      makeFnId(options.rootContext, options.resourcePath, exportName),
    );
    return `${runtime.registerServerReference}(${localName}, ${fnId}, ${JSON.stringify(exportName)});`;
  });

  const injectCode = [
    `import { ${runtime.registerServerReference} } from "${runtime.serverModule}";`,
    ...registrations,
  ].join("\n");

  const injectAst = parseSync(injectCode, { syntax: "ecmascript" });

  // Prepend import
  if (injectAst.body.length > 0) {
    program.body.splice(
      directivePrologueLength(program.body),
      0,
      injectAst.body[0],
    );
  }

  // Append registrations
  for (let i = 1; i < injectAst.body.length; i++) {
    program.body.push(injectAst.body[i]);
  }

  return program;
}

function directivePrologueLength(body: ModuleItem[]): number {
  let index = 0;
  for (const item of body) {
    if (!isDirectiveStatement(item)) break;
    index += 1;
  }
  return index;
}

function isDirectiveStatement(item: ModuleItem): boolean {
  return (
    item.type === "ExpressionStatement" &&
    item.expression.type === "StringLiteral"
  );
}
