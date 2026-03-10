import { emitCode } from "../../codegen.js";
import { RUNTIME, type TransformOptions } from "../../types.js";
import { makeFnId, makeModuleId, makeReadableFnId } from "../../utils.js";

/** Resolve the fnId based on whether readableIds is enabled. */
function resolveFnId(options: TransformOptions, exportName: string): string {
  return options.readableIds
    ? makeReadableFnId(options.rootContext, options.resourcePath, exportName)
    : makeFnId(options.rootContext, options.resourcePath, exportName);
}

/** Notify the manifest collector about each server function. */
function reportToManifest(
  exportNames: string[],
  options: TransformOptions,
): void {
  if (!options.onServerFn) return;
  const moduleId = makeModuleId(options.rootContext, options.resourcePath);
  for (const name of exportNames) {
    const fnId = resolveFnId(options, name);
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
    const fnId = JSON.stringify(resolveFnId(options, name));
    return `${RUNTIME.registerServerFn}(${fnId}, ${name});`;
  });

  return [
    `import { ${RUNTIME.registerServerFn} } from "${RUNTIME.serverModule}";`,
    source,
    emitCode(registrations.join("\n")),
  ].join("\n");
}
