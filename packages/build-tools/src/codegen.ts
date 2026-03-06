import { parseSync, printSync } from "@swc/core";

/**
 * Parse source code and re-emit via SWC for consistent formatting.
 * Validates the code is syntactically correct at build time.
 */
export function emitCode(source: string): string {
  const ast = parseSync(source, { syntax: "ecmascript" });
  return printSync(ast, { jsc: { target: "esnext" } }).code;
}
