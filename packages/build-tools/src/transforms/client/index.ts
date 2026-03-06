import { emitCode } from "../../codegen.js";
import { RUNTIME, type TransformOptions } from "../../types.js";
import { makeFnId } from "../../utils.js";

/** Client build: replace function bodies with __ev_call transport stubs. */
export function buildClientOutput(
  exportNames: string[],
  options: TransformOptions,
): string {
  const stubs = exportNames.map((name) => {
    const fnId = JSON.stringify(
      makeFnId(options.rootContext, options.resourcePath, name),
    );
    return [
      `export function ${name}(...args) { return ${RUNTIME.clientCall}(${fnId}, args); }`,
      `${RUNTIME.clientRegister}(${name}, ${fnId});`,
    ].join("\n");
  });

  return emitCode(
    [
      `import { ${RUNTIME.clientCall}, ${RUNTIME.clientRegister} } from "${RUNTIME.clientTransportModule}";`,
      ...stubs,
    ].join("\n"),
  );
}
