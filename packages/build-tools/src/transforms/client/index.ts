import { emitCode } from "../../codegen.js";
import type { TransformOptions } from "../../types.js";
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
      `export function ${name}(...args) { return __ev_call(${fnId}, args); }`,
      `${name}.evId = ${fnId};`,
    ].join("\n");
  });

  return emitCode(
    [
      'import { __ev_call } from "@evjs/runtime/client/transport";',
      ...stubs,
    ].join("\n"),
  );
}
