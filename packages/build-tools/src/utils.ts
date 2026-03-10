import { createHash } from "node:crypto";
import path from "node:path";

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

/**
 * Derive a human-readable function ID from the file path and export name.
 *
 * Produces IDs like `src/api/hello.server#hello` — useful for FaaS mode
 * where hashed IDs are unnecessary and readable IDs aid debugging.
 */
export function makeReadableFnId(
  rootContext: string,
  resourcePath: string,
  exportName: string,
): string {
  const relativePath = path.relative(rootContext, resourcePath);
  // Strip file extension for cleaner IDs
  const withoutExt = relativePath.replace(/\.[^/.]+$/, "");
  return `${withoutExt}#${exportName}`;
}

/** Check whether the source starts with the "use server" directive. */
export function detectUseServer(source: string): boolean {
  const trimmed = source.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  return /^["']use server["'];?\s/.test(trimmed);
}
