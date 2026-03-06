import { parse } from "@swc/core";
import type { TransformOptions } from "../types.js";
import { detectUseServer } from "../utils.js";
import { buildClientOutput } from "./client/index.js";
import { buildServerOutput } from "./server/index.js";
import { extractExportNames } from "./utils.js";

/**
 * Transform a "use server" file for either client or server builds.
 * This is a pure function with no bundler dependency.
 *
 * - **Server**: keeps original source + appends `registerServerFn()` calls
 * - **Client**: replaces function bodies with `__ev_call()` transport stubs
 */
export async function transformServerFile(
  source: string,
  options: TransformOptions,
): Promise<string> {
  if (!detectUseServer(source)) {
    return source;
  }

  const program = await parse(source, {
    syntax: "typescript",
    tsx: true,
    comments: false,
    script: false,
  });

  const exportNames = extractExportNames(program.body);
  if (exportNames.length === 0) {
    return source;
  }

  return options.isServer
    ? buildServerOutput(source, exportNames, options)
    : buildClientOutput(exportNames, options);
}
