import type { Module } from "@swc/core";
import type { ServerFunctionExport } from "../../analysis/server-fns.js";
import type { TransformOptions } from "../../types.js";
import { makeFnId } from "../../utils.js";

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

/** Server build: preserve implementations and report their manifest IDs. */
export function buildServerOutput(
  program: Module,
  serverFunctions: ServerFunctionExport[],
  options: TransformOptions,
): Module {
  reportToManifest(serverFunctions, options);
  return program;
}
