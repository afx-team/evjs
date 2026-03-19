import { type Module, parseSync } from "@swc/core";
import { RUNTIME, type TransformOptions } from "../../types.js";
import { makeFnId } from "../../utils.js";

/** Client build: replace function bodies with __fn_call transport stubs via AST replacement. */
export function buildClientOutput(
  program: Module,
  exportNames: string[],
  options: TransformOptions,
): Module {
  const stubs = exportNames.map((name) => {
    const fnId = JSON.stringify(
      makeFnId(options.rootContext, options.resourcePath, name),
    );
    return [
      `export function ${name}(...args) { return ${RUNTIME.clientCall}(${fnId}, args); }`,
      `${RUNTIME.clientRegister}(${name}, ${fnId}, ${JSON.stringify(name)});`,
    ].join("\n");
  });

  const injectCode = [
    `import { ${RUNTIME.clientCall}, ${RUNTIME.clientRegister} } from "${RUNTIME.clientTransportModule}";`,
    ...stubs,
  ].join("\n");

  const injectAst = parseSync(injectCode, { syntax: "ecmascript" });
  program.body = injectAst.body;

  return program;
}
