import { createHash } from "node:crypto";
import path from "node:path";
import { emitCode } from "../../codegen.js";
import type { TransformOptions } from "../../types.js";
import { makeFnId } from "../../utils.js";

/** Derive a stable module ID from a file path relative to root. */
function makeModuleId(rootContext: string, resourcePath: string): string {
  const relativePath = path.relative(rootContext, resourcePath);
  return createHash("sha256").update(relativePath).digest("hex").slice(0, 16);
}

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
    return `registerServerFn(${fnId}, ${name});`;
  });

  return [
    'import { registerServerFn } from "@evjs/runtime/server";',
    source,
    emitCode(registrations.join("\n")),
  ].join("\n");
}
