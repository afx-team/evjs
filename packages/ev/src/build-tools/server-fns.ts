import { parseSync } from "@swc/core";
import { extractExportNames } from "./transforms/utils.js";
import { detectUseServer } from "./utils.js";

/** Extract exported server function names from a `"use server"` module. */
export function extractServerFunctionExports(source: string): string[] {
  if (!detectUseServer(source)) return [];

  const ast = parseSync(source, {
    syntax: "typescript",
    tsx: true,
    target: "esnext",
  });

  return extractExportNames(ast.body);
}
