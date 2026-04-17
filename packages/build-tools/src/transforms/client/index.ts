import { type Module, parseSync } from "@swc/core";
import { RUNTIME, type TransformOptions } from "../../types.js";
import { makeFnId } from "../../utils.js";

/** Client build: replace function bodies with createServerReference stubs via AST replacement. */
export function buildClientOutput(
  program: Module,
  exportNames: string[],
  options: TransformOptions,
): Module {
  const stubs = exportNames.map((name) => {
    const fnId = JSON.stringify(
      makeFnId(options.rootContext, options.resourcePath, name),
    );
    return `export const ${name} = ${RUNTIME.createServerReference}(${fnId}, ${RUNTIME.callServer}, ${JSON.stringify(name)});`;
  });

  const injectCode = [
    `import { ${RUNTIME.createServerReference}, ${RUNTIME.callServer} } from "${RUNTIME.clientTransportModule}";`,
    ...stubs,
  ].join("\n");

  const injectAst = parseSync(injectCode, { syntax: "ecmascript" });
  program.body = injectAst.body;

  return program;
}
