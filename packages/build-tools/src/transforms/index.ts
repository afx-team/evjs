import { parse, printSync } from "@swc/core";
import type { TransformOptions } from "../types.js";
import { detectUseServer } from "../utils.js";
import { buildClientOutput } from "./client/index.js";
import { buildServerOutput } from "./server/index.js";
import { extractExportNames } from "./utils.js";

export interface TransformResult {
  code: string;
  map?: string;
}

/**
 * Transform a "use server" file for either client or server builds.
 * This is a pure function with no bundler dependency.
 *
 * - **Server**: keeps original source + appends `registerServerFn()` calls
 * - **Client**: replaces function bodies with `__fn_call()` transport stubs
 */
export async function transformServerFile(
  source: string,
  options: TransformOptions,
): Promise<TransformResult> {
  if (!detectUseServer(source)) {
    return { code: source };
  }

  const program = await parse(source, {
    syntax: "typescript",
    tsx: true,
    comments: false,
    script: false,
    target: "esnext",
  });

  const exportNames = extractExportNames(program.body);
  if (exportNames.length === 0) {
    return { code: source };
  }

  const modifiedAst = options.isServer
    ? buildServerOutput(program, exportNames, options)
    : buildClientOutput(program, exportNames, options);

  const { code, map } = printSync(modifiedAst, {
    sourceMaps: true,
    inlineSourcesContent: true,
    filename: options.resourcePath,
    sourceFileName: options.resourcePath,
    jsc: { target: "esnext" },
  });

  return { code, map };
}
