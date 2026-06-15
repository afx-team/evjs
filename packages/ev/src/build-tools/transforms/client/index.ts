import { type Module, parseSync } from "@swc/core";
import { formatModuleExportName } from "../../module-exports.js";
import type { ServerFunctionExport } from "../../server-fns.js";
import { RUNTIME, type TransformOptions } from "../../types.js";
import { makeFnId } from "../../utils.js";

/** Client build: replace function bodies with createServerReference stubs via AST replacement. */
export function buildClientOutput(
  program: Module,
  serverFunctions: ServerFunctionExport[],
  options: TransformOptions,
): Module {
  const stubs = serverFunctions.map(({ exportName, arity }, index) => {
    const localName = `EvServerFn_${index}`;
    const fnId = JSON.stringify(
      makeFnId(options.rootContext, options.resourcePath, exportName),
    );
    const args = [
      fnId,
      JSON.stringify(exportName),
      ...(arity === undefined ? [] : [String(arity)]),
    ].join(", ");
    return [
      `const ${localName} = ${RUNTIME.createServerReference}(${args});`,
      `export { ${localName} as ${formatModuleExportName(exportName)} };`,
    ].join("\n");
  });

  const injectCode = [
    `import { ${RUNTIME.createServerReference} } from "${RUNTIME.clientTransportModule}";`,
    ...stubs,
  ].join("\n");

  const injectAst = parseSync(injectCode, { syntax: "ecmascript" });
  program.body = injectAst.body;

  return program;
}
