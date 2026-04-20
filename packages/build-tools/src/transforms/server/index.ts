import { type Module, parseSync } from "@swc/core";
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

/** Server build: inject import and appends registrations as AST nodes. */
export function buildServerOutput(
  program: Module,
  exportNames: string[],
  options: TransformOptions,
): Module {
  reportToManifest(exportNames, options);

  const registrations = exportNames.map((name) => {
    const fnId = JSON.stringify(
      makeFnId(options.rootContext, options.resourcePath, name),
    );
    return `${RUNTIME.registerServerReference}(${name}, ${fnId}, ${JSON.stringify(name)});`;
  });

  const injectCode = [
    `import { ${RUNTIME.registerServerReference} } from "${RUNTIME.serverModule}";`,
    ...registrations,
  ].join("\n");

  const injectAst = parseSync(injectCode, { syntax: "ecmascript" });

  // Prepend import
  if (injectAst.body.length > 0) {
    program.body.unshift(injectAst.body[0]);
  }

  // Append registrations
  for (let i = 1; i < injectAst.body.length; i++) {
    program.body.push(injectAst.body[i]);
  }

  return program;
}
