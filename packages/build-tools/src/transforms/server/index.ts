import { emitCode } from "../../codegen.js";
import { RUNTIME, type TransformOptions } from "../../types.js";
import { makeFnId, makeModuleId } from "../../utils.js";

/** Notify the manifest collector about each server function. */
function reportToManifest(
  exportNames: string[],
  options: TransformOptions,
): void {
  if (!options.onServerFn) return;
  const moduleId = makeModuleId(options.rootContext, options.resourcePath);
  for (const name of exportNames) {
    const fnId = makeFnId(options.rootContext, options.resourcePath, name);
    options.onServerFn(fnId, { moduleId, export: name });
  }
}

/** Server build: keep original source, prepend import, append registrations. */
export function buildServerOutput(
  source: string,
  exportNames: string[],
  options: TransformOptions,
): string {
  reportToManifest(exportNames, options);

  const registrations = exportNames.map((name) => {
    const fnId = JSON.stringify(
      makeFnId(options.rootContext, options.resourcePath, name),
    );
    return `${RUNTIME.registerServerFn}(${fnId}, ${name});`;
  });

  return [
    `import { ${RUNTIME.registerServerFn} } from "${RUNTIME.serverModule}";`,
    source,
    emitCode(registrations.join("\n")),
  ].join("\n");
}
