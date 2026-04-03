import { createHash } from "node:crypto";
import path from "node:path";
import { parseSync } from "@swc/core";

/** Parse a "module#export" reference string. */
export function parseModuleRef(ref: string): {
  module: string;
  exportName: string;
} {
  const idx = ref.indexOf("#");
  if (idx === -1) {
    throw new Error(
      `Invalid module reference "${ref}". Expected format: "module#exportName".`,
    );
  }
  return { module: ref.slice(0, idx), exportName: ref.slice(idx + 1) };
}

/** Hash a string to a 16-character hex digest (SHA-256, truncated). */
export function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/** Derive a stable module ID from a file path relative to root. */
export function makeModuleId(
  rootContext: string,
  resourcePath: string,
): string {
  return hashString(path.relative(rootContext, resourcePath));
}

/** Derive a stable function ID from the file path and export name. */
export function makeFnId(
  rootContext: string,
  resourcePath: string,
  exportName: string,
): string {
  const relativePath = path.relative(rootContext, resourcePath);
  return hashString(`${relativePath}:${exportName}`);
}

/** Check whether the source starts with the "use server" directive. */
export function detectUseServer(source: string): boolean {
  // Fast path: skip expensive SWC parse if the file clearly doesn't
  // start with a "use server" string literal in the first 200 chars.
  if (!/^\s*["']use server["']/m.test(source.slice(0, 200))) {
    return false;
  }

  try {
    const ast = parseSync(source, {
      syntax: "typescript",
      tsx: true,
      target: "esnext",
    });

    if (ast.body && ast.body.length > 0) {
      const firstNode = ast.body[0];
      if (
        firstNode.type === "ExpressionStatement" &&
        firstNode.expression.type === "StringLiteral" &&
        firstNode.expression.value === "use server"
      ) {
        return true;
      }
    }
  } catch (e) {
    // If parsing fails (syntax error or unsupported features), log for debugging
    // but conservatively assume NOT a server module. Real errors surface during build.
    // biome-ignore lint/suspicious/noConsole: Intentional debug output for build diagnostics
    console.warn(
      `[evjs] Failed to parse file for "use server" directive: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return false;
}
