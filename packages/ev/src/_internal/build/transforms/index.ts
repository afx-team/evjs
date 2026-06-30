import { printSync } from "@swc/core";
import {
  analyzeServerFunctionExportsFromAst,
  formatServerFunctionParseDiagnostic,
  parseServerFunctionModule,
} from "../server-fns.js";
import type { TransformOptions } from "../types.js";
import {
  CONFLICTING_FRAMEWORK_DIRECTIVES_MESSAGE,
  detectConflictingFrameworkDirectives,
  detectUseServer,
} from "../utils.js";
import { buildClientOutput } from "./client/index.js";
import { buildServerOutput } from "./server/index.js";

export interface TransformResult {
  code: string;
  map?: string;
}

/**
 * Transform a "use server" file for either client or server builds.
 * This is a pure function with no bundler dependency.
 *
 * - **Server**: keeps original source + appends `registerServerReference()` calls
 * - **Client**: replaces function bodies with generated client reference stubs
 */
export async function transformServerFile(
  source: string,
  options: TransformOptions,
): Promise<TransformResult> {
  if (!detectUseServer(source)) {
    return { code: source };
  }
  if (detectConflictingFrameworkDirectives(source)) {
    throw new Error(
      [
        '[evjs] Invalid "use server" module.',
        CONFLICTING_FRAMEWORK_DIRECTIVES_MESSAGE,
      ].join("\n"),
    );
  }

  const { ast: program, error } = parseServerFunctionModule(source);
  if (!program) {
    throw new Error(
      [
        '[evjs] Invalid "use server" module.',
        formatServerFunctionParseDiagnostic(error),
      ].join("\n"),
    );
  }

  const serverFunctions = analyzeServerFunctionExportsFromAst(program.body);
  if (serverFunctions.diagnostics.length > 0) {
    throw new Error(
      [
        '[evjs] Invalid "use server" module.',
        ...serverFunctions.diagnostics.map((diagnostic) => diagnostic.message),
      ].join("\n"),
    );
  }
  if (serverFunctions.exports.length === 0) {
    return { code: source };
  }

  const modifiedAst = options.isServer
    ? buildServerOutput(program, serverFunctions.exports, options)
    : buildClientOutput(program, serverFunctions.exports, options);

  const { code, map } = printSync(modifiedAst, {
    sourceMaps: true,
    inlineSourcesContent: true,
    filename: options.resourcePath,
    sourceFileName: options.resourcePath,
    jsc: { target: "esnext" },
  });

  return { code, map };
}
